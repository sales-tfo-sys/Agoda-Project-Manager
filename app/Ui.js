"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";

// 全ページ共通の UI 補助：
//  ・setBusy(text)…画面中央にスピナー＋メッセージ（保存中など）
//  ・flashDone(text)…画面中央にチェック＋メッセージを一瞬表示（保存完了など・自動で消える）
//  ・showToast(msg,type)…画面上部の通知（主にエラー・レイアウトを崩さない）
//  ・busy…オーバーレイ表示中かどうか（各ページの二重スピナー抑止に使う）
const Ctx = createContext(null);

export function UiProvider({ children }) {
  const [overlay, setOverlay] = useState(null); // { kind:"busy"|"done", text }
  const [toast, setToast] = useState(null); // { msg, type }

  const setBusy = useCallback((text) => {
    setOverlay(text == null ? null : { kind: "busy", text: typeof text === "string" ? text : "" });
  }, []);
  const flashDone = useCallback((text) => {
    setOverlay({ kind: "done", text: text || "完了" });
  }, []);
  const showToast = useCallback((msg, type = "ok") => {
    if (!msg) return;
    setToast({ msg, type });
  }, []);

  // 完了オーバーレイは一瞬で自動的に消す
  useEffect(() => {
    if (overlay?.kind !== "done") return;
    const t = setTimeout(() => setOverlay(null), 1200);
    return () => clearTimeout(t);
  }, [overlay]);

  // トーストは数秒で自動的に消す
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.type === "err" ? 5000 : 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const busy = overlay != null;

  return (
    <Ctx.Provider value={{ setBusy, flashDone, showToast, busy }}>
      {children}
      {overlay &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="busy-overlay" role="status" aria-live="polite">
            {overlay.kind === "done" ? (
              <span className="busy-check" aria-hidden="true">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            ) : (
              <span className="nav-loading-spinner" aria-hidden="true" />
            )}
            {overlay.text && <span className="busy-text">{overlay.text}</span>}
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
  return useContext(Ctx) || { setBusy() {}, flashDone() {}, showToast() {}, busy: false };
}
