-- ───────────────────────────────────────────────────────────
-- RLS（行レベルセキュリティ）を全テーブルで有効化する。
--
-- このアプリはサーバー側 API ルートから service_role キーでのみ
-- Supabase にアクセスする。service_role は RLS をバイパスするため、
-- RLS を有効化してもアプリの動作には一切影響しない。
--
-- 目的は多層防御：万一 anon キーやプロジェクト URL が漏れても、
-- 一般ロール（anon / authenticated）からはデータを読めないようにする。
-- ポリシーは作らない＝これらのロールには許可が一切与えられない。
--
-- Supabase ダッシュボード → SQL Editor に貼り付けて実行してください。
-- 何度実行しても安全（冪等）です。
-- ───────────────────────────────────────────────────────────

alter table if exists kosu_person      enable row level security;
alter table if exists kosu_task         enable row level security;
alter table if exists kosu_entry        enable row level security;
alter table if exists app_session       enable row level security;
alter table if exists task_priority     enable row level security;
alter table if exists task_assign       enable row level security;
alter table if exists task_override     enable row level security;
alter table if exists adhoc_task        enable row level security;
alter table if exists kintone_snapshot  enable row level security;
alter table if exists adhoc_item        enable row level security;

-- 念のため、公開ロールに付与されている可能性のある直接権限を剥奪する。
-- （RLS が有効ならポリシーが無い限り読めないが、権限自体も落としておく）
revoke all on kosu_person, kosu_task, kosu_entry, app_session, task_priority,
              task_assign, task_override, adhoc_task, kintone_snapshot, adhoc_item
  from anon, authenticated;
