-- ============================================================
-- Agoda案件管理　工数管理テーブル（Supabase / PostgreSQL）
-- Supabase の SQL Editor にこの内容を貼り付けて実行してください。
--
-- ※ 既に旧版（person を文字列で持つ版）を実行済みの場合は、
--    先に下記を実行してから貼り直してください（データが無い前提）:
--      drop table if exists kosu_entry;
--      drop table if exists kosu_task;
--      drop table if exists kosu_person;
-- ============================================================

-- 担当者マスタ（メンバーの入れ替わりに対応）
create table if not exists kosu_person (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text,                            -- ログイン用メールアドレス
  can_login   boolean not null default false,  -- ★ログイン許可（管理者が事前に許可）
  role        text not null default 'member',  -- member / admin
  sort_order  int  not null default 0,
  active      boolean not null default true,   -- 退職・異動は false（履歴は残す）
  joined_on   date,
  left_on     date,
  created_at  timestamptz default now()
);
create unique index if not exists uq_kosu_person_name  on kosu_person (name);
create unique index if not exists uq_kosu_person_email on kosu_person (lower(email)) where email is not null;

-- Googleログイン用（既に kosu_person を作成済みの場合はこの数行だけ実行してください）
alter table kosu_person add column if not exists avatar_url    text;        -- Googleの写真URL
alter table kosu_person add column if not exists last_login_at timestamptz; -- 最終ログイン
alter table kosu_person add column if not exists login_name    text;        -- ログイン時のGoogleアカウント名

-- 権限モデル（owner / admin / member）と、管理者への個別付与フラグ
--   role は 'owner' も取り得る（既定は 'member'）
alter table kosu_person add column if not exists can_edit_accounts boolean not null default false; -- アカウント管理を編集できる
alter table kosu_person add column if not exists can_edit_tasks    boolean not null default false; -- ダッシュボードのタスクを編集できる

-- 作業マスタ（タスク種別・作業内容）
create table if not exists kosu_task (
  id          uuid primary key default gen_random_uuid(),
  task_type   text not null,                 -- Regular task / Ad hoc task / その他
  content     text not null,                 -- 新規HID発行 等
  unit        text not null default 'count', -- count（件数） / time（時間）
  sort_order  int  not null default 0,
  active      boolean not null default true,
  completed   boolean not null default false, -- 完了（Ad Hoc の終了作業を既定で隠す）
  completed_on date,
  created_at  timestamptz default now()
);
-- 既に kosu_task を作成済みの場合は次の2行だけ実行してください：
-- alter table kosu_task add column if not exists completed boolean not null default false;
-- alter table kosu_task add column if not exists completed_on date;

-- 日次入力（日付 × 作業 × 担当者 → 値）
-- 担当者は「名前」ではなく person_id で紐付け（改名しても実績が壊れない）
create table if not exists kosu_entry (
  id          uuid primary key default gen_random_uuid(),
  entry_date  date not null,
  task_id     uuid not null references kosu_task(id)   on delete cascade,
  person_id   uuid not null references kosu_person(id) on delete restrict,
  value       numeric not null default 0,
  updated_at  timestamptz default now(),
  unique (entry_date, task_id, person_id)   -- upsert のキー
);

create index if not exists idx_kosu_entry_date   on kosu_entry (entry_date);
create index if not exists idx_kosu_entry_task   on kosu_entry (task_id);
create index if not exists idx_kosu_entry_person on kosu_entry (person_id);

-- 既定の担当者（入れ替わりは画面「担当者の管理」から操作）
insert into kosu_person (name, sort_order)
values ('田中', 1), ('長内', 2), ('原', 3)
on conflict (name) do nothing;

