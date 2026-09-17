-- ───────────────────────────────────────────────────────────────
-- 追加した索引の記録。Supabase ダッシュボード → SQL Editor で実行する。
-- 何度実行しても安全（すでにあれば作らない）。
-- ───────────────────────────────────────────────────────────────

-- 2026-09-17 AI健康診断の指摘：app_session.person_id に索引が無い。
--   ログインのたびに person_id で引くため、セッションが増えると効いてくる。
create index if not exists app_session_person_id_idx
  on public.app_session (person_id);
