-- ───────────────────────────────────────────────────────────────
-- AI健康診断（セキュリティ／パフォーマンス点検）用の読み取り関数。
-- Supabase ダッシュボード → SQL Editor に貼り付けて実行してください。
--   ※ sys_health.sql と同じく、1回だけ実行すれば以後はサイトから呼べます。
--
-- 何をするか：Supabase の Advisors と同じ観点を、読み取りだけで確かめます。
--   セキュリティ … RLS の掛け忘れ、ポリシー不在、SECURITY DEFINER のビュー、
--                  search_path を固定していない関数、public に入った拡張
--   パフォーマンス … 外部キーの索引不足、使われていない索引、
--                    Seqスキャン比率が高い表、肥大化、遅いクエリ（統計があれば）
--
-- 書き込みは一切しません。SECURITY DEFINER で pg_catalog を読むため、
-- 関数の所有者は postgres 想定。実行はサーバー専用の service_role だけに許可します。
-- ───────────────────────────────────────────────────────────────

create or replace function public.sys_advisor()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
with
-- ① RLS が無効な public のテーブル
rls_off as (
  select jsonb_build_object(
    'kind','security','level','high','code','rls_disabled',
    'title','行レベルセキュリティ（RLS）が無効です',
    'target', c.relname,
    'detail','public スキーマの表で RLS が無効です。APIキーを持つ相手に中身が見える恐れがあります。'
  ) as f
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
),
-- ② RLS は有効だがポリシーが1つも無い
rls_nopolicy as (
  select jsonb_build_object(
    'kind','security','level','med','code','rls_no_policy',
    'title','RLS は有効ですが、ポリシーがありません',
    'target', c.relname,
    'detail','誰も読み書きできない状態です（サーバー専用キーのみ可）。意図どおりかご確認ください。'
  ) as f
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity = true
    and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
),
-- ③ 呼び出した人の権限で動かないビュー（security_invoker が未設定）。
--    作成者の権限で動くため、利用者の権限に関係なく中身が見えることがある。
sec_views as (
  select jsonb_build_object(
    'kind','security','level','med','code','security_definer_view',
    'title','ビューが作成者の権限で動きます（security_invoker 未設定）',
    'target', c.relname,
    'detail','利用者の権限に関係なく中身が見えることがあります。alter view ... set (security_invoker = on) で変えられます。'
  ) as f
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and c.relkind='v'
    and not exists (
      select 1 from unnest(coalesce(c.reloptions, '{}')) opt
      where opt ilike 'security_invoker=on' or opt ilike 'security_invoker=true'
    )
),
-- ④ search_path を固定していない SECURITY DEFINER 関数
func_path as (
  select jsonb_build_object(
    'kind','security','level','med','code','function_search_path',
    'title','search_path を固定していない関数です',
    'target', p.proname,
    'detail','SECURITY DEFINER の関数で search_path が未設定です。差し替え攻撃の入口になり得ます。'
  ) as f
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.prosecdef
    and (p.proconfig is null or not exists (
      select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'
    ))
),
-- ⑤ public スキーマに入っている拡張
ext_public as (
  select jsonb_build_object(
    'kind','security','level','low','code','extension_in_public',
    'title','拡張が public スキーマに入っています',
    'target', e.extname,
    'detail','専用スキーマ（extensions）へ移すのが安全です。'
  ) as f
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where n.nspname = 'public' and e.extname not in ('plpgsql')
),
-- ⑥ 外部キーに索引が無い（結合や削除が遅くなる）
fk_noindex as (
  select jsonb_build_object(
    'kind','performance','level','med','code','fk_without_index',
    'title','外部キーに索引がありません',
    'target', cl.relname || '.' || att.attname,
    'detail','参照元の列に索引が無いため、結合や削除が遅くなることがあります。'
  ) as f
  from pg_constraint con
  join pg_class cl on cl.oid = con.conrelid
  join pg_namespace n on n.oid = cl.relnamespace
  join lateral unnest(con.conkey) as k(attnum) on true
  join pg_attribute att on att.attrelid = cl.oid and att.attnum = k.attnum
  where con.contype='f' and n.nspname='public'
    and not exists (
      select 1 from pg_index i
      where i.indrelid = cl.oid and k.attnum = any (i.indkey::int2[])
    )
),
-- ⑦ 使われていない索引（容量とINSERTの重さの無駄）
idx_unused as (
  select jsonb_build_object(
    'kind','performance','level','low','code','unused_index',
    'title','使われていない索引です',
    'target', s.relname || '.' || s.indexrelname,
    'detail','読み取りに一度も使われていません（' ||
             pg_size_pretty(pg_relation_size(s.indexrelid)) || '）。'
  ) as f
  from pg_stat_user_indexes s
  join pg_index i on i.indexrelid = s.indexrelid
  where s.idx_scan = 0 and not i.indisprimary and not i.indisunique
    and pg_relation_size(s.indexrelid) > 1024 * 256
),
-- ⑧ Seq スキャン比率が高い、ある程度大きい表
seq_heavy as (
  select jsonb_build_object(
    'kind','performance','level','med','code','seq_scan_heavy',
    'title','索引が使われず、全件走査が多い表です',
    'target', s.relname,
    'detail','全件走査 ' || s.seq_scan || ' 回（索引 ' || coalesce(s.idx_scan,0) ||
             ' 回）、行数およそ ' || s.n_live_tup || '。よく使う条件に索引を足すと速くなります。'
  ) as f
  from pg_stat_user_tables s
  where s.seq_scan > 200 and s.n_live_tup > 1000
    and s.seq_scan > coalesce(s.idx_scan,0)
),
-- ⑨ 不要タプルが多い（肥大化）
bloat as (
  select jsonb_build_object(
    'kind','performance','level','low','code','dead_tuples',
    'title','不要な行が溜まっています',
    'target', s.relname,
    'detail','不要タプル ' || s.n_dead_tup || ' 件（生存 ' || s.n_live_tup ||
             '）。VACUUM が効いているかご確認ください。'
  ) as f
  from pg_stat_user_tables s
  where s.n_dead_tup > 1000 and s.n_dead_tup > s.n_live_tup * 0.2
),
all_f as (
  select f from rls_off
  union all select f from rls_nopolicy
  union all select f from sec_views
  union all select f from func_path
  union all select f from ext_public
  union all select f from fk_noindex
  union all select f from idx_unused
  union all select f from seq_heavy
  union all select f from bloat
)
select jsonb_build_object(
  'at', now(),
  'findings', coalesce(jsonb_agg(f order by
      case f->>'level' when 'high' then 0 when 'med' then 1 else 2 end,
      f->>'kind'), '[]'::jsonb)
)
from all_f;
$$;

revoke all on function public.sys_advisor() from public, anon, authenticated;
grant execute on function public.sys_advisor() to service_role;
