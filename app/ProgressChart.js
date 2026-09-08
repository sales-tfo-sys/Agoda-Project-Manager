"use client";

import { useEffect, useMemo, useState } from "react";

// 進捗グラフ（Regular Task）。案件タイプごとに、受注数・完了・残件数の推移を折れ線で出す。
// 横軸は土日を除いた日付。データは /api/progress-daily から取る。

const SERIES = [
  { key: "rest", label: "残件数", color: "#7fc99b" },
  { key: "total", label: "受注数", color: "#e8443a" },
  { key: "done", label: "完了", color: "#2f4fd8" },
];

// 出すのは直近1か月ぶん（土日を除いた平日22日）
const RECENT_DAYS = 22;

const pad2 = (n) => String(n).padStart(2, "0");
// "2026-09-08" → "2026/09/08"
const fmtDay = (d) => String(d).replace(/-/g, "/");

// 目盛りの間隔（0 と最大値のあいだを、きりのいい数で割る）
function niceStep(max) {
  if (max <= 10) return 2;
  const raw = max / 3;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (mag * m >= raw) return mag * m;
  }
  return mag * 10;
}

function Chart({ title, days, rows }) {
  // 描画領域（viewBox の座標）。実際の大きさは CSS の幅に追従する。
  const W = Math.max(760, 44 + days.length * 34 + 130);
  const H = 330;
  const L = 52; // 左の目盛りぶん
  const R = W - 128; // 右は凡例ぶん空ける
  const T = 26;
  const B = H - 78; // 下は日付ラベルぶん

  const max = Math.max(1, ...rows.map((r) => Math.max(r.total, r.done, r.rest)));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const x = (i) => (days.length === 1 ? (L + R) / 2 : L + ((R - L) * i) / (days.length - 1));
  const y = (v) => B - ((B - T) * v) / top;

  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);

  // 日付ラベルは詰まりすぎないよう間引く
  const labelEvery = Math.ceil(days.length / 24);

  return (
    <div className="pchart">
      <div className="pchart-title">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="pchart-svg" role="img" aria-label={title}>
        {/* 目盛り線 */}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} y1={y(v)} x2={R} y2={y(v)} stroke="#e4e8f0" strokeWidth="1" />
            <text x={L - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" className="pchart-ax">
              {v.toLocaleString("ja-JP")}
            </text>
          </g>
        ))}
        {/* 残件数は棒。折れ線の下に来るよう先に描く */}
        {rows.map((r, i) => {
          const w = Math.min(22, ((R - L) / Math.max(1, days.length)) * 0.55);
          const h = Math.max(0, B - y(r.rest));
          return (
            <rect
              key={"bar" + i}
              x={x(i) - w / 2}
              y={y(r.rest)}
              width={w}
              height={h}
              fill="#7fc99b"
              opacity="0.75"
            />
          );
        })}
        {/* 受注数・完了は折れ線 */}
        {SERIES.filter((s) => s.key !== "rest").map((s) => (
          <g key={s.key}>
            <polyline
              points={rows.map((r, i) => `${x(i)},${y(r[s.key])}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth="1.6"
            />
            {rows.map((r, i) => (
              <circle key={i} cx={x(i)} cy={y(r[s.key])} r="2.6" fill={s.color} />
            ))}
          </g>
        ))}
        {/* 数値。受注数は点の上、完了は下、残件数は一番下にまとめて置く */}
        {rows.map((r, i) => (
          <g key={"v" + i}>
            <text x={x(i)} y={y(r.total) - 8} textAnchor="middle" className="pchart-val" fill="#e8443a">
              {r.total}
            </text>
            <text x={x(i)} y={y(r.done) + 15} textAnchor="middle" className="pchart-val" fill="#2f4fd8">
              {r.done}
            </text>
            <text x={x(i)} y={y(r.rest) - 5} textAnchor="middle" className="pchart-val" fill="#3f8f63">
              {r.rest}
            </text>
          </g>
        ))}
        {/* 日付 */}
        {days.map((d, i) =>
          i % labelEvery === 0 ? (
            <text
              key={d}
              x={x(i)}
              y={B + 30}
              textAnchor="end"
              className="pchart-day"
              transform={`rotate(-60 ${x(i)} ${B + 30})`}
            >
              {fmtDay(d)}
            </text>
          ) : null
        )}
        {/* 凡例 */}
        {SERIES.map((s, i) => (
          <g key={"lg" + s.key} transform={`translate(${R + 18} ${T + 12 + i * 20})`}>
            <rect x="0" y="-6" width="10" height="10" rx="2" fill={s.color} />
            <text x="16" y="0" dominantBaseline="middle" className="pchart-lg">
              {s.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function ProgressChart({ year, dateCode, types }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!year) return;
    let alive = true;
    setData(null);
    setError(null);
    const q = `year=${year}&date=${encodeURIComponent(dateCode || "作成日時")}`;
    fetch(`/api/progress-daily?${q}`, { cache: "no-store" })
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

  const view = useMemo(() => {
    if (!data?.days?.length) return null;
    const from = Math.max(0, data.days.length - RECENT_DAYS);
    const days = data.days.slice(from);
    const byType = {};
    for (const t of data.types || []) {
      byType[t] = (data.series[t] || []).slice(from).map((v) => ({
        total: v.total,
        done: v.done,
        rest: Math.max(0, v.total - v.done),
      }));
    }
    return { days, byType };
  }, [data]);

  // 表示する案件タイプ（進捗表と同じ並び。IHM は Ad Hoc 扱いなので出さない）
  const shown = useMemo(() => {
    const all = view ? Object.keys(view.byType) : [];
    const order = (types || []).filter((t) => all.includes(t));
    return order.length ? order : all.filter((t) => t !== "IHM");
  }, [view, types]);

  if (error) {
    return (
      <div className="card">
        <div className="err">{"取得エラー\n\n" + error}</div>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="card">
        <div className="page-loading">
          <span className="loader-ring" role="status" aria-label="集計中" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="sec-row">
        <span className="pchart-note">※直近1か月（土日を除いた平日）を表示しています。</span>
      </div>
      {shown.length === 0 ? (
        <div className="card">
          <div className="notice">この年のデータがありません。</div>
        </div>
      ) : (
        shown.map((t) => (
          <div className="card pchart-card" key={t}>
            <Chart title={`${year}年_${t}`} days={view.days} rows={view.byType[t]} />
          </div>
        ))
      )}
    </>
  );
}
