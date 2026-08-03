import { cached } from "../../../lib/cache";
import { sb, sbAll, supabaseConfigured } from "../../../lib/supabase";

// 週次リソース（Regular / Ad Hoc 工数配分・担当者別）を返す API。
//   通常は工数入力（kosu_entry）から集計する（スプレッドシート非依存）。
//   まだ入力データが無いときだけ、作業リソースシートを読む（移行前の互換）。
const SHEET_ID =
  process.env.KOSU_SHEET_ID || "1mXUySyokFhE0fjjmSIjmpF2VNKGWZCzEkuwccK9UPwY";
const GID = process.env.RESOURCE_GID || "940408510";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────
// ① 工数入力（Supabase）から集計
// ─────────────────────────────────────────────
const dkey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

// その日が属する「週の月曜日」を返す
const mondayOf = (isoDate) => {
  const d = new Date(isoDate + "T00:00:00");
  const back = (d.getDay() + 6) % 7; // 月=0 … 日=6
  d.setDate(d.getDate() - back);
  d.setHours(0, 0, 0, 0);
  return d;
};

async function computeFromEntries() {
  const [entries, tasks, personsRaw] = await Promise.all([
    // 1000件上限を超える全件を取り切る（安定した並びで offset ページング）
    sbAll(
      "kosu_entry?select=entry_date,task_id,person_id,value&order=entry_date,task_id,person_id"
    ),
    sb("kosu_task?select=id,task_type,content"),
    sb("kosu_person?active=eq.true&order=sort_order&select=id,name,role"),
  ]);
  if (!Array.isArray(entries) || entries.length === 0) return null;
  // オーナー・管理者は作業者ではないのでリソース集計に含めない
  const persons = (Array.isArray(personsRaw) ? personsRaw : []).filter(
    (p) => !["owner", "admin"].includes(p.role || "member")
  );
  if (persons.length === 0) return null;

  const nameById = new Map(persons.map((p) => [p.id, p.name]));
  const taskById = new Map((tasks || []).map((t) => [t.id, t]));
  const personNames = persons.map((p) => p.name);

  // 週の一覧（最小〜最大の月曜日まで連続で並べる）
  let minM = null;
  let maxM = null;
  for (const e of entries) {
    const m = mondayOf(String(e.entry_date).slice(0, 10));
    if (!minM || m < minM) minM = m;
    if (!maxM || m > maxM) maxM = m;
  }
  const weeks = [];
  const weekIndex = new Map(); // 月曜キー → 週インデックス
  for (let d = new Date(minM); d <= maxM; d.setDate(d.getDate() + 7)) {
    const end = new Date(d);
    end.setDate(end.getDate() + 6);
    const label = `${d.getMonth() + 1}/${d.getDate()}〜${end.getMonth() + 1}/${end.getDate()}`;
    weekIndex.set(dkey(d), weeks.length);
    weeks.push(label);
  }

  const mk = () =>
    Object.fromEntries(personNames.map((n) => [n, new Array(weeks.length).fill(0)]));
  const regular = mk();
  const adhoc = mk();
  const detailMap = new Map(); // Ad Hoc 作業内容 → per

  for (const e of entries) {
    const name = nameById.get(e.person_id);
    if (!name) continue;
    const t = taskById.get(e.task_id);
    if (!t) continue;
    const wk = weekIndex.get(dkey(mondayOf(String(e.entry_date).slice(0, 10))));
    if (wk == null) continue;
    const v = Number(e.value) || 0;
    if (/regular/i.test(t.task_type || "")) {
      // Regular は「作業時間」など時間(h)で記録した分だけをリソース工数に数える。
      // メール・荷電・Kintone登録などの件数(count)は工数(時間)ではないので合算しない。
      if (t.unit === "time") regular[name][wk] += v;
    } else if (/ad\s*hoc/i.test(t.task_type || "")) {
      // Ad Hoc は value が稼働時間(h)。件数は done_count 側なので value をそのまま使う。
      adhoc[name][wk] += v;
      if (!detailMap.has(t.content)) detailMap.set(t.content, mk());
      detailMap.get(t.content)[name][wk] += v;
    }
    // その他（トータル作業時間など）は日次の合計値なので、二重計上を避けて集計しない。
  }

  const adhocDetail = [...detailMap.entries()]
    .map(([label, per]) => ({ label, per }))
    // 全週ゼロの作業は出さない
    .filter((d) => personNames.some((n) => (d.per[n] || []).some((x) => x > 0)));

  return { weeks, persons: personNames, regular, adhoc, adhocDetail, source: "supabase" };
}

