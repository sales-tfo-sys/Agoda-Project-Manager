"use client";

import TaskBoard from "../TaskBoard";

// プロジェクト管理：Regular Task / Ad Hoc Task を常時編集で管理するページ。
export default function ProjectPage() {
  return <TaskBoard mode="edit" />;
}
