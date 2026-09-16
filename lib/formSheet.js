// 公開Googleスプレッドシート（フォーム回答シート等）を1タブまるごと読み取り、
// 表として返す。タブは URL の gid で特定し、export?format=csv の生グリッドを使う。
// 認証は使わない＝対象シートは「リンクを知っている全員が閲覧可」である必要がある。
import { extractSheetId, extractGid } from "./sheetCell";
import { googleServiceConfigured, readGridApi } from "./googleSheetsApi";

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

// 生グリッド（2次元配列）→ { headers, rows, total, truncated, colMap, rowMap }。
// 末尾の空行・「中身が一切ない列」は表示しない。
// colMap/rowMap は「表に出している位置 → シート上の位置（0始まり）」の対応。
// シートに書き戻すときに、表の位置から元のセルを割り出すために使う。
function buildResult(grid, maxRows) {
  // 末尾の空行を落とす
  while (grid.length && grid[grid.length - 1].every((c) => String(c || "").trim() === "")) {
    grid.pop();
  }
  if (!grid.length) {
    return { headers: [], rows: [], total: 0, truncated: false, colMap: [], rowMap: [] };
  }
  const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  // 中身のある列だけ残す（空欄だけの列は出さない）
  const keep = [];
  for (let c = 0; c < cols; c++) {
    if (grid.some((r) => String(r[c] || "").trim() !== "")) keep.push(c);
  }
  const pick = (r) => keep.map((c) => (r[c] == null ? "" : r[c]));
  const headers = pick(grid[0]);
  // 行はシート上の位置（見出しの次の行が 1）を持ったまま絞り込む
  let body = grid.slice(1).map((r, i) => ({ cells: pick(r), at: i + 1 }));
  // 先頭列（フォーム回答のタイムスタンプ等）が空の「末尾の行」を落とす。
  // フォーム外の数式などで右側の列だけ値が入り、見かけ上の空行になるのを防ぐ。
  let last = body.length - 1;
  while (last >= 0 && String(body[last].cells[0] ?? "").trim() === "") last--;
  body = body.slice(0, last + 1);
  // 途中に残った完全な空行も表示しない
  body = body.filter((r) => r.cells.some((c) => String(c || "").trim() !== ""));
  const shown = body.slice(0, maxRows);
  return {
    headers,
    rows: shown.map((r) => r.cells),
    total: body.length,
    truncated: body.length > shown.length,
    colMap: keep,
    rowMap: shown.map((r) => r.at),
  };
}

// URLのシートを取得し { headers, rows, total, truncated } を返す。取得不能は { error }。
//   サービスアカウントが設定されていれば Sheets API（非公開シート可）で読む。
//   未設定なら従来どおり export CSV（リンク共有シート）で読む。
export async function fetchSheetGrid(url, { maxRows = 1000 } = {}) {
  const r = await fetchSheetGridRaw(url, { maxRows });
  if (r.error) return r;
  // 位置の対応表は画面では使わないので、送る中身には入れない
  const { colMap, rowMap, ...rest } = r;
  return rest;
}

// 上と同じものを、位置の対応表（colMap / rowMap）付きで返す。
// シートへ書き戻すときだけ使う。書き込みはサービスアカウントが要るので、
// 公開CSV経由で読んでいる場合は対応表を作れない＝エラーにする。
export async function fetchSheetGridMapped(url, { maxRows = 5000 } = {}) {
  const id = extractSheetId(url);
  if (!id) return { error: "URL からスプレッドシートを特定できません" };
  const gid = extractGid(url);
  if (!googleServiceConfigured()) {
    return {
      error:
        "シートへの書き込みには Google サービスアカウントの設定が必要です（GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY）。",
    };
  }
  const r = await readGridApi(id, gid);
  if (r.error) return { error: r.error };
  return { ...buildResult(r.grid || [], maxRows), id, gid };
}

async function fetchSheetGridRaw(url, { maxRows = 1000 } = {}) {
  const id = extractSheetId(url);
  if (!id) return { error: "URL からスプレッドシートを特定できません" };
  const gid = extractGid(url);

  if (googleServiceConfigured()) {
    const r = await readGridApi(id, gid);
    if (r.error) return { error: r.error };
    return buildResult(r.grid || [], maxRows);
  }

  const g = gid ? `&gid=${encodeURIComponent(gid)}` : "";
  const u = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${g}`;
  const res = await fetch(u, { cache: "no-store", redirect: "follow" });
  if (res.status === 401 || res.status === 403) {
    return {
      error:
        "このシートは非公開です。サービスアカウントに共有＋環境変数を設定して再デプロイするか、リンク共有にしてください。",
    };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    return {
      error:
        "このシートは非公開です。サービスアカウントに共有＋環境変数を設定して再デプロイするか、リンク共有にしてください。",
    };
  }
  return buildResult(parseCsvGrid(text), maxRows);
}
