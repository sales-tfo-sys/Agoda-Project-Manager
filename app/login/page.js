"use client";

import { useEffect, useState } from "react";

// ブランドの信号アイコン（上昇バー）
function BrandGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true">
      <rect x="5.3" y="14" width="3.4" height="6" rx="1.7" />
      <rect x="10.3" y="9" width="3.4" height="11" rx="1.7" />
      <rect x="15.3" y="4.5" width="3.4" height="15.5" rx="1.7" />
    </svg>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // 通常は Google ログインのみ。Google が使えない緊急時は /login?pw=1 で開く
  const [showPwForm, setShowPwForm] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("pw") === "1") setShowPwForm(true);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      }).then((r) => r.json());
      if (res.error) {
        setError(res.error);
        setBusy(false);
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.replace(next || "/dashboard");
    } catch (err) {
      setError(String(err?.message || err));
      setBusy(false);
    }
  };

  return (
    <div className="lg2">
      <div className="lg2-card">
        <span className="lg2-logo" aria-hidden="true">
          <BrandGlyph />
        </span>

        <h1 className="lg2-title">Agoda Project Management</h1>
        <p className="lg2-sub">案件の進捗を可視化し、成果につなげる管理プラットフォーム。</p>

        <span className="lg2-lock" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2f6be0" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="9" rx="2.4" />
            <path d="M8 11V8.2a4 4 0 0 1 8 0V11" />
          </svg>
        </span>

        <a className="lg2-google" href="/api/auth/google">
          <svg className="g-logo" width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.7-.4-3.9H24v7.1h12.1c-.2 1.8-1.6 4.6-4.5 6.4l-.1.3 6.5 5 .5.1c4.1-3.8 6.6-9.4 6.6-15z" />
            <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-.3.1-6.7 5.2-.1.3C7.9 40.9 15.4 46 24 46z" />
            <path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.8-2.9-.8-4.4s.3-3 .7-4.4v-.3l-6.8-5.3-.2.1A22 22 0 0 0 2 24c0 3.5.9 6.9 2.4 9.9l7.1-5.5z" />
            <path fill="#EB4335" d="M24 10.5c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.3 29.9 2 24 2 15.4 2 7.9 7.1 4.4 14.1l7.1 5.5c1.8-5.3 6.7-9.1 12.5-9.1z" />
          </svg>
          <span className="lg2-g-text">Google でログイン</span>
        </a>

        {showPwForm && (
          <form onSubmit={submit} className="lg2-pwform">
            <div className="auth-or"><span>または</span></div>
            <label className="auth-field">
              <span>メールアドレス</span>
              <input type="email" name="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
            </label>
            <label className="auth-field">
              <span>パスワード</span>
              <span className="auth-pw">
                <input type={showPw ? "text" : "password"} name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
                <button type="button" className="auth-pw-toggle" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "パスワードを隠す" : "パスワードを表示"}>
                  {showPw ? "隠す" : "表示"}
                </button>
              </span>
            </label>
            <button className="auth-submit" type="submit" disabled={busy || !email.trim() || !password}>
              {busy ? "確認中…" : "ログイン"}
            </button>
          </form>
        )}

        {error && (
          <div className="auth-error" role="alert">
            <span>{error}</span>
          </div>
        )}

        <p className="lg2-foot">
          <span className="lg2-foot-mark" aria-hidden="true" />
          © 2026 Agoda Project Management. All rights reserved.
        </p>
      </div>
    </div>
  );
}
