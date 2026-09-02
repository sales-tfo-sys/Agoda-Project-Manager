"use client";

import { useEffect, useState } from "react";

function BrandMark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <polygon points="12 2.2 22 8 12 13.8 2 8" fill="#ffffff" />
      <polyline points="3.4 11.4 12 16.4 20.6 11.4" stroke="#ffffff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" opacity="0.82" />
      <polyline points="3.4 15.6 12 20.6 20.6 15.6" stroke="#ffffff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.7" />
      <polyline points="7.8 12.2 10.8 15.1 16.3 9.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// 下部の波（点の集まり）。奥に向かって列が収束する遠近感を付けて、
// 面をほぼ水平から見た形にしている。明るさは「波の高さ」で決め、
// 山の稜線だけが光の筋として浮かぶようにする。
const WAVE_ROWS = 30;
const WAVE_COLS = 120;
const WAVE = [];
for (let r = 0; r < WAVE_ROWS; r++) {
  const depth = r / (WAVE_ROWS - 1); // 0=奥 1=手前
  const baseY = 168 + Math.pow(depth, 2.5) * 86; // 帯は薄く（奥はほぼ重なる）
  const spread = 0.6 + depth * 0.62; // 奥ほど横幅が狭い＝収束して見える
  const amp = 6 + depth * 32;
  for (let c = 0; c <= WAVE_COLS; c++) {
    const t = c / WAVE_COLS;
    const x = 400 + (t - 0.5) * 980 * spread;
    const off =
      Math.sin(t * Math.PI * 2.3 + r * 0.14) * amp +
      Math.sin(t * Math.PI * 4.9 + r * 0.24) * amp * 0.32;
    const y = baseY + off * (0.45 + depth * 0.75);
    // 山(上に凸)を 1、谷を 0 として明るさ・大きさに反映
    const crest = Math.min(1, Math.max(0, 0.5 - off / (amp * 2.3)));
    // 画面外へ出た列と左右の端はフェード
    const inside = x > -30 && x < 830 ? 1 : 0;
    const edge = Math.min(1, Math.min(t, 1 - t) * 5) * inside;
    // サーバーとブラウザで Math.sin の最終桁が食い違い、表示前後で不一致に
    // なることがあるため、桁を丸めて同じ値になるようにする
    const round = (v, d) => Number(v.toFixed(d));
    WAVE.push({
      x: round(x, 2),
      y: round(y, 2),
      r: round((0.14 + depth * 0.3) * (0.55 + crest * 0.95), 3),
      o: round((0.07 + depth * 0.5) * (0.12 + crest * 1.7) * edge, 3),
    });
  }
}

const MEMBERS = [
  { n: "山田 太郎", w: "82%" },
  { n: "佐藤 花子", w: "64%" },
  { n: "鈴木 健一", w: "45%" },
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
    <div className="auth-shell">
      {/* ── 左：ブランドパネル ── */}
      <aside className="auth-brand">
        <span className="auth-orb o1" aria-hidden="true" />
        <span className="auth-orb o2" aria-hidden="true" />

        <div className="auth-brand-inner">
          <div className="auth-logo">
            <span className="auth-mark">
              <BrandMark size={24} />
            </span>
            <span className="auth-logo-text">Agoda案件管理</span>
          </div>

          <h1 className="auth-lede">
            案件の進捗を、
            <br />
            ひと目で。
          </h1>

          <p className="auth-lede-sub">
            ステータス・四半期実績・工数・リソース配分を
            <br />
            1つの画面に集約し、チームの成果を最大化します。
          </p>

          <ul className="auth-points">
            <li>
              <i>
                <Check />
              </i>
              案件タイプ別のステータスと完了率
            </li>
            <li>
              <i>
                <Check />
              </i>
              日次の工数入力とメンバー別リソース
            </li>
            <li>
              <i>
                <Check />
              </i>
              クライアント報告用のレポート出力
            </li>
          </ul>
        </div>

        {/* 画面イメージ（装飾） */}
        <div className="auth-mock" aria-hidden="true">
          <div className="mock-card">
            <span className="mock-title">案件ステータス</span>
            <div className="mock-stats">
              <span>
                <em>未着手</em>
                <b>12</b>
              </span>
              <span>
                <em>進行中</em>
                <b>35</b>
              </span>
              <span>
                <em>完了</em>
                <b>18</b>
              </span>
            </div>
            <div className="mock-bars">
              <i style={{ width: "26%" }} />
              <i style={{ width: "48%", opacity: 0.5 }} />
              <i style={{ width: "26%", opacity: 0.26 }} />
            </div>
          </div>

          <div className="mock-card">
            <span className="mock-title">四半期実績</span>
            <svg className="mock-chart" viewBox="0 0 260 84" fill="none" preserveAspectRatio="none">
              <defs>
                <linearGradient id="mkline" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#1ed760" />
                  <stop offset="1" stopColor="#7bf0a6" />
                </linearGradient>
              </defs>
              <polyline
                points="6,70 40,62 74,66 108,48 142,54 176,30 210,24 250,8"
                stroke="url(#mkline)"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="250" cy="8" r="3.6" fill="#1ed760" />
            </svg>
          </div>

          <div className="mock-card">
            <span className="mock-title">メンバーリソース</span>
            {MEMBERS.map((m) => (
              <div className="mock-row" key={m.n}>
                <span className="mock-avatar" />
                <span className="mock-name">{m.n}</span>
                <span className="mock-track">
                  <i style={{ width: m.w }} />
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 下部の波（点） */}
        <svg className="auth-wave" viewBox="0 0 800 260" fill="none" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
          <defs>
            <radialGradient id="wvdot" cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor="#c9f7db" />
              <stop offset="1" stopColor="#1ed760" />
            </radialGradient>
          </defs>
          {WAVE.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="url(#wvdot)" opacity={d.o} />
          ))}
        </svg>
      </aside>

      {/* ── 右：ログイン ── */}
      <main className="auth-form-side">
        <span className="auth-dots" aria-hidden="true" />
        <span className="auth-arc a1" aria-hidden="true" />
        <span className="auth-arc a2" aria-hidden="true" />
        <span className="auth-arc a3" aria-hidden="true" />

        <div className="auth-form-inner">
          <span className="auth-badge" aria-hidden="true">
            {/* 角の丸い六角形。stroke-linejoin: round ＋ 太めのストロークで角を丸める */}
            <svg className="auth-hex" width="62" height="62" viewBox="0 0 44 48">
              <defs>
                <linearGradient id="authHexGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#4a86ff" />
                  <stop offset="1" stopColor="#2456b8" />
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

          <h2 className="auth-h">ログイン</h2>

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
        </div>

        <p className="auth-secure">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2.2" />
            <path d="M8.4 11V8.2a3.6 3.6 0 0 1 7.2 0V11" />
          </svg>
          セキュアな環境でデータを保護しています
        </p>
      </main>
    </div>
  );
}
