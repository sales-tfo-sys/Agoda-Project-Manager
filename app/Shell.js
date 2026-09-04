"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Nav";
import TopMenu from "./TopMenu";
import { NavLoadingProvider } from "./NavLoading";
import { UiProvider } from "./Ui";

// 未ログインのログイン画面だけメニューを出さない。
// 認証コールバックはログイン直後にシェル（サイドバー）を保ったまま
// ダッシュボードへ遷移させ、メニューの出現・スピナー位置のズレを防ぐ。
const BARE_PATHS = ["/login"];

export default function Shell({ children }) {
  const pathname = usePathname();
  const bare = BARE_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));

  if (bare) {
    return (
      <div className="app app-bare">
        <main className="main main-full">{children}</main>
      </div>
    );
  }
  return (
    <UiProvider>
      <NavLoadingProvider>
        <div className="app">
          <Sidebar />
          <main className="main">{children}</main>
          <TopMenu />
        </div>
      </NavLoadingProvider>
    </UiProvider>
  );
}
