"use client";

// システムヘルス（管理者用）。現状はプレースホルダー。
// 監視したい指標（Kintone取込の鮮度・スナップショット件数・各APIの死活など）が
// 決まり次第、ここに実装する。
export default function SystemHealthPage() {
  return (
    <div className="wrap page-compact">
      <div className="head">
        <div className="head-left">
          <span className="conn ok" title="システムヘルス" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </span>
          <span className="page-h page-h-gap">システムヘルス</span>
        </div>
      </div>

      <div className="card">
        <div className="soon">
          <span className="soon-ico" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </span>
          <h2 className="soon-h">準備中</h2>
          <p className="soon-msg">
            システムの稼働状況（データ取込の鮮度・各機能の死活など）をここに表示する予定です。
          </p>
        </div>
      </div>
    </div>
  );
}
