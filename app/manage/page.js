"use client";

import { useEffect, useState } from "react";
import HidRequestsPage from "../hid-requests/page";
import WorkRequestsPage from "../work-requests/page";
import FormsPage from "../forms/page";

// 「管理」ページ。
// HID新規発行依頼／新規作業依頼／フォーム回答は、どれも
// 「スプレッドシートを登録して、そこから中身や件数を読む」という同じ作りなので、
// 1ページにまとめてタブで切り替える。
// 中身はそれぞれの画面をそのまま使い（embedded で見出しだけ「管理」に差し替え）、
// タブ行は各画面の見出しの下に差し込んでもらう。

const TABS = [
  { key: "hid", label: "HID新規発行依頼", Panel: HidRequestsPage },
  { key: "workReq", label: "新規作業依頼", Panel: WorkRequestsPage },
  { key: "forms", label: "フォーム回答", Panel: FormsPage },
];
const STORE_KEY = "agoda-manage-tab";

export default function ManagePage() {
  const [tab, setTab] = useState("hid");
  const [pages, setPages] = useState(null); // ページ権限（取得前は null）
  // タブの幅が不揃いなので、選択中ボタンの実寸からスライダーを合わせる
  // （ダッシュボードのタブと同じやり方）。
  const [segEl, setSegEl] = useState(null);
  const [segThumb, setSegThumb] = useState(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORE_KEY);
      if (TABS.some((t) => t.key === v)) setTab(v);
    } catch {}
  }, []);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setPages(j?.perms?.pages || {}))
      .catch(() => setPages({}));
  }, []);

  useEffect(() => {
    if (!segEl) return;
    const fit = () => {
      const el = segEl.querySelector(".segbar-btn.active");
      if (el) setSegThumb({ left: el.offsetLeft, width: el.offsetWidth });
    };
    fit();
    // 文字の読み込みなどで幅が後から変わることがあるので、描画直後にも測り直す
    const raf = requestAnimationFrame(fit);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(segEl);
    document.fonts?.ready?.then(fit).catch(() => {});
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [segEl, tab, pages]);

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

  const tabs = shown.length > 1 && (
    <div className="tabbar-row">
      <div className="segbar" role="tablist" aria-label="管理の表示切替" ref={setSegEl}>
        <span
          className="segbar-thumb"
          style={
            segThumb
              ? { left: segThumb.left, width: segThumb.width, transform: "none" }
              : { opacity: 0 }
          }
          aria-hidden="true"
        />
        {shown.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === active.key}
            className={"segbar-btn" + (t.key === active.key ? " active" : "")}
            onClick={() => switchTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );

  const Panel = active.Panel;
  // タブを変えたら中身も作り直す（前のタブの状態が残らないように）
  return <Panel key={active.key} embedded tabs={tabs} />;
}
