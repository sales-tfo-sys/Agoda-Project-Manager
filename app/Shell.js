"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Nav";
import { NavLoadingProvider } from "./NavLoading";

// 認証系の画面ではサイドメニューを出さない（未ログイン時にメニューを見せない）
const BARE_PATHS = ["/login", "/auth/callback"];

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
    <NavLoadingProvider>
      <div className="app">
        <Sidebar />
        <main className="main">{children}</main>
      </div>
    </NavLoadingProvider>
  );
}
