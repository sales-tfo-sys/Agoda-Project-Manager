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

function indexRecords(records) {
  const byHid = new Map();
  const byName = new Map();
  const byId = new Map();
  for (const r of records) {
    const id = Number(r?.$id?.value || 0);
    byId.set(String(id), r);
    const hid = text(r?.[HID_CODE]?.value);
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

// 1回答ぶんの「何をどう入れるか」
function planFor(row, cols, idx, index, fields, results) {
  const key = answerKey(row, cols, index);
  const hid = cols.hid >= 0 ? text(row[cols.hid]) : "";
  const name = cols.name >= 0 ? text(row[cols.name]) : "";
  const nameJa = cols.nameJa >= 0 ? text(row[cols.nameJa]) : "";
  const prev = results[key] || null;

  let rec = null;
  let by = null;
  if (prev?.recordId && prev?.pinned) {
    rec = idx.byId.get(String(prev.recordId)) || null;
    if (rec) by = "指定";
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

  // シート側で「Kintoneへ反映済み」に印が付いていれば、もう入れない
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
  if (rec && !sheetDone) {
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
    nomatch: rows.filter((r) => r.status === "nomatch").length,
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
  if (!targets.length) return { applied: 0, remaining: 0 };

  // ① Kintone をまとめて更新
  const list = targets.map((p) => ({
    id: p.recordId,
    values: Object.fromEntries(p.changes.map((c) => [c.code, c.to])),
  }));
  const { revisions } = await updateRecords(list);
  const revById = new Map((revisions || []).map((r) => [String(r.id), String(r.revision)]));

  // ② 入った値を読み直して、保存済みデータ（スナップショット）にも反映
  const ids = [...new Set(targets.map((p) => p.recordId))];
  const after = await fetchRecordsByIds(ids).catch(() => []);
  if (after.length) await patchSnapshotRecords(after).catch(() => {});

  // ③ 何をどう入れたかを記録（あとから取り消せるように）
  const now = new Date().toISOString();
  await saveResults(
    targets.map((p) => ({
      key: p.key,
      data: {
        recordId: p.recordId,
        matchedBy: p.matchedBy,
        hotel: p.hotel,
        hid: p.hid,
        wrote: Object.fromEntries(p.changes.map((c) => [c.code, c.to])),
        labels: Object.fromEntries(p.changes.map((c) => [c.code, c.label])),
        revision: revById.get(String(p.recordId)) || "",
        at: now,
        by: who,
        pinned: !!p.done?.pinned,
      },
    }))
  );

  // ④ シートの「Kintoneへ反映済み」にも印を付ける（失敗しても反映は成立）
  const sheetError = await markSheet(sheet, cols, targets);

  invalidate("records:snapshot");
  invalidate("kintone:records");
  invalidate("kintone:basics");
  return {
    applied: targets.length,
    appliedKeys: targets.map((p) => p.key),
    remaining: Math.max(0, plans.length - targets.length),
    sheetError,
  };
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
