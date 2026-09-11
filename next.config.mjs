/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV !== "production";

// Content-Security-Policy。読み込む外部リソースは Google アバター画像のみ。
// Next.js のハイドレーション用インラインscript／styled-jsx のため
// script-src・style-src に 'unsafe-inline' を許可する。
// 開発時のみ HMR 用に 'unsafe-eval' と ws: を足す。
// 資料ページのファイルの中身は、ブラウザと Supabase Storage のあいだで直接やりとりする
// （自前のAPIを通すと、置いているサーバーの本文サイズ上限に当たって大きいファイルが送れない）。
// そのため、その行き先だけを connect-src に足す。渡すのは1つのファイルにだけ有効な一時URLで、鍵は渡さない。
const supabaseOrigin = (() => {
  try {
    return process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : "";
  } catch {
    return "";
  }
})();

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // 資料の画像・PDF は保存先から直接読み込んで画面の中で見せる
  `img-src 'self' data: https://*.googleusercontent.com${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  `frame-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  "font-src 'self' data:",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""}${isDev ? " ws:" : ""}`,
].join("; ");

// 全レスポンスに付ける最低限のセキュリティヘッダー。
// クリックジャッキング防止・MIMEスニッフ防止・リファラ制限・不要な権限の無効化・HSTS・CSP。
const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // HSTS は HTTPS でのみ効き、http では無視されるためローカルでも無害。
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
