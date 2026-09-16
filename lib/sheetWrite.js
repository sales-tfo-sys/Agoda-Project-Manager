// 画面の表で入力した値を、元のスプレッドシートのセルに書き戻す。
//
// 表は「空の列を詰める」「空行を飛ばす」ので、画面の位置とシートの位置はずれる。
// そのため fetchSheetGridMapped で位置の対応表（colMap / rowMap）を受け取り、
// それを使ってシート上の本当のセルを割り出してから書く。
//
// ※書き込みには Google サービスアカウントの設定と、
//   対象シートを「編集者」で共有しておくことが必要。
import { fetchSheetGridMapped } from "./formSheet";
import { writeCellsApi } from "./googleSheetsApi";

/**
 * url      … 対象シートのURL（タブは #gid で指定）
 * findRow  … (rows) => 画面の行番号（0始まり）。見つからなければ -1
 * cellsOf  … (grid) => [{ col, value }] col は画面の列番号（0始まり）
 * 返り値: { ok: true } / { error: "..." }
 */
export async function writeSheetCells(url, findRow, cellsOf) {
  const grid = await fetchSheetGridMapped(url);
  if (grid.error) return { error: grid.error };

  const ri = findRow(grid.rows || [], grid);
  if (ri == null || ri < 0) {
    return { error: "シートの中に対象の行が見つかりませんでした（画面を開き直してお試しください）" };
  }
  const rowAt = grid.rowMap?.[ri];
  if (rowAt == null) {
    return { error: "シートの中に対象の行が見つかりませんでした（画面を開き直してお試しください）" };
  }

  const wanted = cellsOf(grid) || [];
  const cells = [];
  for (const w of wanted) {
    if (w == null || w.col == null || w.col < 0) continue; // その列がシートに無いときは書かない
    const colAt = grid.colMap?.[w.col];
    if (colAt == null) continue;
    cells.push({ row: rowAt, col: colAt, value: w.value });
  }
  if (!cells.length) return { ok: true, skipped: true };

  return writeCellsApi(grid.id, grid.gid, cells);
}
