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
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
          >
            <polygon points="12 2.2 22 8 12 13.8 2 8" fill="#ffffff" />
            <polyline
              points="3.4 11.4 12 16.4 20.6 11.4"
              stroke="#ffffff"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.82"
            />
            <polyline
              points="3.4 15.6 12 20.6 20.6 15.6"
              stroke="#ffffff"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.5"
            />
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
