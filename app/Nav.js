"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useNavLoading } from "./NavLoading";

function LogoutIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3.5" y1="6" x2="3.51" y2="6" />
      <line x1="3.5" y1="12" x2="3.51" y2="12" />
      <line x1="3.5" y1="18" x2="3.51" y2="18" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="4" y1="20" x2="4" y2="10" />
      <line x1="10" y1="20" x2="10" y2="4" />
      <line x1="16" y1="20" x2="16" y2="13" />
      <line x1="21" y1="20" x2="3" y2="20" />
    </svg>
  );
}


function FormIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" />
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="13" y2="16" />
    </svg>
  );
}

function WorkReqIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function HidIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <line x1="2" y1="9" x2="22" y2="9" />
      <line x1="7" y1="14" x2="9" y2="14" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </svg>
  );
}

const TABS = [
  { href: "/dashboard", label: "ダッシュボード", Icon: GridIcon },
  { href: "/", label: "施設一覧", Icon: ListIcon },
  // グラフページは一旦削除（app/graphs を除去）
  { href: "/kosu", label: "工数管理", Icon: ClockIcon },
  { href: "/hid-requests", label: "HID新規発行依頼", Icon: HidIcon },
  { href: "/work-requests", label: "新規作業依頼", Icon: WorkReqIcon },
  { href: "/forms", label: "フォーム回答", Icon: FormIcon },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState(null);
  // メニュー遷移の読み込みオーバーレイ（クリックで表示→遷移先の読込完了で解除）
  const { start } = useNavLoading();

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then(setMe)
      .catch(() => {});
  }, [pathname]);

  // アカウント管理は閲覧権限のある人（オーナー・管理者）だけメニューに出す
  const tabs = me?.perms?.viewAccounts
    ? [...TABS, { href: "/kosu/persons", label: "アカウント管理", Icon: PersonIcon }]
    : TABS;

  const logout = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" }).then((r) => r.json());
      if (res.configured) {
        window.location.href = "/login";
      } else {
        setNote("認証は未設定です");
        setTimeout(() => setNote(null), 2600);
      }
    } catch {
      setNote("ログアウトに失敗しました");
      setTimeout(() => setNote(null), 2600);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-mark" aria-hidden="true">
          <svg
            className="brand-glyph"
            width="27"
            height="29"
            viewBox="0 0 62 68"
            fill="none"
          >
            <defs>
              <linearGradient id="navHex" x1="0.15" y1="0" x2="0.85" y2="1">
                <stop offset="0" stopColor="#6aa4ff" />
                <stop offset="1" stopColor="#2f6be0" />
              </linearGradient>
            </defs>
            <path d="M31 7 55 20 55 48 31 61 7 48 7 20Z" fill="url(#navHex)" stroke="url(#navHex)" strokeWidth="13" strokeLinejoin="round" />
            <g fill="#ffffff">
              <rect x="21" y="37" width="4.8" height="9.5" rx="2.4" />
              <rect x="28.6" y="30" width="4.8" height="16.5" rx="2.4" />
              <rect x="36.2" y="23" width="4.8" height="23.5" rx="2.4" />
            </g>
          </svg>
        </span>
        <span className="brand-text">Agoda案件管理</span>
      </div>
      <nav className="side-nav">
        {tabs.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className={"side-tab" + (pathname === href ? " active" : "")}
            onClick={() => {
              // 同じページなら遷移しないのでスピナーは出さない
              if (pathname !== href) start();
            }}
          >
            <Icon />
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      <div className="side-foot">
        {me?.user && (
          <span className="side-user" title={me.user.email}>
            {me.user.avatar ? (
              // Google の写真（取得できないときは頭文字にフォールバック）
              <img
                className="side-avatar"
                src={me.user.avatar}
                alt=""
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                  e.currentTarget.nextSibling.style.display = "grid";
                }}
              />
            ) : null}
            <span
              className="side-avatar"
              aria-hidden="true"
              style={me.user.avatar ? { display: "none" } : undefined}
            >
              {(me.user.loginName || me.user.name)?.slice(0, 1) || "?"}
            </span>
            {/* ログイン時に取得した Google アカウント名＋メールアドレス */}
            <span className="side-user-text">
              <span className="side-user-name">{me.user.loginName || me.user.name}</span>
              {me.user.email && <span className="side-user-mail">{me.user.email}</span>}
            </span>
          </span>
        )}
        {note && <span className="side-note">{note}</span>}
        <button
          type="button"
          className="side-tab logout-tab"
          onClick={logout}
          disabled={busy}
          title="ログアウト"
        >
          <LogoutIcon />
          <span>ログアウト</span>
        </button>
      </div>
    </aside>
  );
}
