import { NextResponse } from "next/server";
import { sb, supabaseConfigured } from "@/lib/supabase";
import { fetchSheetGrid } from "@/lib/formSheet";
import { readSnapshot, patchSnapshotRecord } from "@/lib/kintoneSnapshot";
import { kintoneConfigured, updateRecord, fetchRecord } from "@/lib/kintone";
import { writeEditor } from "@/lib/kintoneEditor";
import { denyUnlessPerm, getPerms } from "@/lib/auth";
import { invalidate, cached } from "@/lib/cache";
import { writeSheetCells } from "@/lib/sheetWrite";
import {
  TARGETS,
  HID_CODE,
  NAME_CODE,
  resolveCols,
  answerKey,
  normName,
  readResults,
  writeResult,
  readCfg,
} from "@/lib/cmImport";

export const dynamic = "force-dynamic";

// CM情報フォームの回答を施設一覧（Kintone）へ反映する。
//   GET                      … 反映の予定と、これまでの結果を返す（書き込みはしない）
//   POST { keys }            … 指定の回答を反映する（省略時は反映できるもの全部）
//   POST { revert: key }     … その回答で入れた内容を取り消す（入れた値のままなら空に戻す）
//   POST { relink: {key,id}} … 別のレコードに付け替えて入れ直す
//
// 突き合わせは HID →（空なら）施設名（英語）→（それも空なら）施設名（日本語）。
// Kintone 側が空の項目にだけ入れる。CM種別は選択肢に無ければ入れずに知らせる。

const FORM_TITLE = /CM情報/;

// 登録済みフォームシートから CM情報 のものを探す
async function findSheet() {
  const rows = await sb("task_override?scope=eq.form&select=key,data").catch(() => []);
  const list = (rows || []).map((r) => ({ id: r.key, ...(r.data || {}) }));
  return list.find((x) => FORM_TITLE.test(String(x.title || ""))) || null;
}

// 施設一覧（スナップショット）から、HID・施設名で引ける表を作る
function indexRecords(records) {
  const byHid = new Map();
  const byName = new Map();
  const byId = new Map();
  for (const r of records) {
    const id = Number(r?.$id?.value || 0);
    byId.set(String(id), r);
    const hid = String(r?.[HID_CODE]?.value ?? "").trim();
    if (hid) {
      const cur = byHid.get(hid);
      if (!cur || Number(cur.$id?.value || 0) < id) byHid.set(hid, r);
    }
    const nm = normName(r?.[NAME_CODE]?.value);
    if (nm) {
      const cur = byName.get(nm);
      if (!cur || Number(cur.$id?.value || 0) < id) byName.set(nm, r);
    }
  }
  return { byHid, byName, byId };
}

const text = (v) => String(v ?? "").trim();
// シートの「Kintoneへ反映済み」欄に付いている印か
const isOn = (v) => /^[〇○◯✓✔レ●◎]$/.test(text(v)) || text(v).toUpperCase() === "TRUE";

