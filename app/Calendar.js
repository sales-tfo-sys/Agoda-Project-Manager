"use client";

import { useMemo, useState } from "react";
import { holidaysForYear } from "../lib/holidays";

const DOW = ["日", "月", "火", "水", "木", "金", "土"];

// ダッシュボード用の月間カレンダー。日本の祝日（振替休日・国民の休日含む）を表示する。
export default function Calendar() {
  const today = new Date();
  const [ym, setYm] = useState({ y: today.getFullYear(), m: today.getMonth() + 1 });
  const holidays = useMemo(() => holidaysForYear(ym.y), [ym.y]);

  const cells = useMemo(() => {
    const startDow = new Date(ym.y, ym.m - 1, 1).getDay(); // 0=日
    const daysInMonth = new Date(ym.y, ym.m, 0).getDate();
    const arr = [];
    for (let i = 0; i < startDow; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [ym]);

  const prev = () => setYm(({ y, m }) => (m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }));
  const next = () => setYm(({ y, m }) => (m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 }));
  const toToday = () => setYm({ y: today.getFullYear(), m: today.getMonth() + 1 });

  const isToday = (d) =>
    d &&
    ym.y === today.getFullYear() &&
    ym.m === today.getMonth() + 1 &&
    d === today.getDate();
  const holOf = (d) => (d ? holidays.get(`${ym.m}-${d}`) || null : null);

  return (
    <section className="cal-card">
      <div className="cal-head">
        <button type="button" className="cal-nav" onClick={prev} aria-label="前の月">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="cal-title">
          {ym.y}年 {ym.m}月
        </span>
        <button type="button" className="cal-nav" onClick={next} aria-label="次の月">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <button type="button" className="cal-today" onClick={toToday}>
          今月
        </button>
      </div>

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
          const name = holOf(d);
          const cls =
            "cal-cell" +
            (d == null ? " empty" : "") +
            (name || dow === 0 ? " sun" : dow === 6 ? " sat" : "") +
            (isToday(d) ? " today" : "");
          return (
            <span key={idx} className={cls} title={name || undefined}>
              {d != null && (
                <>
                  <span className="cal-d">{d}</span>
                  {name && <span className="cal-hol">{name}</span>}
                </>
              )}
            </span>
          );
        })}
      </div>
    </section>
  );
}
