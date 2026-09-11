"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useNavLoading } from "./NavLoading";
import { pageKeyForPath } from "../lib/pages";
import { cachedJson } from "./dataCache";

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
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 21h18" />
      <path d="M5 21V6.5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 15 6.5V21" />
      <path d="M15 21V11h3.5A1.5 1.5 0 0 1 20 12.5V21" />
      <path d="M8 9h1.5M11 9H12M8 13h1.5M11 13H12M8 17h1.5M11 17H12" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="9" height="11" rx="1.5" />
      <rect x="15" y="3" width="6" height="6" rx="1.5" />
      <rect x="15" y="12" width="6" height="9" rx="1.5" />
      <rect x="3" y="17" width="9" height="4" rx="1.5" />
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
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 9v11" />
      <path d="M3 14.5h18" />
    </svg>
  );
}

function WorkReqIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 13h5l1.5 2.5h5L16 13h5" />
      <path d="M5.5 13 7 5h10l1.5 8v6a2 2 0 0 1-2 2H7.5a2 2 0 0 1-2-2v-6Z" />
      <path d="M12 5.5v4.5" />
      <path d="m9.8 8 2.2 2.2L14.2 8" />
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

function BoardIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 21V4" />
      <path d="M5 4.5h11l-2.2 3.5L16 11.5H5" />
    </svg>
  );
}

function InputIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.4 12.5A8.5 8.5 0 1 1 11.5 4" />
      <path d="M12 7.5V12l3 1.8" />
      <path d="M17.8 3.6a1.7 1.7 0 0 1 2.4 2.4L16 10.2l-3 .8.8-3Z" />
    </svg>
  );
}

function SpecIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v17H6.5A2.5 2.5 0 0 0 4 22.5Z" />
      <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v17h5.5a2.5 2.5 0 0 1 2.5 2.5Z" />
    </svg>
  );
}

function HealthIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

// メニューの並び。
//   admin: true  … 閲覧権限のある人（オーナー・管理者）だけに出す
//   admin なし   … 全員に出す（ページ単位で閲覧不可にされている場合だけ隠す）
const TABS = [
  { href: "/dashboard", label: "ダッシュボード", Icon: GridIcon },
  // プロジェクト管理はダッシュボードと対で使うので、管理者用の並びから上げてすぐ下に置く
  { href: "/project", label: "プロジェクト管理", Icon: BoardIcon, admin: true },
  { href: "/work-requests", label: "作業依頼", Icon: WorkReqIcon },
  { href: "/", label: "施設一覧", Icon: ListIcon },
  // HID新規発行依頼・フォーム回答は、どちらもスプレッドシートから
  // 取ってくるデータなので「管理」1つにまとめ、中身はタブで切り替える
  { href: "/manage", label: "管理", Icon: FormIcon, keys: ["hid", "forms"] },
  { href: "/kosu/input", label: "作業工数入力", Icon: InputIcon },
  { divider: true },
  { href: "/design-spec", label: "設計仕様書", Icon: SpecIcon, admin: true },
  { href: "/system-health", label: "システムヘルス", Icon: HealthIcon, admin: true },
  { href: "/kosu/persons", label: "アカウント管理", Icon: PersonIcon, admin: true },
  // 作業工数管理は中身（作業リソース詳細・工数明細）をダッシュボードの
  // 「作業工数表」タブ（一覧＝工数明細／グラフ＝作業リソース詳細）へ移したので、ページごと廃止した
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
    cachedJson("/api/auth/me", 60 * 1000)
      .then(setMe)
      .catch(() => {});
  }, [pathname]);

  // ページ単位の閲覧権限でメニューを出し分ける。
  // 取得前(null)はユーザー用は表示・管理者用は非表示にして、ちらつきを抑える。
  const pages = me?.perms?.pages || null;
  const canView = (href) => {
    if (!pages) return null;
    const key = pageKeyForPath(href);
    return key ? !!pages[key]?.view : true;
  };
  // まとめたページ（管理）は、中のどれか1つでも見られるなら出す
  const canViewAny = (keys) => {
    if (!pages) return null;
    return keys.some((k) => !!pages[k]?.view);
  };
  const visible = TABS.filter((t) => {
    if (t.divider) return true;
    if (t.keys) return canViewAny(t.keys) !== false;
    return t.admin ? canView(t.href) === true : canView(t.href) !== false;
  });
  // 区切り線は、その下に出すものが1つも無ければ引かない
  const tabs = visible.filter(
    (t, i) => !t.divider || visible.slice(i + 1).some((x) => !x.divider)
  );

  const renderTab = ({ href, label, Icon }) => (
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
  );

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
        <span className="brand-text">
          <span className="brand-line">Agoda</span>
          <span className="brand-line">Management System</span>
        </span>
      </div>
      <nav className="side-nav">
        {tabs.map((t, i) =>
          t.divider ? (
            <div key={"div" + i} className="side-div" role="separator" aria-label="管理者メニュー" />
          ) : (
            renderTab(t)
          )
        )}
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
