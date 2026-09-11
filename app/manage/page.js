"use client";

import { useEffect, useRef, useState } from "react";
import HidRequestsPage from "../hid-requests/page";
import FormsPage from "../forms/page";
import { cachedJson } from "../dataCache";

// 「管理」ページ。
// HID新規発行依頼／フォーム回答は、どちらも
// 「スプレッドシートを登録して、そこから中身や件数を読む」という同じ作りなので、
// 1ページにまとめてタブで切り替える。
// 中身はそれぞれの画面をそのまま使い（embedded で見出しだけ「管理」に差し替え）、
// タブ行は各画面の見出しの下に差し込んでもらう。

const TABS = [
  { key: "hid", label: "HID新規発行依頼", Panel: HidRequestsPage },
  { key: "forms", label: "フォーム回答", Panel: FormsPage },
];
const STORE_KEY = "agoda-manage-tab";

// 切り替えタブ。ラベルの幅が不揃いなので、選択中のボタンを実測して
// スライダーを重ねる。計測はこの中で完結させる（外に状態を置くと、
// 中身だけが作り直されたときに前の寸法が残ってしまう）。
function ManageTabs({ items, value, onChange }) {
  const ref = useRef(null);
  const [thumb, setThumb] = useState(null);
  useEffect(() => {
    const fit = () => {
      const el = ref.current?.querySelector(".segbar-btn.active");
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
    };
    fit();
    // 文字の読み込みなどで幅が後から変わることがあるので、描画直後にも測り直す
    const raf = requestAnimationFrame(fit);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    if (ref.current && ro) ro.observe(ref.current);
    document.fonts?.ready?.then(fit).catch(() => {});
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [value, items]);

  return (
    <div className="segbar segbar-sm manage-seg" role="tablist" aria-label="管理の表示切替" ref={ref}>
      <span
        className="segbar-thumb"
        style={thumb ? { left: thumb.left, width: thumb.width, transform: "none" } : { opacity: 0 }}
        aria-hidden="true"
      />
      {items.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === value}
          className={"segbar-btn" + (t.key === value ? " active" : "")}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export default function ManagePage() {
  const [tab, setTab] = useState("hid");
  const [pages, setPages] = useState(null); // ページ権限（取得前は null）

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORE_KEY);
      if (TABS.some((t) => t.key === v)) setTab(v);
    } catch {}
  }, []);

  useEffect(() => {
    cachedJson("/api/auth/me", 60 * 1000)
      .then((j) => setPages(j?.perms?.pages || {}))
      .catch(() => setPages({}));
  }, []);

  const switchTab = (v) => {
    setTab(v);
    try {
      localStorage.setItem(STORE_KEY, v);
    } catch {}
  };

  // 見られるタブだけ出す。取得前は全部出しておく（ちらつき防止）
  const shown = pages ? TABS.filter((t) => pages[t.key]?.view !== false) : TABS;
  const active = shown.find((t) => t.key === tab) || shown[0];
  if (!active) {
    return (
      <div className="wrap page-compact">
        <div className="card">
          <div className="notice">表示できるページがありません。</div>
        </div>
      </div>
    );
  }

  // タブはヘッダーの中（ページ名の右）に置く。他のページと同じ形。
  const tabs = shown.length > 1 && (
    <>
      <span className="head-sep" aria-hidden="true" />
      <ManageTabs items={shown} value={active.key} onChange={switchTab} />
    </>
  );

  const Panel = active.Panel;
  // タブを変えたら中身も作り直す（前のタブの状態が残らないように）
  return <Panel key={active.key} embedded tabs={tabs} />;
}
