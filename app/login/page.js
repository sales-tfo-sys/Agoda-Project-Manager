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
      <svg className="lg2-waves" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <filter id="lgSoft" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="16" />
          </filter>
          <linearGradient id="lgWhite" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lgBlue" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#a9c9ff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#a9c9ff" stopOpacity="1" />
            <stop offset="1" stopColor="#a9c9ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g fill="none" filter="url(#lgSoft)">
          <path d="M-140 210 C 300 90 560 300 900 185 C 1180 90 1380 250 1580 175" stroke="url(#lgWhite)" strokeWidth="24" opacity="0.6" />
          <path d="M-140 320 C 320 220 660 430 1000 315 C 1250 230 1430 375 1580 300" stroke="url(#lgBlue)" strokeWidth="16" opacity="0.5" />
          <path d="M-140 470 C 330 370 700 590 1050 460 C 1300 375 1450 520 1580 450" stroke="url(#lgWhite)" strokeWidth="32" opacity="0.42" />
          <path d="M-140 630 C 300 530 720 750 1080 620 C 1330 535 1470 675 1580 610" stroke="url(#lgWhite)" strokeWidth="20" opacity="0.36" />
          <path d="M-140 760 C 350 670 700 860 1080 740 C 1320 665 1470 800 1580 745" stroke="url(#lgBlue)" strokeWidth="26" opacity="0.3" />
        </g>
      </svg>
      <div className="lg2-card">
        <span className="lg2-logo" aria-hidden="true">
          <svg width="60" height="64" viewBox="0 0 62 68" fill="none">
            <defs>
              <linearGradient id="lgHex" x1="0.15" y1="0" x2="0.85" y2="1">
                <stop offset="0" stopColor="#6aa4ff" />
                <stop offset="1" stopColor="#2f6be0" />
              </linearGradient>
            </defs>
            <path d="M31 7 55 20 55 48 31 61 7 48 7 20Z" fill="url(#lgHex)" stroke="url(#lgHex)" strokeWidth="13" strokeLinejoin="round" />
            <g fill="#ffffff">
              <rect x="21" y="37" width="4.8" height="9.5" rx="2.4" />
              <rect x="28.6" y="30" width="4.8" height="16.5" rx="2.4" />
              <rect x="36.2" y="23" width="4.8" height="23.5" rx="2.4" />
            </g>
          </svg>
        </span>

        <h1 className="lg2-title">Agoda Management System</h1>
        <p className="lg2-sub">案件の進捗を可視化し、成果につなげる管理プラットフォーム</p>

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
          <svg className="lg2-foot-mark" width="14" height="15" viewBox="0 0 24 26" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="lgShield" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#5b9dff" />
                <stop offset="1" stopColor="#2f6be0" />
              </linearGradient>
            </defs>
            <path d="M12 1 21 4.2v7.2c0 5.7-3.8 10.6-9 12.6-5.2-2-9-6.9-9-12.6V4.2L12 1Z" fill="url(#lgShield)" />
            <path d="M7.7 12.6l2.9 2.9 5.7-5.9" stroke="#ffffff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          © 2026 Agoda Management System. All rights reserved.
        </p>
      </div>
    </div>
  );
}
