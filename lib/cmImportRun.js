// CM情報フォーム → 施設一覧（Kintone）の反映を、実際に走らせる部分。
// 画面（/api/cm-import）と、時間で動く実行（/api/cron/cm-import）の両方から使う。
//
// まとめ書きにしている理由：
//   さかのぼって入れると数百件になる。1件ずつだと Kintone も Supabase も呼びすぎて
//   時間切れになるため、Kintone の一括更新（100件ずつ）と、
//   スナップショット・記録・シートの印は「1回にまとめて」書く。
import { sb, supabaseConfigured } from "./supabase";
import { fetchSheetGrid } from "./formSheet";
import { readSnapshot, patchSnapshotRecords } from "./kintoneSnapshot";
import { updateRecords, fetchRecordsByIds } from "./kintone";
import { writeEditor } from "./kintoneEditor";
import { fetchSheetGridMapped } from "./formSheet";
import { writeCellsApi } from "./googleSheetsApi";
import { cached, invalidate } from "./cache";
import { TARGETS, HID_CODE, NAME_CODE, resolveCols, answerKey, normName, readResults, readCfg } from "./cmImport";

const FORM_TITLE = /CM情報/;
const text = (v) => String(v ?? "").trim();
const isOn = (v) => /^[〇○◯✓✔レ●◎]$/.test(text(v)) || text(v).toUpperCase() === "TRUE";

async function findSheet() {
  const rows = await sb("task_override?scope=eq.form&select=key,data").catch(() => []);
  const list = (rows || []).map((r) => ({ id: r.key, ...(r.data || {}) }));
  return list.find((x) => FORM_TITLE.test(String(x.title || ""))) || null;
}

// 同じ HID の施設が複数あることがある（依頼日や内容が違うだけの別レコード）。
// まとめて紐づけられるよう、HID からは「全部」引けるようにする。
function indexRecords(records) {
  const byHid = new Map(); // HID → レコードの配列（新しい順）
  const byId = new Map();
  for (const r of records) {
    const id = String(r?.$id?.value || "");
    if (id) byId.set(id, r);
    const hid = text(r?.[HID_CODE]?.value);
    if (hid) {
      if (!byHid.has(hid)) byHid.set(hid, []);
      byHid.get(hid).push(r);
    }
  }
  for (const list of byHid.values()) {
    list.sort((a, b) => Number(b.$id?.value || 0) - Number(a.$id?.value || 0));
  }
  return { byHid, byId };
}

// 1回答ぶんの「何をどう入れるか」。
// 施設の紐づけは画面で1件ずつ選ぶ決まりなので、ここでは自動で探さない。
function planFor(row, cols, idx, index, fields, results) {
  const key = answerKey(row, cols, index);
  const hid = cols.hid >= 0 ? text(row[cols.hid]) : "";
  const name = cols.name >= 0 ? text(row[cols.name]) : "";
  const nameJa = cols.nameJa >= 0 ? text(row[cols.nameJa]) : "";
  const prev = results[key] || null;

  // 紐づけは「人が選んだもの」だけ。自動で推測しない（誤った紐づけを避けるため）。
  // 同じ施設で依頼が複数あることがあるので、紐づけ先は複数持てる。
  const recs = (prev?.recordIds || []).map((id) => idx.byId.get(String(id))).filter(Boolean);
  const by = recs.length ? prev?.matchedBy || "選択" : null;

  // 参考：Hotel ID がそのまま一致する施設（自動では紐づけない。まとめて紐づけるときに使う）
  const hidMatches = hid ? (idx.byHid.get(hid) || []).map((r) => String(r.$id?.value)) : [];

  // シート側で「Kintoneへ反映済み」に印が付いていれば、もう入れない
  const sheetDone = cols.done >= 0 && isOn(row[cols.done]);

  const answer = {
    cm: cols.cm >= 0 ? text(row[cols.cm]) : "",
    url: cols.url >= 0 ? text(row[cols.url]) : "",
    id: cols.id >= 0 ? text(row[cols.id]) : "",
    pw: cols.pw >= 0 ? text(row[cols.pw]) : "",
    contract: cols.contract >= 0 ? text(row[cols.contract]) : "",
  };

  // 紐づけた施設ごとに「何を入れるか」を出す（施設によって空いている項目が違う）
  const cmOptions = Object.values(fields?.[TARGETS.cm.code]?.options || {}).map((o) => o.label);
  const links = recs.map((rec) => {
    const id = String(rec.$id?.value);
    const changes = [];
    const skipped = [];
    if (!sheetDone) {
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
      recordId: id,
      hotel: text(rec?.[NAME_CODE]?.value),
      done: !!prev?.applied?.[id]?.wrote,
      changes,
      skipped,
    };
  });
  const changes = links.flatMap((l) => (l.done ? [] : l.changes));
  const skipped = links.flatMap((l) => l.skipped);

  return {
    key,
    index,
    at: text(row[0]),
    hid,
    name,
    nameJa,
    answer,
    matchedBy: by,
    hidMatches,
    hidMatch: hidMatches[0] || null,
    links,
    recordIds: links.map((l) => l.recordId),
    recordId: links[0]?.recordId || null, // 画面の表示用（先頭）
    hotel: links[0]?.hotel || "",
    changes,
    skipped,
    sheetDone,
    done: prev || null,
    status: !links.length
      ? "unlinked"
      : changes.length
      ? "pending"
      : links.some((l) => l.done) || sheetDone
      ? "applied"
      : "nochange",
  };
}

