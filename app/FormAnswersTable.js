"use client";

import { useState } from "react";

// フォーム回答（スプレッドシート）の回答を表で出す。
// 管理 → フォーム回答 と、作業依頼の Temairazu タブで同じものを使う。
//
// onToggle を渡すと、印の列（〇 ✖ -）とチェック欄（TRUE/FALSE）を画面から切り替えられる。
// 切り替えた内容は呼び出し側でスプレッドシートに書き戻す。

// 印の書き方はシートによってゆれるので、3つの状態にまとめて扱う。
//   on   … 〇（○ や ✓ もこれに含める）
//   off  … ✖（× や ✕ もこれに含める）
//   none … 未入力（シートの空欄。画面では「-」と出す）
const MARK_ON = /^[〇○◯✓✔レ●◎]$/;
const MARK_OFF = /^[×✕✖✗✘☓]$/;
const MARK_NONE = /^[-－ー―‐]$/;

const MARK_TEXT = { on: "〇", off: "✖", none: "-" }; // 画面に出す印
const MARK_WRITE = { on: "〇", off: "✖", none: "" }; // シートに入れる値（none は空欄）
const MARK_NEXT = { on: "off", off: "none", none: "on" }; // 押したときの順番

// セルの中身 → 状態。印ではない（自由入力の）ときは null
function markStateOf(v) {
  const s = String(v ?? "").trim();
  if (!s || MARK_NONE.test(s)) return "none";
  const u = s.toUpperCase();
  if (MARK_ON.test(s) || u === "TRUE") return "on";
  if (MARK_OFF.test(s) || u === "FALSE") return "off";
  return null;
}

// 検索に当たった行だけを返す。番号は元のままにして、シートと突き合わせられるようにする。
// q は全部の列を対象にした部分一致（大文字小文字は区別しない）。
export function filterFormRows(grid, q) {
  const rows = grid?.rows || [];
  const kw = String(q || "").trim().toLowerCase();
  const all = rows.map((r, ri) => ({ r, no: ri + 1 }));
  if (!kw) return all;
  return all.filter(({ r }) => r.some((v) => String(v ?? "").toLowerCase().includes(kw)));
}

/**
 * 「印の列」を見つける。列ごとに全部の行を見て、入っている値が
 * TRUE/FALSE だけ、または 〇 ✖ - などの印だけなら、その列は印の列とみなす。
 * 空欄しかない列は、見出しだけでは判断できないので対象外。
 * 返り値: { 列番号: { kind: "bool" | "mark" } }
 *   bool … スプレッドシートのチェックボックス（TRUE/FALSE）。四角のチェックで出す
 *   mark … 〇 ✖ で運用している列。シートと同じ印のまま出す
 */
export function detectCheckCols(grid) {
  const rows = grid?.rows || [];
  const headers = grid?.headers || [];
  const out = {};
  headers.forEach((_, ci) => {
    let bool = 0;
    let mark = 0;
    let other = 0;
    for (const r of rows) {
      const s = String(r?.[ci] ?? "").trim();
      if (!s) continue;
      const u = s.toUpperCase();
      if (u === "TRUE" || u === "FALSE") bool++;
      else if (MARK_ON.test(s) || MARK_OFF.test(s) || MARK_NONE.test(s)) mark++;
      else other++;
      if (other) break;
    }
    if (other || bool + mark === 0) return;
    out[ci] = { kind: bool >= mark ? "bool" : "mark" };
  });
  return out;
}

/**
 * headers / rows … 表の中身（rows は filterFormRows の戻り値）
 * checkCols      … detectCheckCols の結果（省略時は TRUE/FALSE のセルだけチェック表示）
 * onToggle       … (rowIdx, colIdx, text) => Promise。渡すと押して切り替えられる
 */
export default function FormAnswersTable({ headers, rows, q, checkCols, onToggle }) {
  // いま書き込み中のセル（"行-列"）。二重に押せないようにする
  const [busy, setBusy] = useState(null);

  const toggle = async (rowIdx, ci, text) => {
    if (!onToggle || busy) return;
    const k = `${rowIdx}-${ci}`;
    setBusy(k);
    try {
      await onToggle(rowIdx, ci, text);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card no-pad">
      <div className="tw forms-tw">
        <table>
          <thead>
            <tr>
              <th className="forms-rownum">#</th>
              {headers.map((h, ci) => (
                <th key={ci}>{h || ""}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, no }) => (
              <tr key={no}>
                <td className="forms-rownum">{no}</td>
                {headers.map((_, ci) => {
                  const v = r[ci] ?? "";
                  // 印の列かどうか。列ごとの判定（checkCols）があればそれを優先する。
                  // 無いときは、そのセルが TRUE/FALSE のときだけチェック表示（元の動き）。
                  const b = String(v).trim().toUpperCase();
                  const col =
                    checkCols?.[ci] || (b === "TRUE" || b === "FALSE" ? { kind: "bool" } : null);
                  if (!col) {
                    return (
                      <td key={ci} title={v || undefined}>
                        {v}
                      </td>
                    );
                  }
                  const st = markStateOf(v) || "none";
                  const rowIdx = no - 1;
                  const k = `${rowIdx}-${ci}`;

                  // 〇 ✖ - で運用している列は、チェックの四角ではなくその印のまま出す
                  if (col.kind === "mark") {
                    const next = MARK_NEXT[st];
                    return (
                      <td key={ci} className="forms-check-cell" title={v || undefined}>
                        {onToggle ? (
                          <button
                            type="button"
                            className={`forms-mark m-${st}` + (busy === k ? " busy" : "")}
                            onClick={() => toggle(rowIdx, ci, MARK_WRITE[next])}
                            disabled={!!busy}
                            aria-label={`${headers[ci] || ""}：${MARK_TEXT[st]}（押すと ${MARK_TEXT[next]} になります）`}
                            title="押すと 〇 → ✖ → - の順に切り替わります（シートにも反映されます）"
                          >
                            {MARK_TEXT[st]}
                          </button>
                        ) : (
                          <span className={`forms-mark m-${st}`}>{MARK_TEXT[st]}</span>
                        )}
                      </td>
                    );
                  }

                  // スプレッドシートのチェックボックス（TRUE/FALSE）の列
                  const on = st === "on";
                  return (
                    <td key={ci} className="forms-check-cell" title={v || undefined}>
                      {onToggle ? (
                        <button
                          type="button"
                          className={"forms-check is-btn" + (on ? " on" : "") + (busy === k ? " busy" : "")}
                          onClick={() => toggle(rowIdx, ci, on ? "FALSE" : "TRUE")}
                          disabled={!!busy}
                          aria-pressed={on}
                          aria-label={(headers[ci] || "チェック") + (on ? "：チェックあり" : "：チェックなし")}
                          title="押すとシートのチェックも切り替わります"
                        />
                      ) : (
                        <span
                          className={"forms-check" + (on ? " on" : "")}
                          role="img"
                          aria-label={on ? "チェックあり" : "チェックなし"}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && q && (
          <div className="notice forms-empty">「{q}」に当てはまる回答はありません。</div>
        )}
      </div>
    </div>
  );
}
