"use client";

import { useEffect, useRef, useState } from "react";

// ヘッダー右端の時計ボタン。押すと「いつのデータか」をまとめて出す。
// 中身は Kintone スナップショットの最終取得時刻（＋ページ側から渡された行）。
// 帯に日時をベタ書きすると幅を食うので、ボタンの中に畳んでいる。

function fmt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}`;
}

// 何日前か（今日 / N日前）。判定できなければ null
function daysAgo(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 86400000);
}

function ClockIcon({ size = 15 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}

/**
 * rows: [{ key, label, at, note }] … ページ固有の行（省略可）
 * label: セクションの見出し（既定「Kintone 取込」）
 */
export default function UpdatedPop({ rows = [], label = "Kintone 取込" }) {
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState(null);
  const wrapRef = useRef(null);

  // 開いたときだけ取りに行く（軽いエンドポイントだが毎回は要らない）
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/kintone-sync", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => alive && setSnap(j))
      .catch(() => {});
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const list = [
    {
      key: "kintone",
      label: "案件データ（Kintone）",
      at: snap?.fetchedAt || null,
      note: snap?.count != null ? `${Number(snap.count).toLocaleString("ja-JP")} 件` : null,
    },
    ...rows,
  ];
  const known = list.filter((r) => r.at);
  // 全部が2日以内なら「正常」。1つでも古い／取れていなければ注意扱い
  const stale = list.some((r) => {
    const d = daysAgo(r.at);
    return d == null || d > 1;
  });

  return (
    <span className="upop" ref={wrapRef}>
      <button
        type="button"
        className={"icon-btn upop-btn" + (open ? " on" : "")}
        onClick={() => setOpen((v) => !v)}
        title="最終更新日時"
        aria-label="最終更新日時"
        aria-expanded={open}
      >
        <ClockIcon size={16} />
      </button>

      {open && (
        <div className="upop-pop" role="dialog" aria-label="最終更新日時">
          <div className="upop-h">
            <ClockIcon size={14} />
            最終更新日時
          </div>
          <div className="upop-sec">
            <div className="upop-sec-h">
              <span className="upop-sec-t">{label}</span>
              <span className={"upop-pill " + (stale ? "warn" : "ok")}>
                {stale
                  ? "確認してください"
                  : `${known.length}件すべて最新`}
              </span>
            </div>
            <ul className="upop-list">
              {list.map((r) => {
                const d = daysAgo(r.at);
                return (
                  <li key={r.key} className="upop-row">
                    <span className={"upop-dot " + (d != null && d <= 1 ? "ok" : "warn")} />
                    <span className="upop-name">
                      {r.label}
                      {r.note && <em className="upop-note">{r.note}</em>}
                    </span>
                    <span className="upop-at">
                      <ClockIcon size={12} />
                      {fmt(r.at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </span>
  );
}
