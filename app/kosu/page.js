"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DetailTable from "./DetailTable";

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
            } else {
              const upper = yTop < padT + plotH / 2;
              nodes.push(
                <text
                  key={s.key}
                  x={cx}
                  y={upper ? yTop - 7 : yTop + 14}
                  className="zero-lbl"
                  fill={s.color}
                  textAnchor="middle"
                >
                  0% (0h)
                </text>
              );
            }
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

export default function KosuPage() {
  const [resource, setResource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [wi, setWi] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const j = await fetch("/api/resource", { cache: "no-store" }).then((r) => r.json());
      if (j.error) setError(j.error);
      else {
        setResource(j);
        setUpdatedAt(new Date());
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 既定は「データがある最新の週」
  useEffect(() => {
    if (!resource || wi != null) return;
    let last = 0;
    resource.weeks.forEach((_, i) => {
      const has = resource.persons.some(
        (p) => (resource.regular[p]?.[i] || 0) + (resource.adhoc[p]?.[i] || 0) > 0
      );
      if (has) last = i;
    });
    setWi(last);
  }, [resource, wi]);

  const persons = resource?.persons || [];
  const week = resource && wi != null ? resource.weeks[wi] : "";

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
    <div className="wrap page-compact">
      <div className="head">
        <div className="head-left">
          {resource && (
            <span className="conn ok" title="シート接続済み" aria-label="接続済み">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </span>
          )}
        </div>
        <div className="head-right">
          {updatedAt && (
            <span className="updated">
              最終更新：{" "}
              {updatedAt.toLocaleString("ja-JP", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          )}
          <button className="icon-btn" onClick={load} disabled={loading} title="更新" aria-label="更新">
            <svg className={loading ? "spin" : ""} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </div>

      {error ? (
        <div className="card">
          <div className="err">{"取得エラー\n\n" + error}</div>
        </div>
      ) : resource === null || wi == null ? (
        <div className="card">
          <div className="page-loading"><span className="loader-ring" role="status" aria-label="読み込み中" /></div>
        </div>
      ) : (
        <>
          <div className="sec-row">
            <div className="sec-head">作業リソース詳細（{week}）</div>
            <div className="detail-tools">
              <label className="head-year">
                対象週
                <select
                  className="slim-select"
                  value={wi}
                  onChange={(e) => setWi(Number(e.target.value))}
                >
                  {resource.weeks.map((w, i) => (
                    <option key={w + i} value={i}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {/* 担当者管理・作業内容管理はダッシュボードのメニューに、
                工数入力は工数明細の右上に移設 */}
          </div>
          <div className="chart-grid res-row">
            <section className="chart-card">
              <h3 className="chart-title">メンバー別リソース割合</h3>
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

            <section className="chart-card">
              <h3 className="chart-title">Ad Hoc 詳細</h3>
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

          <DetailTable title="工数明細" compact />
        </>
      )}
    </div>
  );
}
