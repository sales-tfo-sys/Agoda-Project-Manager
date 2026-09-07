"use client";

import { useMemo, useState } from "react";
import { holidaysForYear } from "../lib/holidays";

const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const pad2 = (n) => String(n).padStart(2, "0");
const isoOf = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const addMonth = ({ y, m }, delta) => {
  const n = m + delta;
  if (n < 1) return { y: y - 1, m: 12 };
  if (n > 12) return { y: y + 1, m: 1 };
  return { y, m: n };
};
// 月の枠（先頭の空きマス＋日付）を作る
function monthCells(y, m) {
  const startDow = new Date(y, m - 1, 1).getDay(); // 0=日
  const daysInMonth = new Date(y, m, 0).getDate();
  const arr = [];
  for (let i = 0; i < startDow; i++) arr.push(null);
  for (let d = 1; d <= daysInMonth; d++) arr.push(d);
  while (arr.length % 7 !== 0) arr.push(null);
  return arr;
}

// ダッシュボードのスケジュール用カレンダー。日本の祝日（振替休日・国民の休日含む）を表示する。
//   months   … 何か月ぶんを1枠に並べるか（2 なら当月＋翌月）。
//              月送りは枠に1組だけなので、常に連続した月が並ぶ。
//   ym       … 先頭の年月 { y, m }。渡さない場合は自前で持つ（単独利用）。
//   onNav    … 前後の月への移動。onToday … 「今月」。
//   events   … { "YYYY-MM-DD": [...] }。件数のぶんだけ日付に印を出す。
//   selected … 選択中の日付（ISO）。クリックで onSelect(iso) を呼ぶ。
//   range    … { start, end }（ISO）。範囲内の日を薄く塗る（週・月表示のとき）。
export default function Calendar({
  months = 1,
  ym: ymProp = null,
  onNav = null,
  onToday = null,
  events = null,
  selected = null,
  onSelect = null,
  range = null,
}) {
  const today = new Date();
  const baseYm = { y: today.getFullYear(), m: today.getMonth() + 1 };
  const [ymOwn, setYmOwn] = useState(baseYm);
  const ym = ymProp || ymOwn;

  const list = useMemo(
    () => Array.from({ length: Math.max(1, months) }, (_, i) => addMonth(ym, i)),
    [ym, months]
  );
  // 年をまたぐこともあるので、必要な年ぶんだけ祝日表を用意する
  const holByYear = useMemo(() => {
    const m = new Map();
    for (const v of list) if (!m.has(v.y)) m.set(v.y, holidaysForYear(v.y));
    return m;
  }, [list]);

  const shift = (delta) => {
    if (onNav) return onNav(delta);
    setYmOwn((v) => addMonth(v, delta));
  };
  const goToday = () => {
    if (onToday) return onToday();
    setYmOwn(baseYm);
  };

  const isToday = (y, m, d) =>
    d && y === today.getFullYear() && m === today.getMonth() + 1 && d === today.getDate();
  const inRange = (iso) =>
    !!(range && range.start && range.end && iso >= range.start && iso <= range.end);

  return (
    <section className={"cal-card" + (months > 1 ? " cal-multi" : "")}>
      <div className="cal-head">
        <button type="button" className="cal-nav" onClick={() => shift(-1)} aria-label="前の月">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        {months === 1 && (
          <span className="cal-title">
            {ym.y}年 {ym.m}月
          </span>
        )}
        <button type="button" className="cal-nav" onClick={() => shift(1)} aria-label="次の月">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <button type="button" className="cal-today" onClick={goToday}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          今月
        </button>
      </div>

      <div className="cal-months">
        {list.map((v) => {
          const holidays = holByYear.get(v.y);
          const cells = monthCells(v.y, v.m);
          return (
            <div className="cal-month" key={`${v.y}-${v.m}`}>
              {months > 1 && (
                <div className="cal-mtitle">
                  {v.y}年 {v.m}月
                </div>
              )}
              <div className="cal-grid cal-dowrow">
                {DOW.map((d, i) => (
                  <span key={d} className={"cal-dowc" + (i === 0 ? " sun" : i === 6 ? " sat" : "")}>
                    {d}
                  </span>
                ))}
              </div>
              <div className="cal-grid">
                {cells.map((d, idx) => {
                  const dow = idx % 7;
                  const name = d ? holidays.get(`${v.m}-${d}`) || null : null;
                  const iso = d ? isoOf(v.y, v.m, d) : null;
                  const evs = iso && events ? events[iso] || null : null;
                  const cls =
                    "cal-cell" +
                    (d == null ? " empty" : "") +
                    (name || dow === 0 ? " sun" : dow === 6 ? " sat" : "") +
                    (isToday(v.y, v.m, d) ? " today" : "") +
                    (iso && inRange(iso) ? " in-range" : "") +
                    (iso && selected === iso ? " selected" : "");
                  const inner =
                    d != null ? (
                      <>
                        <span className="cal-d">{d}</span>
                        {name && <span className="cal-hol">{name}</span>}
                        {evs && evs.length > 0 && (
                          <span className="cal-mark" aria-label={`予定 ${evs.length} 件`}>
                            <span className="cal-dot" />
                            {evs.length > 1 && <span className="cal-n">{evs.length}</span>}
                          </span>
                        )}
                      </>
                    ) : null;

                  // 選択できるときはボタンにする（キーボードでも日付を選べるように）
                  if (d != null && onSelect) {
                    return (
                      <button
                        type="button"
                        key={idx}
                        className={cls}
                        title={name || undefined}
                        onClick={() => onSelect(iso)}
                        aria-pressed={selected === iso}
                      >
                        {inner}
                      </button>
                    );
                  }
                  return (
                    <span key={idx} className={cls} title={name || undefined}>
                      {inner}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