// ─────────────────────────────────────────────
// ② 作業リソースシート（フォールバック：入力データが無いとき）
// ─────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\n") {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      } else if (c === "\r") {
        // skip
      } else cur += c;
    }
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

const SHEET_PERSONS = ["田中", "長内", "原"];
function personOf(h) {
  if (!h) return null;
  for (const p of SHEET_PERSONS) if (h.includes(p)) return p;
  return null;
}

function buildFromSheet(text) {
  const g = parseCSV(text);
  if (!g.length) return { weeks: [], persons: SHEET_PERSONS, regular: {}, adhoc: {} };
  const hdr = g[0];
  const weeks = [];
  const colWeek = [];
  let curWeek = -1;
  for (let c = 1; c < hdr.length; c++) {
    const h = (hdr[c] || "").trim();
    const p = personOf(h);
    if (!p) continue;
    const label = h.replace(p, "").trim();
    if (label) {
      weeks.push(label);
      curWeek = weeks.length - 1;
    }
    if (curWeek >= 0) colWeek[c] = { w: curWeek, p };
  }
  const findRow = (name) => g.find((r) => (r[0] || "").trim() === name);
  const seriesFrom = (rowName) => {
    const r = findRow(rowName);
    const per = {};
    for (const p of SHEET_PERSONS) per[p] = new Array(weeks.length).fill(0);
    if (r) {
      colWeek.forEach((cw, c) => {
        if (!cw) return;
        const n = Number(r[c]);
        if (!Number.isNaN(n) && r[c] !== "") per[cw.p][cw.w] += n;
      });
    }
    return per;
  };
  const seen = new Set();
  const adhocDetail = [];
  for (let r = 1; r < g.length; r++) {
    const row = g[r];
    const label = (row?.[0] || "").trim();
    if (!label || label === "Regular" || label === "Ad Hoc") continue;
    if (seen.has(label)) continue;
    seen.add(label);
    const per = {};
    for (const p of SHEET_PERSONS) per[p] = new Array(weeks.length).fill(0);
    let any = false;
    colWeek.forEach((cw, c) => {
      if (!cw) return;
      const raw = row[c];
      if (raw === "" || raw == null) return;
      const s = String(raw);
      if (s.includes("%") || s.startsWith("#")) return;
      const n = Number(s);
      if (Number.isNaN(n)) return;
      per[cw.p][cw.w] += n;
      if (n) any = true;
    });
    if (any) adhocDetail.push({ label, per });
  }
  return {
    weeks,
    persons: SHEET_PERSONS,
    regular: seriesFrom("Regular"),
    adhoc: seriesFrom("Ad Hoc"),
    adhocDetail,
    source: "google-sheet",
  };
}

export async function GET() {
  // ① 工数入力から集計（データがあればこちら＝シート非依存）
  if (supabaseConfigured()) {
    try {
      const computed = await computeFromEntries();
      if (computed) return Response.json(computed);
    } catch {
      /* 失敗時はシートにフォールバック */
    }
  }

  // ② まだ入力データが無い → 作業リソースシートを読む（移行前の互換）
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`;
  try {
    const text = await cached("sheet:resource", 3 * 60 * 1000, async () => {
      const res = await fetch(url, { next: { revalidate: 300 } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    });
    if (text.trimStart().startsWith("<")) {
      return Response.json(
        { error: "シートが公開されていません（リンク共有をご確認ください）" },
        { status: 200 }
      );
    }
    return Response.json(buildFromSheet(text));
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
