// 公開Googleスプレッドシート（フォーム回答シート等）を1タブまるごと読み取り、
// 表として返す。タブは URL の gid で特定し、export?format=csv の生グリッドを使う。
// 認証は使わない＝対象シートは「リンクを知っている全員が閲覧可」である必要がある。
import { extractSheetId, extractGid } from "./sheetCell";

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

// URLのシートを取得し { headers, rows, total, truncated } を返す。取得不能は { error }。
export async function fetchSheetGrid(url, { maxRows = 1000 } = {}) {
  const id = extractSheetId(url);
  if (!id) return { error: "URL からスプレッドシートを特定できません" };
  const gid = extractGid(url);
  const g = gid ? `&gid=${encodeURIComponent(gid)}` : "";
  const u = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${g}`;
  const res = await fetch(u, { cache: "no-store", redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    return { error: "シートが公開されていません（リンクを知っている全員が閲覧可 にしてください）" };
  }
  const grid = parseCsvGrid(text);
  // 末尾の空行を落とす
  while (grid.length && grid[grid.length - 1].every((c) => String(c || "").trim() === "")) {
    grid.pop();
  }
  if (!grid.length) return { headers: [], rows: [], total: 0, truncated: false };
  // 列数を最大行にそろえる
  const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const norm = (r) => {
    const a = r.slice(0, cols);
    while (a.length < cols) a.push("");
    return a;
  };
  const headers = norm(grid[0]);
  const body = grid.slice(1).map(norm);
  const rows = body.slice(0, maxRows);
  return { headers, rows, total: body.length, truncated: body.length > rows.length };
}
