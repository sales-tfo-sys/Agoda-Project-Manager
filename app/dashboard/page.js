"use client";

import TaskBoard from "../TaskBoard";

// ダッシュボードは閲覧専用。編集（Regular / Ad Hoc）は「プロジェクト管理」ページで行う。
export default function DashboardPage() {
  return <TaskBoard mode="view" />;
}
