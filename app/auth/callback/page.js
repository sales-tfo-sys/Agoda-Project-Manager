"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// ログイン後の戻り先。URLフラグメントのトークンを受け取り、
// サーバーで検証してセッションCookieを発行してもらう。
export default function AuthCallbackPage() {
  const [error, setError] = useState(null);
  const [denied, setDenied] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // トークンはURLに残さない。読み取ったら真っ先にアドレスバーから消す
    // （この状態のURLをコピーして他のブラウザで開かれると、そのまま
    //   ログインできてしまうため）
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : "";
    const params = new URLSearchParams(hash);
    // エラーはクエリ文字列で返ってくることもある（?error=...）
    const qs = new URLSearchParams(window.location.search);
    // ルーターが後からURLを戻すことがあるため、少しの間くり返し消す
    const strip = () => {
      if (window.location.hash || window.location.search) {
        window.history.replaceState(null, "", "/auth/callback");
      }
    };
    strip();
    const timers = [0, 60, 200, 600].map((ms) => setTimeout(strip, ms));

    (async () => {
      try {
        const errDesc =
          params.get("error_description") || qs.get("error_description") || qs.get("error");
        if (errDesc) {
          const raw = decodeURIComponent(errDesc.replace(/\+/g, " "));
          const isDenied =
            /allow|permission|denied|Database error|saving new user|不許可|許可されていません/i.test(
              raw
            );
          setDenied(isDenied);
          setError(
            isDenied
              ? "このGoogleアカウントはログインを許可されていません。管理者にお問合せください。"
              : raw
          );
          return;
        }
        const token = params.get("access_token");
        if (!token) {
          setError("ログイン情報が取得できませんでした。もう一度お試しください。");
          return;
        }
        const res = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token: token }),
        }).then((r) => r.json());
        if (res.error) {
          setDenied(/許可されていません/.test(res.error));
          setError(res.error);
          return;
        }
        // フルリロードだとログイン直後にヘッダー/メニューが一瞬消える。
        // クライアント遷移にしてシェル（サイドバー）を即表示する。
        router.replace("/dashboard");
        // 保険：クライアント遷移が効かない環境ではフルリロードで確実に移動する。
        setTimeout(() => {
          if (window.location.pathname.startsWith("/auth/callback")) {
            window.location.replace("/dashboard");
          }
        }, 1500);
      } catch (e) {
        setError(String(e?.message || e));
      }
    })();

    return () => timers.forEach(clearTimeout);
  }, []);

  if (error) {
    return (
      <div className="deny-shell">
        <span className="deny-glow" aria-hidden="true" />
        <span className="deny-dots a" aria-hidden="true" />
        <span className="deny-dots b" aria-hidden="true" />
        <span className="deny-arc a1" aria-hidden="true" />
        <span className="deny-arc a2" aria-hidden="true" />
        <span className="deny-arc a3" aria-hidden="true" />

        <div className="deny-card">
          <div className="deny-iconwrap" aria-hidden="true">
            <span className="deny-icon">
              <span className="deny-pulse" />
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                <line x1="12" y1="9.5" x2="12" y2="14" />
                <circle cx="12" cy="17.3" r="1.15" fill="currentColor" stroke="none" />
              </svg>
            </span>
          </div>

          <h1 className="deny-h">
            {denied ? "ログインが許可されていません" : "ログインできませんでした"}
          </h1>

          <p className="deny-msg">
            {denied ? "管理者にお問合せください。" : error}
          </p>

          <a className="deny-btn" href="/login">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            ログイン画面に戻る
          </a>
        </div>
      </div>
    );
  }

  // 読み込み中はダッシュボードと同じレイアウト（ヘッダー枠＋中央スピナー）にして、
  // ログイン直後にメニューの出現やスピナー位置のズレが起きないようにする。
  return (
    <div className="wrap">
      <div className="head" aria-hidden="true" />
      <div className="card">
        <div className="page-loading">
          <span className="loader-ring" role="status" aria-label="読み込み中" />
        </div>
      </div>
    </div>
  );
}
