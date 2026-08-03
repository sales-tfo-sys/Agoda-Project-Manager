// 公開Googleスプレッドシートの「特定タブ・特定セル」を1つ読むためのヘルパー。
// タブは URL の gid で特定し、export?format=csv で“生グリッド”を取得する。
// （gviz は先頭の空行/空列を詰めて位置がずれるため使わない）
// 認証は使わない＝対象シートは「リンクを知っている全員が閲覧可」である必要がある。

// スプレッドシートURL → シートID（.../spreadsheets/d/<ID>/... を抜き出す）
export function extractSheetId(url) {
  const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

// URL からタブの gid を抜き出す（#gid=123 / ?gid=123 / &gid=123）。無ければ null（=先頭タブ）
export function extractGid(url) {
  const m = String(url || "").match(/[#?&]gid=(\d+)/);
  return m ? m[1] : null;
}

// 列文字 → 番号（A=1, B=2, … Z=26, AA=27 …）
function colToNum(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// "B2" → { col:2, row:2 }。解釈できなければ null
function parseA1(cell) {
  const m = String(cell || "").trim().match(/^([A-Za-z]+)\s*(\d+)$/);
  if (!m) return null;
  return { col: colToNum(m[1]), row: Number(m[2]) };
}

// 簡易CSVパーサ（引用符対応）→ 2次元配列
function parseCsvGrid(text) {
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
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else if (c !== "\r") cur += c;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

// 指定タブ(gid)のセル(cell 例:"C2")の値を文字列で返す。取得不能は null。
export async function fetchSheetCell(id, gid, cell) {
  if (!id || !cell) return null;
  const pos = parseA1(cell);
  if (!pos) return null;
  const g = gid ? `&gid=${encodeURIComponent(gid)}` : "";
  const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${g}`;
  const res = await fetch(url, { cache: "no-store", redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) return null; // 非公開などでHTMLが返った
  const grid = parseCsvGrid(text);
  const v = grid[pos.row - 1]?.[pos.col - 1];
  return v == null || v === "" ? null : String(v).trim();
}