-- ログインセッション（不透明なIDをHttpOnly Cookieに保持）
-- 担当者マスタを参照するため、ログイン許可を外すと即座に無効化される
create table if not exists app_session (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references kosu_person(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists idx_app_session_expires on app_session (expires_at);
alter table app_session enable row level security;

-- ------------------------------------------------------------
-- RLS：本アプリは「サーバー側APIルート＋service_roleキー」からのみ
-- 読み書きします（service_role は RLS をバイパス）。
-- そのため RLS を有効化し、公開ポリシーは作りません（＝匿名アクセス拒否）。
-- 将来クライアントへ直接開放する場合のみポリシーを追加します。
-- ------------------------------------------------------------
alter table kosu_task   enable row level security;
alter table kosu_person enable row level security;
alter table kosu_entry  enable row level security;

-- ============================================================
-- ログイン許可リスト（招待制）
-- kosu_person に登録され、かつ active かつ can_login = true の
-- メールアドレスだけがログイン（アカウント作成）できるようにする。
-- 未許可のメールはログイン要求の時点で拒否される。
--
-- ※ Supabase ダッシュボードでも併せて設定してください：
--    Authentication → Providers → Email を有効化
--    Authentication → Sign In / Providers → "Allow new users to sign up" は
--    このトリガーがあるためONのままで安全（許可リスト外は弾かれる）。
-- ============================================================
create or replace function public.enforce_login_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.kosu_person p
    where p.email is not null
      and lower(p.email) = lower(new.email)
      and p.active
      and p.can_login
  ) then
    raise exception 'このメールアドレスはログインを許可されていません';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_login_allowlist on auth.users;
create trigger trg_enforce_login_allowlist
  before insert on auth.users
  for each row execute function public.enforce_login_allowlist();

-- 作業優先順（Regular Task / Ad Hoc Task を画面から並べ替えるため）
-- scope: 'regular'（案件タイプ）/ 'adhoc'（Ad Hocタスク名）
create table if not exists task_priority (
  scope      text not null,
  key        text not null,
  priority   int,
  updated_at timestamptz not null default now(),
  primary key (scope, key)
);
alter table task_priority enable row level security;

-- 作業ごとのアサイン（担当者）
-- 「誰が実際にやったか（kosu_entry）」ではなく「誰に割り当てているか（計画）」を持つ。
-- 1作業に複数人を割当可能。role='main' が主担当、'sub' が副担当。
-- 担当者は person_id で紐付けるので、改名しても過去のアサインが壊れない。
create table if not exists task_assign (
  scope      text not null,                 -- 'regular' / 'pending' / 'adhoc'
  key        text not null,                 -- 案件タイプ名 / Ad Hocタスク名
  person_id  uuid not null references kosu_person(id) on delete restrict,
  role       text not null default 'main',  -- main（主担当） / sub（副担当）
  updated_at timestamptz not null default now(),
  primary key (scope, key, person_id)
);
create index if not exists idx_task_assign_person on task_assign (person_id);
alter table task_assign enable row level security;

-- 画面から編集した内容の上書き保存
-- 元データ（Kintone / スプレッドシート）はそのままに、編集した項目だけを jsonb で持つ。
-- key は「元のタスク名」で固定するため、表示名を変更しても紐付けが切れない。
--   data 例: {"name":"ACQ（新）","start":"2026/04/01","status":"Onhold","memo":"..."}
create table if not exists task_override (
  scope      text not null,                    -- 'regular' / 'pending' / 'adhoc'
  key        text not null,                    -- 元のタスク名（不変の識別子）
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (scope, key)
);
alter table task_override enable row level security;

-- サイトで追加した Ad Hoc タスク
-- スプレッドシート由来のタスクとは別に持ち、画面で結合して表示する。
-- 各項目（開始・期日・進捗・メモ等）は task_override に、担当は task_assign に、
-- 優先順は task_priority に、いずれも key = タスク名 で保存される。
create table if not exists adhoc_task (
  id         uuid primary key default gen_random_uuid(),
  task       text not null unique,
  created_at timestamptz not null default now()
);
alter table adhoc_task enable row level security;

-- ------------------------------------------------------------
-- Kintone データのスナップショット（1行のみ）
-- 通常のページ表示はこの保存済みデータを読む（毎回 Kintone を叩かない）。
-- 更新は画面の「Kintone取込」ボタン（/api/kintone-sync）から手動で行う。
-- ------------------------------------------------------------
create table if not exists kintone_snapshot (
  id         smallint primary key default 1,
  data       jsonb not null,
  fetched_at timestamptz not null default now(),
  constraint kintone_snapshot_single check (id = 1)
);
alter table kintone_snapshot enable row level security;

-- ------------------------------------------------------------
-- Ad Hoc タスクの取り込み先（進捗シートから移行）
-- スプレッドシートを卒業するため、Ad Hoc の元データをここに保存する。
-- 通常表示はこのテーブルを読む（シートは取込ボタンのときだけ読む）。
-- 各項目の編集は task_override、担当は task_assign、優先は task_priority に
-- これまでどおり重ねる（このテーブルは「元データ」を持つ）。
-- ------------------------------------------------------------
create table if not exists adhoc_item (
  task       text primary key,        -- タスク名（不変の識別子）
  data       jsonb not null default '{}'::jsonb, -- シート由来の全項目
  updated_at timestamptz not null default now()
);
alter table adhoc_item enable row level security;

-- Ad Hoc タスクの「作業完了数」を保存する列（稼働時間は value、完了数は done_count）。
-- ※ 列名に count は使わない：PostgREST では count が集計関数の予約語と衝突するため。
-- Regular タスクは done_count は使わない（null）。
alter table kosu_entry add column if not exists done_count numeric;
