"use client";

// 表やグラフの右上に置く「更新」の小さなバッジ。
// その表・グラフが、いつ時点のデータなのかを出す。
// マウスを乗せると、元になっているデータごとの時刻を出す。
//
// ※表・グラフを画像でコピーする処理は、表・注記・グラフ・見出しの要素だけを描くので、
//   このバッジは画像には写らない（class 名を .table-note や .chart-title にしないこと）。

function fmt(iso) {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}`;
}

/**
 * at      … バッジに出す時刻（その表・グラフの主なデータの時刻）
 * sources … マウスを乗せたときに出す内訳 [{ name, at }]
 */
export default function UpdatedBadge({ at, sources = [] }) {
  const d = at ? (at instanceof Date ? at : new Date(at)) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const stamp = fmt(d);
  const title = [
    "このデータの更新時刻",
    ...sources.filter((s) => s && s.name).map((s) => `・${s.name}：${fmt(s.at) || "—"}`),
  ].join("\n");
  return (
    <span className="upd-badge" title={title}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      更新日時 {stamp}
    </span>
  );
}
