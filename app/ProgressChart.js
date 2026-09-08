"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
// 年はタイトルに出ているので、軸は「月/日」だけにして詰める
const fmtDay = (d) => String(d).slice(5).replace("-", "/");

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

// 画像にするとき用。SVG は外部のCSSを読まないので、同じ見た目を中に書き込む。
const SVG_CSS = `
  .pchart-ax{font:700 12px system-ui,sans-serif;fill:#6b7280}
  .pchart-val{font:700 11px system-ui,sans-serif}
  .pchart-day{font:600 11px system-ui,sans-serif;fill:#6b7280}
  .pchart-lg{font:700 12px system-ui,sans-serif;fill:#374151}
`;

// SVG を1枚の画像として読み込む
function svgToImage(svg) {
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = SVG_CSS;
  clone.insertBefore(style, clone.firstChild);
  const src =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(new XMLSerializer().serializeToString(clone));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("グラフを画像にできませんでした"));
    img.src = src;
  });
}

// 画面に出ているグラフを全部まとめて1枚の画像にする（2列に並べる）
export async function chartsToBlob(root) {
  const blocks = [...root.querySelectorAll(".pchart")];
  if (!blocks.length) throw new Error("グラフが見つかりません");
  const PAD = 16;
  const GAP = 16;
  const TITLE_H = 30;
  const CELL_W = 900; // 1枚あたりの幅（読みやすさ優先で大きめ）
  const COLS = blocks.length > 1 ? 2 : 1;

  const items = [];
  for (const b of blocks) {
    const svg = b.querySelector("svg");
    const vb = svg.viewBox.baseVal;
    const h = Math.round((CELL_W * vb.height) / vb.width);
    items.push({ title: b.querySelector(".pchart-title")?.textContent.trim() || "", svg, h });
  }
  const rowH = [];
  for (let i = 0; i < items.length; i += COLS) {
    rowH.push(Math.max(...items.slice(i, i + COLS).map((it) => it.h)) + TITLE_H);
  }
  const W = PAD * 2 + CELL_W * COLS + GAP * (COLS - 1);
  const H = PAD * 2 + rowH.reduce((a, b) => a + b, 0) + GAP * (rowH.length - 1);

  const cv = document.createElement("canvas");
  cv.width = W * 2;
  cv.height = H * 2;
  const ctx = cv.getContext("2d");
  ctx.scale(2, 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  let y = PAD;
  for (let i = 0; i < items.length; i += COLS) {
    const row = items.slice(i, i + COLS);
    for (let c = 0; c < row.length; c++) {
      const it = row[c];
      const x = PAD + c * (CELL_W + GAP);
      ctx.fillStyle = "#1a2540";
      ctx.font = "800 21px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(it.title, x + 18, y + TITLE_H / 2);
      const img = await svgToImage(it.svg);
      ctx.drawImage(img, x, y + TITLE_H, CELL_W, it.h);
    }
    y += rowH[i / COLS] + GAP;
  }
  return new Promise((resolve, reject) =>
    cv.toBlob((b) => (b ? resolve(b) : reject(new Error("画像を作れませんでした"))), "image/png")
  );
}

function Chart({ title, days, rows }) {
  // 描画領域（viewBox の座標）。実際の大きさは CSS の幅に追従する。
  const W = Math.max(680, 62 + days.length * 26 + 126);
  const H = 320;
  const L = 62; // 左の目盛りぶん（数値が線と重ならないよう広めに取る）
  const R = W - 126; // 右は凡例ぶん空ける
  const T = 26;
  const B = H - 66; // 下は日付ラベルぶん

  const max = Math.max(1, ...rows.map((r) => Math.max(r.total, r.done, r.rest)));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  // 棒の幅ぶん内側に寄せて、左端の目盛りと重ならないようにする
  const barW = Math.min(20, ((R - L) / Math.max(1, days.length)) * 0.6);
  const inset = barW / 2 + 4;
  const x = (i) =>
    days.length === 1
      ? (L + R) / 2
      : L + inset + ((R - L - inset * 2) * i) / (days.length - 1);
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
            <text x={L - 14} y={y(v)} textAnchor="end" dominantBaseline="middle" className="pchart-ax">
              {v.toLocaleString("ja-JP")}
            </text>
          </g>
        ))}
        {/* 残件数は棒。折れ線の下に来るよう先に描く */}
        {rows.map((r, i) => {
          const w = barW;
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
              y={B + 26}
              textAnchor="end"
              className="pchart-day"
              transform={`rotate(-45 ${x(i)} ${B + 26})`}
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
  const gridRef = useRef(null);

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
        <CopyChartsBtn targetRef={gridRef} />
      </div>
      {shown.length === 0 ? (
        <div className="card">
          <div className="notice">この年のデータがありません。</div>
        </div>
      ) : (
        <div className="pchart-grid" ref={gridRef}>
          {shown.map((t) => (
            <div className="card pchart-card" key={t}>
              <Chart title={`${year}年_${t}`} days={view.days} rows={view.byType[t]} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// グラフをまとめて画像でコピーするボタン
function CopyChartsBtn({ targetRef }) {
  const [state, setState] = useState("");
  useEffect(() => {
    if (state !== "done" && state !== "err") return;
    const t = setTimeout(() => setState(""), 1800);
    return () => clearTimeout(t);
  }, [state]);
  const copy = async () => {
    if (!targetRef.current || state === "busy") return;
    setState("busy");
    try {
      const blob = await chartsToBlob(targetRef.current);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setState("done");
    } catch (e) {
      console.error("[copy charts]", e);
      setState("err");
    }
  };
  return (
    <button
      type="button"
      className={"icon-btn copy-btn" + (state ? " " + state : "")}
      onClick={copy}
      disabled={state === "busy"}
      title={
        state === "done"
          ? "コピーしました"
          : state === "err"
          ? "コピーできませんでした"
          : "グラフをまとめて画像でコピー"
      }
      aria-label="グラフをまとめて画像でコピー"
    >
      {state === "done" ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}
