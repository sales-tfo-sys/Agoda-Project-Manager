"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";

// メニュー遷移の読み込みオーバーレイを、アプリ全体で共有するためのコンテキスト。
//  ・メニューをクリックした時点で start()（オーバーレイ表示）
//  ・遷移先ページのデータ読込が終わったら done()（オーバーレイ解除）
// これで「URLが変わった瞬間」ではなく「実際に中身が出るまで」スピナーを出せる。
const Ctx = createContext(null);

export function NavLoadingProvider({ children }) {
  const [loading, setLoading] = useState(false);
  const start = useCallback(() => setLoading(true), []);
  const done = useCallback(() => setLoading(false), []);

  // 保険：遷移先がdone()を呼ばない場合でも、一定時間で必ず解除する
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setLoading(false), 10000);
    return () => clearTimeout(t);
  }, [loading]);

  return (
    <Ctx.Provider value={{ loading, start, done }}>
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
  return useContext(Ctx) || { loading: false, start() {}, done() {} };
}

// ページ側で使うヘルパー。データ読込が終わったら（isLoading=false になったら）
// オーバーレイを解除する。ページのマウント時点で既に読込済みでも無害。
export function useNavLoadingDone(isLoading) {
  const { done } = useNavLoading();
  useEffect(() => {
    if (!isLoading) done();
  }, [isLoading, done]);
}
