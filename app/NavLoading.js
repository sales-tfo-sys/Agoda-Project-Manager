"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";

// メニュー遷移の読み込みオーバーレイをアプリ全体で共有する。
//  ・メニュークリック時に start()（全画面オーバーレイ表示）＝クリックの即時フィードバック
//  ・遷移が確定（URLが変わって新ページ表示）したら自動で解除
//  ・その後のデータ読込は各ページ中央のスピナーが引き継ぐ（オーバーレイと二重表示しない）
const Ctx = createContext(null);

export function NavLoadingProvider({ children }) {
  const [loading, setLoading] = useState(false);
  const pathname = usePathname();
  const start = useCallback(() => setLoading(true), []);

  // 遷移確定（URL変化）でオーバーレイを解除。以降はページ内スピナーに引き継ぐ。
  useEffect(() => {
    setLoading(false);
  }, [pathname]);

  // 保険：万一遷移が起きなくても一定時間で解除する
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setLoading(false), 8000);
    return () => clearTimeout(t);
  }, [loading]);

  return (
    <Ctx.Provider value={{ loading, start }}>
      {children}
      {loading &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="nav-loading"
            role="status"
            aria-live="polite"
            aria-label="読み込み中"
          >
            <span className="nav-loading-spinner" aria-hidden="true" />
          </div>,
          document.body
        )}
    </Ctx.Provider>
  );
}

export function useNavLoading() {
  return useContext(Ctx) || { loading: false, start() {} };
}
