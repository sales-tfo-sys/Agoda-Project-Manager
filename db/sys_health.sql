-- ───────────────────────────────────────────────────────────────
-- システムヘルス用の読み取り関数。
-- Supabase ダッシュボード → SQL Editor に貼り付けて実行してください。
--
-- 権限差でどちらか片方が取れなくても、もう一方の表示は出せるように
-- 「健全性＋容量」と「テーブル統計」の2つに分けている（呼び出し側で個別に try/catch）。
-- SECURITY DEFINER で pg_stat 系を読むため、関数の所有者は postgres 想定。
-- 実行はサーバー専用の service_role（Secret key）だけに許可する。
-- ───────────────────────────────────────────────────────────────

-- ① 健全性（全DB合算）＋容量＋バージョン
create or replace function public.sys_health()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  with h as (
    select
      coalesce(sum(numbackends), 0)::int                                    as conns,
      round(100.0 * sum(blks_hit)
            / nullif(sum(blks_hit) + sum(blks_read), 0), 2)                 as cache_hit,
      coalesce(sum(xact_commit), 0)::bigint                                 as commits,
      coalesce(sum(xact_rollback), 0)::bigint                               as rollbacks,
      round(100.0 * sum(xact_commit)
            / nullif(sum(xact_commit) + sum(xact_rollback), 0), 2)          as commit_pct
    from pg_stat_database
  )
  select jsonb_build_object(
    'conns',      (select conns      from h),
    'cache_hit',  (select cache_hit  from h),
    'commits',    (select commits    from h),
    'rollbacks',  (select rollbacks  from h),
    'commit_pct', (select commit_pct from h),
    'max_conns',  current_setting('max_connections')::int,
    'uptime_sec', extract(epoch from (now() - pg_postmaster_start_time()))::bigint,
    -- 容量は current_database() だけだと過少に出るため全DBの合計を使う
    'db_bytes',   (select coalesce(sum(pg_database_size(datname)), 0)::bigint from pg_database),
    'version',    version()
  );
$$;

-- ② テーブル統計（使用状況＋メンテナンス）
--    Supabase 内部（auth/storage 等）は除き、アプリの public スキーマだけを対象にする。
create or replace function public.sys_tables()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.bytes desc), '[]'::jsonb)
  from (
    select
      relname                                     as name,
      coalesce(n_live_tup, 0)                     as live,
      coalesce(n_dead_tup, 0)                     as dead,
      pg_total_relation_size(relid)               as bytes,
      coalesce(seq_scan, 0)                       as seq_scan,
      coalesce(idx_scan, 0)                       as idx_scan,
      nullif(greatest(coalesce(last_vacuum,     to_timestamp(0)),
                      coalesce(last_autovacuum, to_timestamp(0))),
             to_timestamp(0))                     as last_vac
    from pg_stat_user_tables
    where schemaname = 'public'
  ) t;
$$;

-- Postgres は関数の実行権限を既定で PUBLIC に付与するため、明示的に剥奪する。
-- このアプリは SUPABASE_SERVICE_ROLE_KEY（Secret key）を使ってサーバー側からのみ
-- 呼び出すので、公開前提の Publishable key（anon）には実行させない。
revoke all on function public.sys_health() from public, anon, authenticated;
revoke all on function public.sys_tables() from public, anon, authenticated;
grant execute on function public.sys_health() to service_role;
grant execute on function public.sys_tables() to service_role;
