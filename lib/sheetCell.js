// 公開Googleスプレッドシートの「特定シート・特定セル」を1つ読むためのヘルパー。
// gviz エンドポイント（CSV）を使う。認証は使わない＝対象シートは
// 「リンクを知っている全員が閲覧可」である必要がある。
//
// 注意：gviz は range に単一セル（例 "B2"）を渡すと空を返す仕様がある。
// そのため A1 から目的セルまでの範囲を取得し、そのグリッドから該当セルを取り出す。

// スプレッドシートURL → シートID（.../spreadsheets/d/<ID>/... を抜き出す）
export function extractSheetId(url) {
  const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

// 列文字 → 番号（A=1, B=2, … Z=26, AA=27 …）
function colToNum(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
// 番号 → 列文字
function numToCol(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
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

// 指定シート(sheetName)のセル(cell 例:"B2")の値を文字列で返す。取得不能は null。
// gviz は range 指定だと末尾の空行/空列を詰めて位置がずれるため、
// タブ全体を headers=0 で取得（＝生グリッド）して該当セルを取り出す。
export async function fetchSheetCell(id, sheetName, cell) {
  if (!id || !cell) return null;
  const pos = parseA1(cell);
  if (!pos) return null;
  const params = new URLSearchParams({ tqx: "out:csv", headers: "0" });
  if (sheetName) params.set("sheet", sheetName);
  const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) return null; // 非公開などでHTMLが返った
  const grid = parseCsvGrid(text);
  const v = grid[pos.row - 1]?.[pos.col - 1];
  return v == null || v === "" ? null : String(v).trim();
}
