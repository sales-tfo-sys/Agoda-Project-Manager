"use client";

import { useEffect, useState } from "react";

// ブランドの信号アイコン（上昇バー）。青グロー円の中に置く。
function BrandGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true">
      <rect x="5.3" y="14" width="3.4" height="6" rx="1.7" />
      <rect x="10.3" y="9" width="3.4" height="11" rx="1.7" />
      <rect x="15.3" y="4.5" width="3.4" height="15.5" rx="1.7" />
    </svg>
  );
}

const FEATURES = [
  {
    title: "案件を可視化",
    desc: "ステータスと完了率をひと目で",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#cfe0ff" aria-hidden="true">
        <rect x="4" y="13" width="3.4" height="7" rx="1.4" />
        <rect x="10.3" y="9" width="3.4" height="11" rx="1.4" />
        <rect x="16.6" y="5" width="3.4" height="15" rx="1.4" />
      </svg>
    ),
  },
  {
    title: "スムーズな管理",
    desc: "発行依頼から作業まで一元管理",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#cfe0ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12.4 L11 15.2 L16.2 9.2" />
      </svg>
    ),
  },
  {
    title: "リアルタイム更新",
    desc: "最新の状況をすぐに反映",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#cfe0ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
    ),
  },
  {
    title: "安全なアクセス",
    desc: "権限管理で安心の運用",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#cfe0ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5C8 21.3 5 17.4 5 13V6z" />
        <path d="M9.3 12.2 L11.2 14.2 L15 10.2" />
      </svg>
    ),
  },
];

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
    <div className="lg">
      {/* 背景：ダークブルー＋青い光の渦（オーロラ状のリボン） */}
      <svg className="lg-bg" viewBox="0 0 1400 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="lgR" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#1e5bff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#74b6ff" stopOpacity="1" />
            <stop offset="1" stopColor="#1e5bff" stopOpacity="0" />
          </linearGradient>
          <filter id="lgGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="8" />
          </filter>
          <filter id="lgGlowBig" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="28" />
          </filter>
        </defs>
        {/* 太く柔らかい光の帯（渦の芯） */}
        <g filter="url(#lgGlowBig)" fill="none" stroke="url(#lgR)" opacity="0.78">
          <path d="M-160 210 C 320 20, 760 360, 1120 130 S 1540 40, 1620 250" strokeWidth="14" />
          <path d="M-160 840 C 320 1030, 760 640, 1120 880 S 1540 980, 1620 700" strokeWidth="14" />
          <path d="M980 -80 C 1180 220, 1080 480, 1320 620" strokeWidth="12" opacity="0.7" />
        </g>
        {/* 細く明るい光の筋 */}
        <g filter="url(#lgGlow)" fill="none" stroke="url(#lgR)">
          <path d="M-160 250 C 330 70, 780 400, 1140 170 S 1560 80, 1620 280" strokeWidth="2.6" opacity="0.95" />
          <path d="M-160 320 C 330 160, 780 460, 1140 250 S 1560 170, 1620 360" strokeWidth="1.6" opacity="0.6" />
          <path d="M-160 800 C 330 980, 780 620, 1140 860 S 1560 940, 1620 680" strokeWidth="2.6" opacity="0.85" />
          <path d="M-160 880 C 330 1040, 800 700, 1160 900 S 1560 980, 1620 760" strokeWidth="1.6" opacity="0.5" />
          <path d="M1000 -80 C 1200 230, 1090 500, 1330 640" strokeWidth="2.2" opacity="0.7" />
        </g>
      </svg>

      <div className="lg-panels">
        {/* ── 左：ブランド ── */}
        <aside className="lg-left">
          <h1 className="lg-lede">
            案件の進捗を、
            <br />
            <span className="hl">ひと目で。</span>
          </h1>
          <p className="lg-sub">
            ステータス・工数・リソースを
            <br />
            シンプルに、スマートに。
          </p>

          <ul className="lg-feats">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <span className="lg-ftx">
                  <b>{f.title}</b>
                  <span>{f.desc}</span>
                </span>
              </li>
            ))}
          </ul>

          <p className="lg-copy">© 2026 Agoda案件管理. All rights reserved.</p>
        </aside>

        {/* ── 右：ログイン ── */}
        <main className="lg-right">
          <span className="lg-logo" aria-hidden="true">
            <BrandGlyph />
          </span>

          <h2 className="lg-welcome">Agoda Project Management</h2>

          <div className="lg-lock" aria-hidden="true">
            <img className="lg-lock-img" src="/login-lock.png" alt="" />
          </div>

          <a className="lg-google" href="/api/auth/google">
            <svg className="g-logo" width="22" height="22" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.7-.4-3.9H24v7.1h12.1c-.2 1.8-1.6 4.6-4.5 6.4l-.1.3 6.5 5 .5.1c4.1-3.8 6.6-9.4 6.6-15z" />
              <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-.3.1-6.7 5.2-.1.3C7.9 40.9 15.4 46 24 46z" />
              <path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.8-2.9-.8-4.4s.3-3 .7-4.4v-.3l-6.8-5.3-.2.1A22 22 0 0 0 2 24c0 3.5.9 6.9 2.4 9.9l7.1-5.5z" />
              <path fill="#EB4335" d="M24 10.5c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.3 29.9 2 24 2 15.4 2 7.9 7.1 4.4 14.1l7.1 5.5c1.8-5.3 6.7-9.1 12.5-9.1z" />
            </svg>
            <span className="lg-g-text">Google でログイン</span>
          </a>

          <p className="lg-safe-desc">
            Google アカウントで安全にログインします。
            <br />
            情報は Google アカウントで保護されます。
          </p>

          {showPwForm && (
            <form onSubmit={submit} className="lg-pwform">
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
        </main>
      </div>
    </div>
  );
}
