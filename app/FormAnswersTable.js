"use client";

import { useEffect, useMemo, useState } from "react";

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

// 直せるセル。入力欄から外れたとき（または Enter）に保存する。
function CellInput({ value, onSave, title }) {
  const [v, setV] = useState(String(value ?? ""));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setV(String(value ?? ""));
  }, [value]);
  const commit = async () => {
    const next = v.trim();
    if (busy || next === String(value ?? "").trim()) return;
    setBusy(true);
    try {
      await onSave(next);
    } finally {
      setBusy(false);
    }
  };
  return (
    <input
      className={"forms-cell-in" + (busy ? " busy" : "")}
      value={v}
      title={title}
      disabled={busy}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setV(String(value ?? ""));
      }}
    />
  );
}

// 行の左端に出す印（施設一覧と紐づいているか）
function MarkIcon({ mark }) {
  if (!mark) return null;
  const tone = mark.tone || "link";
  return (
    <span className={"forms-mark m-" + tone} title={mark.title || ""}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {tone === "done" ? (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="m8 12.3 2.6 2.6L16 9.6" />
          </>
        ) : tone === "warn" ? (
          <>
            <path d="M12 4.5 2.8 20h18.4Z" />
            <path d="M12 10v4M12 17.2v.1" />
          </>
        ) : (
          <>
            <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
            <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
          </>
        )}
      </svg>
    </span>
  );
}

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

// 隠す列（0始まりの列番号）を、隣り合うものごとにまとめる。
// まとまりごとに1つのボタンにして、押すと開く／閉じるができるようにする。
function groupsOf(hiddenCols) {
  const list = [...new Set((hiddenCols || []).map(Number))]
    .filter((n) => Number.isInteger(n) && n >= 0)
    .sort((a, b) => a - b);
  const groups = [];
  for (const c of list) {
    const last = groups[groups.length - 1];
    if (last && c === last[last.length - 1] + 1) last.push(c);
    else groups.push([c]);
  }
  return groups;
}

/**
 * headers / rows … 表の中身（rows は filterFormRows の戻り値）
 * checkCols      … detectCheckCols の結果（省略時は TRUE/FALSE のセルだけチェック表示）
 * onToggle       … (rowIdx, colIdx, text) => Promise。渡すと押して切り替えられる
 * hiddenCols     … 初めは隠しておく列（0始まり）。見出しのボタンで開閉できる
 * centerCols     … 中身を中央ぞろえにする列（0始まり）
 * marks          … { 行番号(0始まり): { tone, title } } … 行の左端に出す印
 * editCols       … 文字で直せる列（0始まり）。onEditCell と一緒に渡す
 * onEditCell     … (rowIdx, colIdx, text) => Promise。入力を確定したときに呼ばれる
 */
export default function FormAnswersTable({
  headers,
  rows,
  q,
  checkCols,
  onToggle,
  hiddenCols,
  centerCols,
  marks,
  editCols,
  onEditCell,
}) {
  // いま書き込み中のセル（"行-列"）。二重に押せないようにする
  const [busy, setBusy] = useState(null);
  // 開いている列のまとまり（まとまりの先頭の列番号で覚える）
  const [openCols, setOpenCols] = useState([]);
  const groups = useMemo(() => groupsOf(hiddenCols), [hiddenCols]);
  // 列番号 → そこから始まるまとまり
  const groupAt = useMemo(() => {
    const m = new Map();
    for (const g of groups) m.set(g[0], g);
    return m;
  }, [groups]);
  const hidden = useMemo(() => {
    const set = new Set();
    for (const g of groups) if (!openCols.includes(g[0])) for (const c of g) set.add(c);
    return set;
  }, [groups, openCols]);
  const toggleGroup = (start) =>
    setOpenCols((v) => (v.includes(start) ? v.filter((x) => x !== start) : [...v, start]));
  const centered = useMemo(() => new Set((centerCols || []).map(Number)), [centerCols]);
  const editable = useMemo(() => new Set((editCols || []).map(Number)), [editCols]);

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
              {marks && <th className="forms-mark-col" title="施設一覧との紐づけ" />}
              {headers.map((h, ci) => {
                const g = groupAt.get(ci);
                // 閉じているまとまりは、見出しを1つの「開く」ボタンにまとめる
                if (g && hidden.has(ci)) {
                  return (
                    <th key={ci} className="forms-colfold">
                      <button
                        type="button"
                        className="fold-btn"
                        onClick={() => toggleGroup(ci)}
                        title={`${g.length}列を開く`}
                        aria-label={`隠している${g.length}列を開く`}
                      >
                        <span className="fold-n">{g.length}</span>
                        <span className="fold-ar" aria-hidden="true">›</span>
                      </button>
                    </th>
                  );
                }
                if (hidden.has(ci)) return null;
                return (
                  <th key={ci} className={centered.has(ci) ? "forms-center" : undefined}>
                    {g && (
                      <button
                        type="button"
                        className="fold-btn in-head"
                        onClick={() => toggleGroup(ci)}
                        title={`${g.length}列を閉じる`}
                        aria-label={`この${g.length}列を閉じる`}
                      >
                        <span className="fold-ar" aria-hidden="true">‹</span>
                      </button>
                    )}
                    {h || ""}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, no }) => (
              <tr key={no}>
                <td className="forms-rownum">{no}</td>
                {marks && (
                  <td className="forms-mark-col">
                    <MarkIcon mark={marks[no - 1]} />
                  </td>
                )}
                {headers.map((_, ci) => {
                  if (hidden.has(ci)) {
                    // 閉じているまとまりは、行でも1つのセルにまとめる
                    return groupAt.has(ci) ? (
                      <td key={ci} className="forms-colfold" aria-hidden="true">
                        ⋯
                      </td>
                    ) : null;
                  }
                  const v = r[ci] ?? "";
                  // 直せる列は入力欄にする（いまは Hotel ID だけ）
                  if (editable.has(ci) && onEditCell) {
                    return (
                      <td key={ci} className="forms-edit-cell">
                        <CellInput
                          value={v}
                          onSave={(next) => onEditCell(no - 1, ci, next)}
                          title={headers[ci] || ""}
                        />
                      </td>
                    );
                  }
                  // 印の列かどうか。列ごとの判定（checkCols）があればそれを優先する。
                  // 無いときは、そのセルが TRUE/FALSE のときだけチェック表示（元の動き）。
                  const b = String(v).trim().toUpperCase();
                  const col =
                    checkCols?.[ci] || (b === "TRUE" || b === "FALSE" ? { kind: "bool" } : null);
                  if (!col) {
                    return (
                      <td
                        key={ci}
                        className={centered.has(ci) ? "forms-center" : undefined}
                        title={v || undefined}
                      >
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
