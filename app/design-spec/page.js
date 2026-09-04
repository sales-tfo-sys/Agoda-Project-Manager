"use client";

// 設計仕様書（管理者用）。現状はプレースホルダー。
// システムの構成・データフロー・各画面の仕様などをここにまとめる予定。
export default function DesignSpecPage() {
  return (
    <div className="wrap page-compact">
      <div className="head">
        <div className="head-left">
          <span className="conn ok" title="設計仕様書" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <line x1="10" y1="9" x2="8" y2="9" />
            </svg>
          </span>
          <span className="page-h page-h-gap">設計仕様書</span>
        </div>
      </div>

      <div className="card">
        <div className="soon">
          <span className="soon-ico" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </span>
          <h2 className="soon-h">準備中</h2>
          <p className="soon-msg">
            システムの構成・データの流れ・各画面の仕様などをここにまとめる予定です。
          </p>
        </div>
      </div>
    </div>
  );
}
