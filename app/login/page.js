"use client";

import { useEffect, useState } from "react";

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
    <div className="auth-simple">
      <span className="auth-simple-glow" aria-hidden="true" />
      <div className="auth-card">
        <span className="auth-badge" aria-hidden="true">
          {/* 角の丸い六角形（緑）＋錠前 */}
          <svg className="auth-hex" width="60" height="60" viewBox="0 0 44 48">
            <defs>
              <linearGradient id="authHexGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#1ed760" />
                <stop offset="1" stopColor="#0e9d48" />
              </linearGradient>
            </defs>
            <polygon
              points="22 4 38 13 38 35 22 44 6 35 6 13"
              fill="url(#authHexGrad)"
              stroke="url(#authHexGrad)"
              strokeWidth="7"
              strokeLinejoin="round"
            />
          </svg>
          <svg className="auth-lock" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="9" rx="2.2" />
            <path d="M8.4 11V8.2a3.6 3.6 0 0 1 7.2 0V11" />
          </svg>
        </span>

        <h1 className="auth-title">Agoda案件管理</h1>
        <p className="auth-sub">続けるには Google アカウントでログイン</p>

        <a className="auth-google" href="/api/auth/google">
          <svg className="g-logo" width="22" height="22" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.7-.4-3.9H24v7.1h12.1c-.2 1.8-1.6 4.6-4.5 6.4l-.1.3 6.5 5 .5.1c4.1-3.8 6.6-9.4 6.6-15z" />
            <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-.3.1-6.7 5.2-.1.3C7.9 40.9 15.4 46 24 46z" />
            <path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.8-2.9-.8-4.4s.3-3 .7-4.4v-.3l-6.8-5.3-.2.1A22 22 0 0 0 2 24c0 3.5.9 6.9 2.4 9.9l7.1-5.5z" />
            <path fill="#EB4335" d="M24 10.5c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.3 29.9 2 24 2 15.4 2 7.9 7.1 4.4 14.1l7.1 5.5c1.8-5.3 6.7-9.1 12.5-9.1z" />
          </svg>
          <span className="g-div" aria-hidden="true" />
          <span className="g-text">Google でログイン</span>
          <svg className="g-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="4" y1="12" x2="19" y2="12" />
            <polyline points="13.5 6.5 20 12 13.5 17.5" />
          </svg>
        </a>

        {showPwForm && (
          <>
            <div className="auth-or">
              <span>または</span>
            </div>

            <form onSubmit={submit} className="auth-form">
              <label className="auth-field">
                <span>メールアドレス</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </label>

              <label className="auth-field">
                <span>パスワード</span>
                <span className="auth-pw">
                  <input
                    type={showPw ? "text" : "password"}
                    name="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    className="auth-pw-toggle"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? "パスワードを隠す" : "パスワードを表示"}
                  >
                    {showPw ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </span>
              </label>

              <button className="auth-submit" type="submit" disabled={busy || !email.trim() || !password}>
                {busy ? (
                  <>
                    <span className="auth-spinner" aria-hidden="true" />
                    確認中…
                  </>
                ) : (
                  "ログイン"
                )}
              </button>
            </form>
          </>
        )}

        {error && (
          <div className="auth-error" role="alert">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <p className="auth-secure">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2.2" />
            <path d="M8.4 11V8.2a3.6 3.6 0 0 1 7.2 0V11" />
          </svg>
          セキュアな環境でデータを保護しています
        </p>
      </div>
    </div>
  );
}
