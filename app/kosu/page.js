"use client";

import DetailTable from "./DetailTable";
import UpdatedPop from "../UpdatedPop";

// 作業工数管理は工数明細のページ。
// 「作業リソース詳細」の3つのグラフ・表はダッシュボードの「作業工数グラフ」タブへ移した。
export default function KosuPage() {
  return (
    <div className="wrap page-compact kosu-page">
      <div className="head">
        <div className="head-left">
          <span className="conn ok" title="作業工数管理" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 7 12 12 16 14" />
            </svg>
          </span>
          <span className="page-h page-h-gap">作業工数管理</span>
        </div>
        <div className="head-right">
          <UpdatedPop />
        </div>
      </div>

      <DetailTable title="工数明細" compact />
    </div>
  );
}
