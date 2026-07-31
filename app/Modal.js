"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// 画面共通のモーダル。ブラウザ標準のダイアログ（confirm/alert）の代わりに使う。
// Esc・背景クリックで閉じ、開いている間は背面のスクロールを止める。
export default function Modal({ open, title, onClose, children, footer, width = 460 }) {
  const bodyRef = useRef(null);
  // onClose は毎回新しい関数で渡ってくるため、副作用の依存に入れない（入力のたびに
  // 効果が張り直されてフォーカスが奪われるのを防ぐ）
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeRef.current?.();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // 開いた時だけ最初の入力欄へフォーカス（閉じるボタンには当てない）
    const t = setTimeout(() => {
      const el = bodyRef.current?.querySelector(
        "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])"
      );
      el?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="modal-back"
      onMouseDown={(e) => e.target === e.currentTarget && closeRef.current?.()}
    >
      <div className="modal-box" style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button type="button" className="modal-x" onClick={onClose} aria-label="閉じる">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="5" y1="5" x2="19" y2="19" />
              <line x1="19" y1="5" x2="5" y2="19" />
            </svg>
          </button>
        </div>
        <div className="modal-body" ref={bodyRef}>
          {children}
        </div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
