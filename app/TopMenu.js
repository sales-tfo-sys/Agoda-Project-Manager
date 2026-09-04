"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// 右上の共通メニュー。よく使うページへのショートカット。
export default function TopMenu() {
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState(null);
  const ref = useRef(null);
  const pathname = usePathname();

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then(setMe)
      .catch(() => {});
  }, [pathname]);

  // ページ遷移で閉じる
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // 外側クリック・Escで閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // ユーザー用メニュー（全員）
  const userItems = [
    {
      href: "/project",
      label: "プロジェクト管理",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      ),
    },
    {
      href: "/kosu/input",
      label: "工数入力",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z" />
        </svg>
      ),
    },
  ];

  // 管理者用メニュー（閲覧権限がある人だけ）
  const adminItems = [
    {
      href: "/design-spec",
      label: "設計仕様書",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      ),
    },
    {
      href: "/system-health",
      label: "システムヘルス",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      ),
    },
    {
      href: "/kosu/persons",
      label: "アカウント管理",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
  ];
  const showAdmin = !!me?.perms?.viewAccounts;

  const renderItem = (it) => (
    <Link
      key={it.href}
      href={it.href}
      className="topmenu-item"
      role="menuitem"
      onClick={() => setOpen(false)}
    >
      <span className="topmenu-ico">{it.icon}</span>
      <span>{it.label}</span>
    </Link>
  );

  return (
    <div className="topmenu" ref={ref}>
      <button
        type="button"
        className={"topmenu-btn" + (open ? " on" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-label="メニュー"
        aria-haspopup="true"
        aria-expanded={open}
        title="メニュー"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {open && (
        <div className="topmenu-pop" role="menu">
          <div className="topmenu-sec">ユーザー</div>
          {userItems.map(renderItem)}
          {showAdmin && (
            <>
              <div className="topmenu-div" role="separator" />
              <div className="topmenu-sec">管理者</div>
              {adminItems.map(renderItem)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
