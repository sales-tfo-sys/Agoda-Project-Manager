"use client";

// 作業リソース詳細（メンバー別リソース割合 / Ad Hoc 詳細 / 担当者別 内訳）。
// もとは「作業工数管理」ページにあったが、ダッシュボードの「作業工数表」タブの「グラフ」へ移した。
// 対象週のプルダウンはダッシュボードのヘッダーに置くので、
// データと週の状態は useResource() で外に出し、見た目だけをこの部品が持つ。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CopyChartBtn from "./CopyChartBtn";
import { cachedJson } from "../dataCache";

const REGULAR_COLOR = "#8fb4e3";
const ADHOC_COLOR = "#e79a9a";
const DETAIL_COLORS = [
  "#12a594",
  "#5b8dff",
  "#d9822b",
  "#8b6ad6",
  "#c0567a",
  "#3f9e4d",
  "#5a6b85",
];

// 100%積み上げ棒（メンバー別）。0%の系列はスタック位置にラベルだけ表示（シート再現）
function Stacked100({ persons, series, valuesFor, height = 250 }) {
  const W = 520;
  const H = height;
  const padL = 40;
  const padR = 10;
  const padT = 22;
  const padB = 46; // 0%ラベルと担当者名が重ならないよう下側に余白を確保
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const band = plotW / Math.max(1, persons.length);
  const barW = Math.min(74, band * 0.5);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img">
      {[0, 25, 50, 75, 100].map((p) => {
        const y = padT + plotH - (p / 100) * plotH;
        return (
          <g key={p}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} className="grid-line" />
            <text x={padL - 7} y={y + 3} className="axis-txt" textAnchor="end">
              {p}%
            </text>
          </g>
        );
      })}
      {persons.map((p, pi) => {
        const vals = valuesFor(p) || {};
        const total = series.reduce((a, s) => a + (vals[s.key] || 0), 0);
        const cx = padL + band * pi + band / 2;
        const bx = cx - barW / 2;
        let acc = 0;
        const nodes = [];
        if (total > 0) {
          for (const s of series) {
            const v = vals[s.key] || 0;
            const yBottom = padT + plotH - (acc / total) * plotH;
            acc += v;
            const yTop = padT + plotH - (acc / total) * plotH;
            const h = yBottom - yTop;
            const pct = Math.round((v / total) * 1000) / 10;
            const label = `${pct % 1 === 0 ? pct : pct.toFixed(1)}% (${v}h)`;
            if (v > 0) {
              nodes.push(
                <g key={s.key}>
                  <rect x={bx} y={yTop} width={barW} height={h} fill={s.color} />
                  {h >= 20 && (
                    <text x={cx} y={yTop + h / 2 + 4} className="stack-lbl" textAnchor="middle">
                      {label}
                    </text>
                  )}
                </g>
              );
            }
            // 0% の系列は非表示（ラベルも出さない）
          }
        } else {
          nodes.push(
            <text key="none" x={cx} y={padT + plotH / 2} className="axis-txt" textAnchor="middle">
              データなし
            </text>
          );
        }
        return (
          <g key={p}>
            {nodes}
            <text x={cx} y={H - 10} className="axis-txt" textAnchor="middle">
              {p}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function SideLegend({ items }) {
  return (
    <div className="side-legend">
      {items.map((it) => (
        <span key={it.label} className="legend-item">
          <span className="legend-dot" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/**
 * 作業リソース（/api/resource）と「対象週」の状態。
 * active が false のあいだは取りに行かない（タブを開くまで読み込まない）。
 */
export function useResource(active = true) {
  const [resource, setResource] = useState(null);
  const [error, setError] = useState(null);
  const [wi, setWi] = useState(null);

  useEffect(() => {
    if (!active || resource) return;
    let alive = true;
    cachedJson("/api/resource")
      .then((j) => {
        if (!alive) return;
        if (j?.error) setError(j.error);
        else setResource(j);
      })
      .catch((e) => {
        if (alive) setError(String(e?.message || e));
      });
    return () => {
      alive = false;
    };
  }, [active, resource]);

  // 既定は「今週」。今週がデータに無ければ「データがある最新の週」。
  useEffect(() => {
    if (!resource || wi != null) return;
    // 今週の月曜〜日曜のラベルを作り、週一覧から探す（APIと同じ書式）
    const now = new Date();
    const mon = new Date(now);
    mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    const end = new Date(mon);
    end.setDate(end.getDate() + 6);
    const label = `${mon.getMonth() + 1}/${mon.getDate()}〜${end.getMonth() + 1}/${end.getDate()}`;
    let idx = resource.weeks.indexOf(label);
    if (idx < 0) {
      let last = 0;
      resource.weeks.forEach((_, i) => {
        const has = resource.persons.some(
          (p) => (resource.regular[p]?.[i] || 0) + (resource.adhoc[p]?.[i] || 0) > 0
        );
        if (has) last = i;
      });
      idx = last;
    }
    setWi(idx);
  }, [resource, wi]);

  // 週の表示は「2026/09/07 ～ 2026/09/13」。
  // シート取り込み側など weekRanges が無い場合は元のラベルをそのまま出す。
  const weekLabel = useCallback(
    (i) => {
      const r = resource?.weekRanges?.[i];
      if (!r) return resource?.weeks?.[i] ?? "";
      const f = (v) => String(v).replace(/-/g, "/");
      return `${f(r.start)} ～ ${f(r.end)}`;
    },
    [resource]
  );

  const weekOptions = useMemo(
    () => (resource?.weeks || []).map((_, i) => ({ value: i, label: weekLabel(i) })),
    [resource, weekLabel]
  );

  return { resource, error, wi, setWi, weekLabel, weekOptions, ready: !!resource && wi != null };
}

export default function ResourceCharts({ resource, wi, weekLabel }) {
  const mainChartRef = useRef(null);
  const detailChartRef = useRef(null);
  const persons = resource?.persons || [];

  const mainSeries = useMemo(
    () => [
      { key: "regular", label: "Regular", color: REGULAR_COLOR },
      { key: "adhoc", label: "Ad Hoc", color: ADHOC_COLOR },
    ],
    []
  );
  const mainValues = useCallback(
    (p) =>
      resource && wi != null
        ? { regular: resource.regular[p]?.[wi] || 0, adhoc: resource.adhoc[p]?.[wi] || 0 }
        : {},
    [resource, wi]
  );
  const detailSeries = useMemo(() => {
    if (!resource || wi == null) return [];
    return (resource.adhocDetail || [])
      .filter((d) => persons.some((p) => (d.per[p]?.[wi] || 0) > 0))
      .map((d, i) => ({
        key: d.label,
        label: d.label,
        color: DETAIL_COLORS[i % DETAIL_COLORS.length],
      }));
  }, [resource, wi, persons]);
  const detailValues = useCallback(
    (p) => {
      const o = {};
      if (!resource || wi == null) return o;
      for (const d of resource.adhocDetail || []) o[d.label] = d.per[p]?.[wi] || 0;
      return o;
    },
    [resource, wi]
  );
  const rows = useMemo(() => {
    if (!resource || wi == null) return [];
    return persons.map((p) => {
      const reg = resource.regular[p]?.[wi] || 0;
      const ad = resource.adhoc[p]?.[wi] || 0;
      const tot = reg + ad;
      return {
        p,
        reg,
        ad,
        tot,
        regPct: tot ? Math.round((reg / tot) * 100) : 0,
        adPct: tot ? Math.round((ad / tot) * 100) : 0,
      };
    });
  }, [resource, wi, persons]);

  return (
    <div className="chart-grid res-row">
      <section className="chart-card" ref={mainChartRef}>
        <div className="chart-head">
          <h3 className="chart-title">メンバー別リソース割合（{weekLabel(wi)}）</h3>
          {/* 期間はタイトルに入っているので、コピー画像に副題は出さない */}
          <CopyChartBtn targetRef={mainChartRef} />
        </div>
        <div className="chart-with-legend">
          <Stacked100 persons={persons} series={mainSeries} valuesFor={mainValues} />
          <SideLegend
            items={[
              { label: "Ad Hoc", color: ADHOC_COLOR },
              { label: "Regular", color: REGULAR_COLOR },
            ]}
          />
        </div>
      </section>

      <section className="chart-card" ref={detailChartRef}>
        <div className="chart-head">
          <h3 className="chart-title">Ad Hoc 詳細（{weekLabel(wi)}）</h3>
          {detailSeries.length > 0 && <CopyChartBtn targetRef={detailChartRef} />}
        </div>
        {detailSeries.length === 0 ? (
          <div className="notice">この週の Ad Hoc 作業はありません。</div>
        ) : (
          <div className="chart-with-legend">
            <Stacked100 persons={persons} series={detailSeries} valuesFor={detailValues} />
            <SideLegend items={detailSeries.map((s) => ({ label: s.label, color: s.color }))} />
          </div>
        )}
      </section>

      {/* 報告メール用の数値表（同じ行の3つ目） */}
      <section className="chart-card res-card">
        <h3 className="chart-title">担当者別 内訳</h3>
        <table className="dtable res-table">
          <thead>
            <tr>
              <th className="l">担当</th>
              <th>Regular</th>
              <th>Regular比率</th>
              <th>Ad Hoc</th>
              <th>Ad Hoc比率</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.p}>
                <td className="l">{r.p}</td>
                <td>{r.reg}h</td>
                <td>{r.regPct}%</td>
                <td>{r.ad}h</td>
                <td>{r.adPct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
