-- ───────────────────────────────────────────────────────────────
-- システムヘルス用: Postgres 内部統計を1つの JSON で返す関数。
-- Supabase ダッシュボード → SQL Editor に貼り付けて一度だけ実行してください。
-- 導入すると /system-health 画面に「キャッシュヒット率・DB容量・接続数・
-- コミット成功率・稼働時間・テーブル別サイズ・肥大化/VACUUM 状況」が表示されます。
-- （未導入でも行数・取込鮮度・応答速度は表示されます）
-- SECURITY DEFINER で pg_stat 系を読むため、関数の所有者は postgres 想定です。
-- ───────────────────────────────────────────────────────────────
create or replace function public.sys_health()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  with db as (
    select
      pg_database_size(current_database())                                      as db_size_bytes,
      (select setting::int from pg_settings where name = 'max_connections')      as max_conn,
      (select count(*)::int from pg_stat_activity
         where datname = current_database())                                     as used_conn,
      extract(epoch from (now() - pg_postmaster_start_time()))::bigint           as uptime_seconds
  ),
  stat as (
    select
      sum(blks_hit)      as blks_hit,
      sum(blks_read)     as blks_read,
      sum(xact_commit)   as commits,
      sum(xact_rollback) as rollbacks
    from pg_stat_database
    where datname = current_database()
  ),
  tbls as (
    select
      relname                                        as name,
      n_live_tup                                     as rows,
      pg_total_relation_size(relid)                  as size_bytes,
      n_dead_tup                                     as dead_tuples,
      case when (n_live_tup + n_dead_tup) > 0
           then round(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 1)
           else 0 end                                as dead_ratio,
      coalesce(seq_scan, 0)                          as seq_scan,
      coalesce(idx_scan, 0)                          as idx_scan,
      nullif(greatest(coalesce(last_vacuum,     to_timestamp(0)),
                      coalesce(last_autovacuum, to_timestamp(0))),
             to_timestamp(0))                        as last_vacuum
    from pg_stat_user_tables
    order by pg_total_relation_size(relid) desc
  )
  select jsonb_build_object(
    'db_size_bytes',   (select db_size_bytes from db),
    'max_conn',        (select max_conn from db),
    'used_conn',       (select used_conn from db),
    'uptime_seconds',  (select uptime_seconds from db),
    'cache_hit_ratio', (select case when (coalesce(blks_hit,0)+coalesce(blks_read,0)) > 0
                                     then round(100.0 * blks_hit / (blks_hit + blks_read), 2)
                                     else null end from stat),
    'commit_ratio',    (select case when (coalesce(commits,0)+coalesce(rollbacks,0)) > 0
                                     then round(100.0 * commits / (commits + rollbacks), 2)
                                     else null end from stat),
    'tables',          (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from tbls t)
  );
$$;

grant execute on function public.sys_health() to service_role, authenticated, anon;
