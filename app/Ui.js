"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";

// 全ページ共通の UI 補助：
//  ・setBusy(text)…画面中央にスピナー＋メッセージのオーバーレイ（保存中など）
//  ・showToast(msg, type)…画面上部に浮かぶ通知（レイアウトを崩さない・自動で消える）
const Ctx = createContext(null);

export function UiProvider({ children }) {
  const [busy, setBusy] = useState(null); // 文字列 or null
  const [toast, setToast] = useState(null); // { msg, type }

  const showToast = useCallback((msg, type = "ok") => {
    if (!msg) return;
    setToast({ msg, type });
  }, []);

  // トーストは数秒で自動的に消す
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.type === "err" ? 5000 : 3200);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <Ctx.Provider value={{ setBusy, showToast }}>
      {children}
      {busy != null &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="busy-overlay" role="status" aria-live="polite">
            <span className="nav-loading-spinner" aria-hidden="true" />
            {typeof busy === "string" && busy && <span className="busy-text">{busy}</span>}
          </div>,
          document.body
        )}
      {toast &&
        typeof document !== "undefined" &&
        createPortal(
          <div className={"toast toast-" + toast.type} role="status" aria-live="polite">
            {toast.msg}
          </div>,
          document.body
        )}
    </Ctx.Provider>
  );
}

export function useUi() {
  return useContext(Ctx) || { setBusy() {}, showToast() {} };
}
