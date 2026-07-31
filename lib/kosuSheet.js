// 「作業工数管理」シートを、日付ペア（Ad Hoc は 稼働時間＋完了数）まで含めて解析する。
// /api/kosu-import（過去データの取り込み）で使う。
const SHEET_ID =
  process.env.KOSU_SHEET_ID || "1mXUySyokFhE0fjjmSIjmpF2VNKGWZCzEkuwccK9UPwY";
const GID = process.env.KOSU_GID || "1039908240";

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

// "12/8" のような日付ラベルに西暦を割り当てる（末尾を当年、遡って月が増える箇所で年をまたぐ）。
function assignYears(labels, thisYear) {
  const parsed = labels.map((d) => {
    const m = String(d).match(/^(\d{1,2})\s*\/\s*(\d{1,2})/);
    return m ? { m: Number(m[1]), d: Number(m[2]) } : null;
  });
  const years = new Array(parsed.length).fill(null);
  let y = thisYear;
  for (let i = parsed.length - 1; i >= 0; i--) {
    if (!parsed[i]) continue;
    const next = parsed[i + 1];
    if (next && parsed[i].m > next.m) y -= 1;
    years[i] = y;
  }
  return parsed.map((p, i) =>
    p
      ? `${years[i]}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`
      : null
  );
}

const num = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

// シートを解析して、行ごとに {type, content, tanto, days:[{date, v1, v2}]} を返す。
//   v1 = 稼働時間（Ad Hoc）／値（Regular）、 v2 = 完了数（Ad Hoc のみ）
export function parseKosuSheet(text, thisYear) {
  const g = parseCSV(text);
  if (!g.length) return [];
  const header = g[0];

  // ラベルのある列＝日付。その次の列は Ad Hoc の完了数（Regular では空）。
  const dateCols = [];
  for (let c = 6; c < header.length; c++) {
    const label = (header[c] || "").trim();
    if (label) dateCols.push({ c, label });
  }
  const isoDates = assignYears(
    dateCols.map((d) => d.label),
    thisYear
  );

  let curType = "";
  let curDetail = "";
  const out = [];
  for (let r = 1; r < g.length; r++) {
    const row = g[r];
    if (!row) continue;
    const type = (row[1] || "").trim();
    const detail = (row[2] || "").trim();
    const tanto = (row[5] || "").trim();
    if (type) curType = type;
    if (detail) curDetail = detail;
    if (!tanto) continue; // 担当者のいない行（見出し等）はスキップ

    const days = [];
    dateCols.forEach((dc, di) => {
      const iso = isoDates[di];
      if (!iso) return;
      const v1 = num(row[dc.c]);
      const v2 = num(row[dc.c + 1]); // 次の列＝完了数（Ad Hoc）
      if (v1 == null && v2 == null) return;
      days.push({ date: iso, v1, v2 });
    });
    if (!days.length) continue;
    out.push({ type: curType, content: curDetail, tanto, days });
  }
  return out;
}

export async function fetchKosuSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error("シートが公開されていません（リンク共有をご確認ください）");
  }
  return text;
}
