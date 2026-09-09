"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chart, RECENT_DAYS, applyOrder, useCardDrag, Grip } from "./ProgressChart";

// Ad Hoc Task の進捗グラフ。対応中（On Track / Behind / Onhold）のタスクを、
// Regular と同じ見た目（受注数・完了の折れ線＋残件数の棒）で出す。
//
// 件数は連携先シートの「今の値」しか読めないので、過去に遡って数え直すことはできない。
// 画面を開いたその日の値を記録していき、記録より前は担当が付けていた記録を取り込んである。
// IHM_Room / IHM_Plan / IHM_CM だけは Kintone から数え直せるので記録が無くても線が出る。

export const ONGOING = ["On Track", "Behind", "Onhold"];

export default function AdhocChart({
  year,
  dateCode,
  tasks,
  known,
  hidden, // 「進捗グラフに出さない」設定のタスク名（Set）
  groups, // タスク名 → まとめ先の名前（同じ名前どうしを1枚にする）
  gridRef: outerRef,
  order,
  onReorder,
}) {
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

  // グラフ1枚ぶんを組み立てる。
  //   ・「まとめ先」が設定されているタスクは、同じ名前どうしを1枚にして足し合わせる
  //   ・直近1か月ぶんだけ切り出し、記録が始まる前の日は線を引かない
  const shown = useMemo(() => {
    if (!data?.days?.length) return [];
    const from = Math.max(0, data.days.length - RECENT_DAYS);
    const days = data.days.slice(from);

    // グラフ1枚＝1ユニット。まとめ先があればその名前、無ければタスク名で1枚。
    const units = [];
    const byUnit = new Map();
    const add = (key, label, member) => {
      let u = byUnit.get(key);
      if (!u) {
        u = { key, label, members: [] };
        byUnit.set(key, u);
        units.push(u);
      }
      u.members.push(member);
    };
    for (const t of tasks || []) {
      if (hidden?.has?.(t.key)) continue;
      const g = String(groups?.[t.key] || "").trim();
      add(g || t.key, g || t.label, t.key);
    }
    // 表の行には無いけれど記録があるもの（過去に取り込んだ記録など）も後ろに並べる
    const inList = new Set((tasks || []).map((t) => t.key));
    for (const key of Object.keys(data.series || {})) {
      if (inList.has(key) || known?.has?.(key) || hidden?.has?.(key) || byUnit.has(key)) continue;
      add(key, key, key);
    }

    // Kintone から数え直しているもの（IHM）は Regular と同じく年単位なので、年を付ける
    const kintone = new Set(data.kintone || []);
    const out = [];
    // 保存した並びがあればそれを優先する
    for (const k of applyOrder(units.map((u) => u.key), order)) {
      const u = byUnit.get(k);
      if (!u) continue;
      // まとめているときは、全員に値がある日だけ足す（欠けたまま足すと数が減って見えるため）
      const lists = u.members.map((m) => data.series?.[m] || null);
      const part = days.map((_, i) => {
        const vs = lists.map((l) => l && l[from + i]);
        if (vs.some((v) => !v)) return null;
        return {
          total: vs.reduce((a, v) => a + v.total, 0),
          done: vs.reduce((a, v) => a + v.done, 0),
        };
      });
      const start = part.findIndex((v) => v);
      if (start < 0) continue; // この期間はまだ記録がない
      out.push({
        key: u.key,
        label: kintone.has(u.key) ? `${year}年_${u.label}` : u.label,
        days: days.slice(start),
        rows: part.slice(start).map((v) => ({
          total: v.total,
          done: v.done,
          rest: Math.max(0, v.total - v.done),
        })),
      });
    }
    return out;
  }, [data, tasks, known, hidden, groups, year, order]);

  const drag = useCardDrag(
    shown.map((c) => c.key),
    onReorder
  );

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
        <div className={"card pchart-card" + drag.cardClass(c.key)} key={c.key} {...drag.cardProps(c.key)}>
          <Chart
            title={c.label}
            days={c.days}
            rows={c.rows}
            grip={drag.enabled ? <Grip {...drag.gripProps(c.key)} /> : null}
          />
        </div>
      ))}
    </div>
  );
}
