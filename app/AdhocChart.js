"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chart, RECENT_DAYS } from "./ProgressChart";

// Ad Hoc Task の進捗グラフ。対応中（On Track / Behind / Onhold）のタスクを、
// Regular と同じ見た目（受注数・完了の折れ線＋残件数の棒）で出す。
//
// 件数は連携先シートの「今の値」しか読めないので、過去に遡って数え直すことはできない。
// 画面を開いたその日の値を記録していき、記録より前は担当が付けていた記録を取り込んである。
// IHM_Room / IHM_Plan / IHM_CM だけは Kintone から数え直せるので記録が無くても線が出る。

export const ONGOING = ["On Track", "Behind", "Onhold"];

export default function AdhocChart({ year, dateCode, tasks, known, gridRef: outerRef }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const innerRef = useRef(null);
  const gridRef = outerRef || innerRef;

  useEffect(() => {
    if (!year) return;
    let alive = true;
    setData(null);
    setError(null);
    const q = `year=${year}&date=${encodeURIComponent(dateCode || "作成日時")}`;
    fetch(`/api/adhoc-daily?${q}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.error) setError(j.error);
        setData(j);
      })
      .catch((e) => alive && setError(String(e?.message || e)));
    return () => {
      alive = false;
    };
  }, [year, dateCode]);

  // タスクごとに直近1か月ぶんを切り出す。
  // 記録が始まる前の日は線を引かない（その日ぶんだけ手前を捨てる）。
  const shown = useMemo(() => {
    if (!data?.days?.length) return [];
    const from = Math.max(0, data.days.length - RECENT_DAYS);
    const days = data.days.slice(from);
    // 表の対応中タスクに加えて、表の行には無いけれど記録があるもの（担当が
    // プロジェクト単位で付けていた記録）も後ろに並べる。
    const list = [...(tasks || [])];
    const inList = new Set(list.map((t) => t.key));
    for (const key of Object.keys(data.series || {})) {
      if (inList.has(key) || known?.has?.(key)) continue;
      list.push({ key, label: key });
    }

    // Kintone から数え直しているもの（IHM）は Regular と同じく年単位なので、年を付ける
    const kintone = new Set(data.kintone || []);
    const out = [];
    for (const t of list) {
      const all = data.series?.[t.key];
      if (!all) continue;
      const part = all.slice(from);
      const start = part.findIndex((v) => v);
      if (start < 0) continue; // この期間はまだ記録がない
      out.push({
        key: t.key,
        label: kintone.has(t.key) ? `${year}年_${t.label}` : t.label,
        days: days.slice(start),
        rows: part.slice(start).map((v) => ({
          total: v.total,
          done: v.done,
          rest: Math.max(0, v.total - v.done),
        })),
      });
    }
    return out;
  }, [data, tasks, known, year]);

  if (error) {
    return (
      <div className="card">
        <div className="err">{"取得エラー\n\n" + error}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="card">
        <div className="page-loading">
          <span className="loader-ring" role="status" aria-label="集計中" />
        </div>
      </div>
    );
  }
  if (!shown.length) {
    return (
      <div className="card">
        <div className="notice">
          この期間に記録のある対応中タスクがありません。
          <br />
          Ad Hoc の件数はシートの「今の値」しか読めないため、ダッシュボードを開いた日から
          1日ずつ記録していきます。
        </div>
      </div>
    );
  }

  return (
    <div className="pchart-grid" ref={gridRef}>
      {shown.map((c) => (
        <div className="card pchart-card" key={c.key}>
          <Chart title={c.label} days={c.days} rows={c.rows} />
        </div>
      ))}
    </div>
  );
}