/** 反映の予定を組み立てる（書き込みはしない） */
export async function buildPlan() {
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
  const rows = (grid.rows || []).map((row, i) => planFor(row, cols, idx, i, snap?.data?.fields, results));

  const count = {
    pending: rows.filter((r) => r.status === "pending").length,
    applied: rows.filter((r) => r.status === "applied").length,
    unlinked: rows.filter((r) => r.status === "unlinked").length,
    // Hotel ID が一致していて、まだ紐づけていないもの（まとめて紐づけられる件数）
    linkable: rows.filter((r) => r.status === "unlinked" && r.hidMatches?.length).length,
    nochange: rows.filter((r) => r.status === "nochange").length,
    total: rows.length,
  };
  return { cols, headers: grid.headers, rows, count, sheet: { id: sheet.id, title: sheet.title, url: sheet.url } };
}

/** 結果の記録をまとめて保存する */
async function saveResults(list) {
  if (!supabaseConfigured() || !list.length) return;
  const now = new Date().toISOString();
  const rows = list.map((x) => ({ scope: "cmimp", key: x.key, data: x.data, updated_at: now }));
  for (let i = 0; i < rows.length; i += 100) {
    await sb("task_override?on_conflict=scope,key", {
      method: "POST",
      body: rows.slice(i, i + 100),
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  }
}

/** シートの「Kintoneへ反映済み」に、まとめて印を付ける */
async function markSheet(sheet, cols, plans) {
  if (!sheet?.url || !(cols?.done >= 0) || !plans.length) return null;
  try {
    const grid = await fetchSheetGridMapped(sheet.url);
    if (grid.error) return grid.error;
    const colAt = grid.colMap?.[cols.done];
    if (colAt == null) return "反映済みの列が見つかりません";
    // 回答（タイムスタンプ＋HID）から、シート上の行を引く
    const at = new Map();
    (grid.rows || []).forEach((r, i) => {
      const k = [text(r[0]), cols.hid >= 0 ? text(r[cols.hid]) : ""].filter(Boolean).join("|");
      if (k && !at.has(k)) at.set(k, grid.rowMap?.[i]);
    });
    const cells = [];
    for (const p of plans) {
      const row = at.get(p.key);
      if (row != null) cells.push({ row, col: colAt, value: "〇" });
    }
    if (!cells.length) return null;
    const res = await writeCellsApi(grid.id, grid.gid, cells);
    return res?.error || null;
  } catch (e) {
    return String(e?.message || e);
  }
}

/**
 * 反映を実行する。
 *   plans … buildPlan() の rows（status="pending" のものだけ入れる）
 *   limit … 1回に入れる上限（時間切れを避けるため）
 */
export async function applyPlans(plans, who, sheet, cols, limit = 100) {
  const targets = plans.slice(0, limit);
  if (!targets.length) return { applied: 0, appliedKeys: [], remaining: 0 };

  // 回答 × 紐づけ先レコード に展開する（同じ回答を複数のレコードに入れることがある）。
  // 同じレコードが2回出てくると Kintone の一括更新が通らないので、1回だけにする。
  const seen = new Set();
  const units = [];
  for (const p of targets) {
    for (const l of p.links || []) {
      if (l.done || !l.changes.length) continue;
      if (seen.has(l.recordId)) continue; // 次の回に回す
      seen.add(l.recordId);
      units.push({ p, l });
    }
  }
  if (!units.length) {
    return { applied: 0, appliedKeys: [], remaining: Math.max(0, plans.length - targets.length) };
  }

  // ① Kintone をまとめて更新
  const { revisions } = await updateRecords(
    units.map((u) => ({
      id: u.l.recordId,
      values: Object.fromEntries(u.l.changes.map((c) => [c.code, c.to])),
    }))
  );
  const revById = new Map((revisions || []).map((r) => [String(r.id), String(r.revision)]));

  // ② 入った値を読み直して、保存済みデータ（スナップショット）にも反映
  const after = await fetchRecordsByIds([...seen]).catch(() => []);
  if (after.length) await patchSnapshotRecords(after).catch(() => {});

  // ③ 何をどう入れたかを、回答ごとにまとめて記録する
  const now = new Date().toISOString();
  const byKey = new Map();
  for (const u of units) {
    const prev =
      byKey.get(u.p.key) ||
      {
        ...(u.p.done || {}),
        recordIds: u.p.recordIds,
        pinned: true,
        hid: u.p.hid,
        matchedBy: u.p.matchedBy,
        applied: { ...((u.p.done && u.p.done.applied) || {}) },
      };
    prev.applied[u.l.recordId] = {
      wrote: Object.fromEntries(u.l.changes.map((c) => [c.code, c.to])),
      labels: Object.fromEntries(u.l.changes.map((c) => [c.code, c.label])),
      revision: revById.get(String(u.l.recordId)) || "",
      at: now,
      by: who,
    };
    prev.at = now;
    prev.by = who;
    byKey.set(u.p.key, prev);
  }
  await saveResults([...byKey.entries()].map(([key, data]) => ({ key, data })));

  // ④ 誰が入れたかを、レコード側にも控えておく（詳細の「更新者」に名前を出すため）
  for (const u of units) {
    await writeEditor(u.l.recordId, { name: who, revision: revById.get(String(u.l.recordId)) }).catch(() => {});
  }

  // ⑤ シートの「Kintoneへ反映済み」にも印を付ける（失敗しても反映は成立）
  const sheetError = await markSheet(sheet, cols, [...byKey.keys()].map((k) => ({ key: k })));

  invalidate("records:snapshot");
  invalidate("kintone:records");
  invalidate("kintone:basics");
  return {
    applied: units.length,
    appliedKeys: [...byKey.keys()],
    records: units.length,
    remaining: Math.max(0, plans.length - targets.length),
    sheetError,
  };
}

/**
 * Hotel ID が一致する回答を、まとめて紐づける（そのまま反映まで行う）。
 * 紐づけ先は「HID がそのまま一致する施設」だけ。似ている名前などでは紐づけない。
 */
export async function autolinkByHid(who, { limit = 200 } = {}) {
  const plan = await buildPlan();
  if (plan.error) return { error: plan.error };
  const targets = (plan.rows || [])
    .filter((r) => r.status === "unlinked" && r.hidMatches?.length)
    .slice(0, limit);
  if (!targets.length) return { linked: 0, applied: 0, remaining: 0 };

  // ① 紐づけを記録する（同じ HID の施設が複数あれば、その全部につなぐ）
  const results = await readResults();
  await saveResults(
    targets.map((p) => ({
      key: p.key,
      data: {
        ...(results[p.key] || {}),
        recordIds: p.hidMatches,
        pinned: true,
        matchedBy: "Hotel ID（まとめて紐づけ）",
        hid: p.hid,
        linkedAt: new Date().toISOString(),
        by: who,
      },
    }))
  );

  // ② 紐づけたぶんを、そのまま反映する
  const after = await buildPlan();
  if (after.error) return { linked: targets.length, applied: 0, error: after.error };
  const keys = new Set(targets.map((t) => t.key));
  const pending = (after.rows || []).filter((r) => keys.has(r.key) && r.status === "pending");
  const res = pending.length
    ? await applyPlans(pending, who, after.sheet, after.cols, pending.length)
    : { applied: 0, appliedKeys: [] };
  const left = (after.rows || []).filter((r) => r.status === "unlinked" && r.hidMatches?.length).length;
  return { linked: targets.length, applied: res.applied, appliedKeys: res.appliedKeys || [], remaining: left };
}

/** 予定を作って、反映できるものをまとめて入れる（自動実行用） */
export async function runImport(who, { limit = 100, keys = null } = {}) {
  const plan = await buildPlan();
  if (plan.error) return { error: plan.error };
  let pending = (plan.rows || []).filter((r) => r.status === "pending");
  if (keys && keys.length) {
    const set = new Set(keys);
    pending = pending.filter((r) => set.has(r.key));
  }
  if (!pending.length) return { applied: 0, remaining: 0, count: plan.count };
  const res = await applyPlans(pending, who, plan.sheet, plan.cols, limit);
  return { ...res, count: plan.count };
}
