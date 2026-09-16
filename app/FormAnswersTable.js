"use client";

import { useState } from "react";

// フォーム回答（スプレッドシート）の回答を表で出す。
// 管理 → フォーム回答 と、作業依頼の Temairazu タブで同じものを使う。
//
// onToggle を渡すと、チェック欄を画面から切り替えられる。
// 切り替えた内容は呼び出し側でスプレッドシートに書き戻す。

// 〇 や ✓ など「付いている」印。× や － は「付いていない」印
const MARK_ON = /^[〇○◯✓✔レ●◎]$/;
const MARK_OFF = /^[×✕✖✗✘☓＊－ー-]$/;

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
 * 「チェック欄の列」を見つける。列ごとに全部の行を見て、
 * 入っている値が TRUE/FALSE だけ、または 〇 ✖ などの印だけなら、その列はチェック欄とみなす。
 * 空欄しかない列は、見出しだけでは判断できないので対象外。
 * あわせて、その列で実際に使われている「付いている印／付いていない印」も覚えておき、
 * 切り替えたときに同じ書き方でシートへ入れる（〇 の列なら ✖ ではなく、その列の書き方に合わせる）。
 * 返り値: { 列番号: { kind:"bool"|"mark", on:"〇", off:"✖" } }
 */
export function detectCheckCols(grid) {
  const rows = grid?.rows || [];
  const headers = grid?.headers || [];
  const out = {};
  headers.forEach((_, ci) => {
    let bool = 0;
    let mark = 0;
    let other = 0;
    const ons = new Map();
    const offs = new Map();
    const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    for (const r of rows) {
      const s = String(r?.[ci] ?? "").trim();
      if (!s) continue;
      const u = s.toUpperCase();
      if (u === "TRUE" || u === "FALSE") bool++;
      else if (MARK_ON.test(s)) {
        mark++;
        bump(ons, s);
      } else if (MARK_OFF.test(s)) {
        mark++;
        bump(offs, s);
      } else other++;
      if (other) break;
    }
    if (other || bool + mark === 0) return;
    if (bool >= mark) {
      out[ci] = { kind: "bool", on: "TRUE", off: "FALSE" };
      return;
    }
    // いちばん多く使われている印に合わせる。無ければ 〇 と 空欄
    const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    out[ci] = { kind: "mark", on: top(ons) || "〇", off: top(offs) || "" };
  });
  return out;
}

// そのセルにチェックが付いているか
function isOn(v) {
  const s = String(v ?? "").trim();
  if (!s) return false;
  if (s.toUpperCase() === "TRUE") return true;
  if (s.toUpperCase() === "FALSE") return false;
  return MARK_ON.test(s);
}

// 切り替えたときにシートへ入れる値
function textFor(col, on) {
  if (!col) return on ? "TRUE" : "FALSE";
  return on ? col.on ?? "〇" : col.off ?? "";
}

/**
 * headers / rows … 表の中身（rows は filterFormRows の戻り値）
 * checkCols      … detectCheckCols の結果（省略時は TRUE/FALSE のセルだけチェック表示）
 * onToggle       … (rowIdx, colIdx, next, text) => Promise。渡すと押して切り替えられる
 */
export default function FormAnswersTable({ headers, rows, q, checkCols, onToggle }) {
  // いま書き込み中のセル（"行-列"）。二重に押せないようにする
  const [busy, setBusy] = useState(null);

  const toggle = async (rowIdx, ci, next, text) => {
    if (!onToggle || busy) return;
    const k = `${rowIdx}-${ci}`;
    setBusy(k);
    try {
      await onToggle(rowIdx, ci, next, text);
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
                  // チェック欄かどうか。列ごとの判定（checkCols）があればそれを優先する。
                  // 無いときは、そのセルが TRUE/FALSE のときだけチェック表示（元の動き）。
                  const b = String(v).trim().toUpperCase();
                  const col =
                    checkCols?.[ci] ||
                    (b === "TRUE" || b === "FALSE" ? { kind: "bool", on: "TRUE", off: "FALSE" } : null);
                  if (!col) {
                    return (
                      <td key={ci} title={v || undefined}>
                        {v}
                      </td>
                    );
                  }
                  const on = isOn(v);
                  const rowIdx = no - 1;
                  const k = `${rowIdx}-${ci}`;
                  // 〇 ✖ で運用している列は、チェックの四角ではなく、その印のまま出す
                  if (col.kind === "mark") {
                    const mark = on ? col.on || "〇" : col.off || "";
                    return (
                      <td key={ci} className="forms-check-cell" title={v || undefined}>
                        {onToggle ? (
                          <button
                            type="button"
                            className={
                              "forms-mark" + (on ? " on" : " off") + (busy === k ? " busy" : "")
                            }
                            onClick={() => toggle(rowIdx, ci, !on, textFor(col, !on))}
                            disabled={!!busy}
                            aria-pressed={on}
                            aria-label={(headers[ci] || "") + (on ? "：" + mark : "：" + (mark || "空欄"))}
                            title="押すと切り替わります（シートにも反映されます）"
                          >
                            {mark || "－"}
                          </button>
                        ) : (
                          <span className={"forms-mark" + (on ? " on" : " off")}>{mark}</span>
                        )}
                      </td>
                    );
                  }
                  return (
                    <td key={ci} className="forms-check-cell" title={v || undefined}>
                      {onToggle ? (
                        <button
                          type="button"
                          className={"forms-check is-btn" + (on ? " on" : "") + (busy === k ? " busy" : "")}
                          onClick={() => toggle(rowIdx, ci, !on, textFor(col, !on))}
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