// 1回答ぶんの「何をどう入れるか」を組み立てる
function planFor(row, cols, idx, index, fields, results) {
  const key = answerKey(row, cols, index);
  const hid = cols.hid >= 0 ? text(row[cols.hid]) : "";
  const name = cols.name >= 0 ? text(row[cols.name]) : "";
  const nameJa = cols.nameJa >= 0 ? text(row[cols.nameJa]) : "";
  const prev = results[key] || null;

  // 付け替えの指定があればそれを優先する
  let rec = null;
  let by = null;
  if (prev?.recordId && prev?.pinned) {
    rec = idx.byId.get(String(prev.recordId)) || null;
    by = "指定";
  }
  if (!rec && hid) {
    rec = idx.byHid.get(hid) || null;
    if (rec) by = "HID";
  }
  if (!rec && name) {
    rec = idx.byName.get(normName(name)) || null;
    if (rec) by = "施設名（英語）";
  }
  if (!rec && nameJa) {
    rec = idx.byName.get(normName(nameJa)) || null;
    if (rec) by = "施設名（日本語）";
  }

  // シート側で「Kintoneへ反映済み」に印が付いていれば、もう入れない（人の判断を尊重する）
  const sheetDone = cols.done >= 0 && isOn(row[cols.done]);

  const answer = {
    cm: cols.cm >= 0 ? text(row[cols.cm]) : "",
    url: cols.url >= 0 ? text(row[cols.url]) : "",
    id: cols.id >= 0 ? text(row[cols.id]) : "",
    pw: cols.pw >= 0 ? text(row[cols.pw]) : "",
    contract: cols.contract >= 0 ? text(row[cols.contract]) : "",
  };

  const changes = [];
  const skipped = [];
  if (rec) {
    const cmOptions = Object.values(fields?.[TARGETS.cm.code]?.options || {}).map((o) => o.label);
    for (const [k, t] of Object.entries(TARGETS)) {
      const want = answer[k];
      if (!want) continue;
      const now = text(rec?.[t.code]?.value);
      if (now) {
        skipped.push({ label: t.label, why: "すでに値が入っている", now });
        continue;
      }
      if (k === "cm" && cmOptions.length && !cmOptions.includes(want)) {
        skipped.push({ label: t.label, why: "選択肢にない回答", now: want });
        continue;
      }
      changes.push({ key: k, code: t.code, label: t.label, to: want });
    }
  }

  return {
    key,
    index,
    at: text(row[0]),
    hid,
    name,
    nameJa,
    answer,
    matchedBy: by,
    recordId: rec ? String(rec.$id?.value) : null,
    hotel: rec ? text(rec?.[NAME_CODE]?.value) : "",
    changes,
    skipped,
    sheetDone,
    done: prev || null,
    status: !rec
      ? "nomatch"
      : prev?.wrote || sheetDone
      ? "applied"
      : changes.length
      ? "pending"
      : "nochange",
  };
}

async function build() {
  const sheet = await findSheet();
  if (!sheet?.url) return { error: "管理 → フォーム回答 に「CM情報」のシートが登録されていません。" };
  const grid = await cached(`formgrid:${sheet.id}`, 60 * 1000, () => fetchSheetGrid(sheet.url));
  if (grid?.error) return { error: grid.error };

  const snap = await readSnapshot();
  const records = snap?.data?.records || [];
  if (!records.length) return { error: "施設一覧のデータがまだ取り込まれていません。" };

  const cfg = await readCfg();
  const cols = resolveCols(grid.headers, cfg);
  const idx = indexRecords(records);
  const results = await readResults();

  const rows = (grid.rows || []).map((row, i) =>
    planFor(row, cols, idx, i, snap?.data?.fields, results)
  );
  return {
    cols,
    headers: grid.headers,
    rows,
    sheet: { id: sheet.id, title: sheet.title, url: sheet.url },
  };
}

export async function GET() {
  if (!supabaseConfigured()) return NextResponse.json({ error: "Supabase 未設定です" });
  try {
    const out = await build();
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) });
  }
}

// 実際に Kintone へ書く
async function applyOne(plan, who, sheet, cols) {
  if (!plan.recordId || !plan.changes.length) return null;
  const values = {};
  for (const c of plan.changes) values[c.code] = c.to;
  const { revision } = await updateRecord(plan.recordId, values);
  const record = await fetchRecord(plan.recordId);
  if (record) await patchSnapshotRecord(record).catch(() => {});
  await writeEditor(plan.recordId, { name: who, revision }).catch(() => {});
  await writeResult(plan.key, {
    recordId: plan.recordId,
    matchedBy: plan.matchedBy,
    hotel: plan.hotel,
    hid: plan.hid,
    wrote: Object.fromEntries(plan.changes.map((c) => [c.code, c.to])),
    labels: Object.fromEntries(plan.changes.map((c) => [c.code, c.label])),
    at: new Date().toISOString(),
    by: who,
    pinned: !!plan.done?.pinned,
  });
  // シートの「Kintoneへ反映済み」にも印を付ける（シートを見る人にも伝わるように）。
  // 書けなくても Kintone への反映は成立しているので、失敗は理由だけ残す。
  let sheetMark = null;
  if (sheet?.url && cols?.done >= 0) {
    const res = await writeSheetCells(
      sheet.url,
      (rows) => rows.findIndex((r) => text(r?.[0]) === plan.at && (!plan.hid || text(r?.[cols.hid]) === plan.hid)),
      () => [{ col: cols.done, value: "〇" }]
    ).catch((e) => ({ error: String(e?.message || e) }));
    sheetMark = res?.error || "ok";
  }

  return { key: plan.key, recordId: plan.recordId, wrote: plan.changes.length, sheetMark };
}

export async function POST(req) {
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  if (!kintoneConfigured()) return NextResponse.json({ error: "Kintone が未設定です" });
  try {
    const b = await req.json().catch(() => ({}));
    const { session } = await getPerms(req);
    const who = b?.auto ? "フォーム取込（自動）" : session?.name || session?.email || "フォーム取込";

    // ── 取り消し：こちらで入れた値のままなら空に戻す ──
    if (b?.revert) {
      const results = await readResults();
      const r = results[b.revert];
      if (!r?.wrote) return NextResponse.json({ error: "取り消せる記録がありません" });
      const rec = await fetchRecord(r.recordId);
      const values = {};
      for (const [code, v] of Object.entries(r.wrote)) {
        const now = text(rec?.[code]?.value);
        if (now === text(v)) values[code] = "";
      }
      if (!Object.keys(values).length) {
        return NextResponse.json({ error: "入れたあとに値が変わっているため、取り消しませんでした" });
      }
      const { revision } = await updateRecord(r.recordId, values);
      const after = await fetchRecord(r.recordId);
      if (after) await patchSnapshotRecord(after).catch(() => {});
      await writeEditor(r.recordId, { name: who, revision }).catch(() => {});
      await writeResult(b.revert, { ...r, wrote: null, reverted: { at: new Date().toISOString(), by: who } });
      invalidate("records:snapshot");
      invalidate("kintone:basics");
      return NextResponse.json({ ok: true, reverted: Object.keys(values).length });
    }

    // ── 付け替え：別のレコードに入れ直す ──
    if (b?.relink?.key && b?.relink?.id) {
      const results = await readResults();
      const r = results[b.relink.key] || {};
      await writeResult(b.relink.key, {
        ...r,
        recordId: String(b.relink.id),
        pinned: true,
        wrote: null,
        relinked: { at: new Date().toISOString(), by: who },
      });
      // 付け替え先へ入れ直す
      const out = await build();
      const plan = (out.rows || []).find((x) => x.key === b.relink.key);
      const done = plan ? await applyOne(plan, who, out.sheet, out.cols) : null;
      invalidate("records:snapshot");
      invalidate("kintone:basics");
      return NextResponse.json({ ok: true, applied: done ? 1 : 0 });
    }

    // ── 反映 ──
    const out = await build();
    if (out.error) return NextResponse.json({ error: out.error });
    const only = Array.isArray(b?.keys) && b.keys.length ? new Set(b.keys) : null;
    const targets = (out.rows || []).filter(
      (r) => r.status === "pending" && (!only || only.has(r.key))
    );
    const applied = [];
    const failed = [];
    for (const plan of targets) {
      try {
        const d = await applyOne(plan, who, out.sheet, out.cols);
        if (d) applied.push(d);
      } catch (e) {
        failed.push({ key: plan.key, error: String(e?.message || e) });
      }
    }
    if (applied.length) {
      invalidate("records:snapshot");
      invalidate("kintone:records");
      invalidate("kintone:basics");
    }
    return NextResponse.json({ ok: true, applied: applied.length, failed });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) });
  }
}
