"use client";

import { useEffect, useState } from "react";

// 設計仕様書（管理者用）。
// 実装（app / lib / middleware / supabase）から起こした内容をそのまま載せる。
// コードを変更したときは、このページの該当箇所も併せて更新すること。

const SECTIONS = [
  { id: "overview", label: "1. システム概要" },
  { id: "arch", label: "2. アーキテクチャ" },
  { id: "dataflow", label: "3. データの流れ" },
  { id: "auth", label: "4. 認証・権限" },
  { id: "db", label: "5. データベース設計" },
  { id: "api", label: "6. API 一覧" },
  { id: "screens", label: "7. 画面仕様" },
  { id: "logic", label: "8. 主要ロジック" },
  { id: "security", label: "9. セキュリティ" },
  { id: "ops", label: "10. 運用・環境変数" },
];

/* ── 部品 ───────────────────────────────────────────── */
function Sec({ id, title, lead, children }) {
  return (
    <section className="spec-sec" id={id}>
      <h2 className="spec-h2">{title}</h2>
      {lead && <p className="spec-lead">{lead}</p>}
      {children}
    </section>
  );
}
const H3 = ({ children }) => <h3 className="spec-h3">{children}</h3>;
const P = ({ children }) => <p className="spec-p">{children}</p>;
const C = ({ children }) => <code className="spec-code">{children}</code>;
const Note = ({ children }) => <p className="spec-note">{children}</p>;
const Ul = ({ children }) => <ul className="spec-ul">{children}</ul>;

// HTTP メソッドのバッジ
function M({ m }) {
  return <span className={"spec-m spec-m-" + m.toLowerCase()}>{m}</span>;
}

// 表（head は文字列配列、rows はセルの配列。セルは文字列 or JSX）
function Tbl({ head, rows, cls = "" }) {
  return (
    <div className="spec-tw">
      <table className={"spec-table " + cls}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={i === 0 ? "l" : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci} className={ci === 0 ? "l" : undefined}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── API 定義（実装と1対1）───────────────────────────── */
const API_GROUPS = [
  {
    group: "認証",
    rows: [
      ["GET", "/api/auth/google", "公開", "Supabase の Google 認可URLへ 302。redirect_to=/auth/callback、prompt=select_account（共有PCでの取り違え防止）。"],
      ["POST", "/api/auth/session", "公開", "本文の access_token を Supabase /auth/v1/user で検証 → 許可リスト照合 → avatar_url / login_name / last_login_at を更新 → app_session を作成し Cookie agoda_sid を発行。"],
      ["POST", "/api/auth/login", "公開", "メール＋パスワードでログイン。既定は無効（403）。PASSWORD_LOGIN=1 のときだけ有効。"],
      ["GET", "/api/auth/me", "公開", "{ enabled, perms, user }。保護オフのときは FULL_PERMS を返す。全画面が権限判定に使う。"],
      ["POST", "/api/auth/logout", "公開", "app_session を削除し Cookie を Max-Age=0 で失効。"],
    ],
  },
  {
    group: "案件データ（Kintone）",
    rows: [
      ["GET", "/api/records", "ログイン", "① kintone_snapshot（60秒メモリキャッシュ）② 無ければ Kintone 直取得（3分キャッシュ）③ 未設定ならモック。"],
      ["GET", "/api/fields", "ログイン", "Kintone のフィールド定義（code / label / type）のみを軽量に返す。"],
      ["GET", "/api/kintone-sync", "ログイン", "スナップショットの最終取得時刻と件数（ボタン表示用）。"],
      ["POST", "/api/kintone-sync", "editTasks", "Kintone 全件＋フィールド定義を取得して kintone_snapshot を upsert。メモリキャッシュも破棄。"],
    ],
  },
  {
    group: "Ad Hoc タスク",
    rows: [
      ["GET", "/api/adhoc", "ログイン", "① adhoc_item（取込済み）② 未取込なら進捗シートを CSV で読む（3分キャッシュ）。"],
      ["GET", "/api/adhoc-import", "ログイン", "取込済み件数（ボタン状態用）。"],
      ["POST", "/api/adhoc-import", "editTasks", "進捗シートの ◆Ad Hoc Task 表をパースして adhoc_item に upsert。"],
      ["GET", "/api/adhoc-tasks", "ログイン", "サイトで追加した Ad Hoc タスク（adhoc_task）一覧。"],
      ["POST", "/api/adhoc-tasks", "editTasks", "adhoc_task に追加し、同名の kosu_task も作成する。body.board が regular なら task_type=Regular task、それ以外は Ad hoc task。"],
      ["DELETE", "/api/adhoc-tasks", "editTasks", "adhoc_task を削除し、scope=adhoc の override / assign / priority も削除。kosu_task は実績があれば active=false、無ければ削除。"],
      ["GET", "/api/adhoc-counts", "ログイン", "task_override(scope=adhoc) の sheetUrl / orderCell / doneCell から受注数・完了数のセルを読む（各セル60秒キャッシュ）。"],
    ],
  },
  {
    group: "タスクの設定（優先・担当・上書き）",
    rows: [
      ["GET", "/api/priority", "ログイン", "task_priority の全件。"],
      ["POST", "/api/priority", "editTasks", "scope / key / priority を upsert。priority が空なら null（＝優先なし）。"],
      ["GET", "/api/assign", "ログイン", "task_assign と担当者マスタ。退職者も active=false 付きで返す（完了タスクの「当時の担当者」を表示・設定できるようにするため）。ready=false はテーブル未作成。"],
      ["POST", "/api/assign", "editTasks", "personIds の並び順で差し替え保存。先頭が role=main、以降 sub。空配列で全解除。"],
      ["GET", "/api/override", "ログイン", "task_override の全件（全 scope）。"],
      ["POST", "/api/override", "editTasks", "data を丸ごと保存（部分マージなし）。空文字・null の項目は保存せず、全項目が空なら行ごと削除して元データに戻す。文字列は 2000 文字で切る。"],
    ],
  },
  {
    group: "工数",
    rows: [
      ["GET", "/api/kosu", "ログイン", "工数明細の全データ（months / dates / isoDates / dateMonthIdx / holidayOf / dowOf / rows）を Supabase から組み立てる（60秒キャッシュ）。?list=1 で作業内容一覧のみ。"],
      ["GET", "/api/kosu-tasks", "ログイン", "作業マスタ（active）。task_override(scope=adhoc) の name で表示名を差し替え、kosuLink でまとめた元タスクは除外（ただし実績があるものは残す）。?all=1 で無効化・集約したものも含む全件を返す（工数入力で「その日に記録がある作業」を出すのに使う・除外なし）。"],
      ["POST", "/api/kosu-tasks", "editTasks", "作業内容の追加。"],
      ["PATCH", "/api/kosu-tasks", "editTasks", "作業内容の更新（並べ替え・単位・active・completed）。completed 切替時に completed_on も更新。"],
      ["GET", "/api/kosu-entries", "ログイン", "?date= で1日ぶん、?from=&to= で期間ぶん（1000件超は offset で全件取得）。"],
      ["POST", "/api/kosu-entries", "ログイン（自分ぶん）", "(entry_date, task_id, person_id) で upsert。value と done_count が両方空なら削除。オーナー・管理者以外は自分の person_id 以外を含むと拒否。"],
      ["POST", "/api/kosu-import", "editTasks", "作業工数管理シートの過去データを kosu_entry に取り込む（移行用）。不足する kosu_task を作成し、Ad Hoc は実績者を task_assign に登録。"],
      ["GET", "/api/kosu-status", "ログイン", "Supabase 接続状態と担当者一覧（id / name / role / active）。退職者も active=false 付きで返す（工数入力で過去の記録がある日だけ列を出すため）。"],
      ["GET", "/api/resource", "ログイン", "週次リソース。① kosu_entry から集計 ② 実績が無ければ作業リソースシートを読む（移行前の互換）。"],
    ],
  },
  {
    group: "アカウント・権限",
    rows: [
      ["GET", "/api/kosu-persons", "ログイン", "担当者一覧。?all=1 で退職者を含む全件。"],
      ["POST", "/api/kosu-persons", "editAccounts", "担当者の追加。役割・個別付与を設定できるのは grantPerms（オーナー）のみ。それ以外が作成すると必ず member・権限なし。"],
      ["PATCH", "/api/kosu-persons", "editAccounts", "改名・メール・並び順・退職／復帰など。role / can_edit_* の変更はオーナーのみ（403）。メール未設定で can_login=true は拒否。退職にするとログインセッション（app_session）だけ削除し、担当割当と実績は履歴として残す。"],
      ["DELETE", "/api/kosu-persons", "editAccounts", "完全削除。kosu_entry が1件でもあれば拒否（「退職」を案内）。assign / session を外してから削除し、Supabase Auth のユーザーも best-effort で削除。"],
      ["POST", "/api/kosu-persons/password", "—（緊急用）", "管理者がログインパスワードを設定／変更。パスワードは Supabase に渡すだけで保存・記録しない。"],
      ["GET", "/api/page-perms", "viewAccounts", "対象ユーザーの実効ページ権限（既定＋保存済みの上書き）。"],
      ["PUT", "/api/page-perms", "editAccounts", "ページ権限を保存。既知のページキーのみに正規化し、editable=false のページの edit は必ず false。オーナーは常に全権のため設定不可。"],
    ],
  },
  {
    group: "スプレッドシート連携",
    rows: [
      ["GET", "/api/form-config", "ログイン", "読み取り方式（service / public）とサービスアカウントのメール。"],
      ["GET", "/api/form-sheets", "ログイン", "登録済みフォームシート一覧（task_override scope=form）。"],
      ["POST / PATCH / DELETE", "/api/form-sheets", "editTasks", "フォームシートの登録・編集・削除。id は randomUUID。"],
      ["GET", "/api/form-sheet-counts", "ログイン", "各シートの総件数・今月分・最終回答日時（先頭列をタイムスタンプとみなす。60秒キャッシュ）。"],
      ["GET", "/api/form-sheet-data", "ログイン", "指定シートの中身を { headers, rows, total, truncated } で返す。"],
      ["GET", "/api/work-requests", "ログイン", "作業依頼シートの登録（task_override scope=workreq）。"],
      ["POST / PATCH / DELETE", "/api/work-requests", "workReq 編集", "作業依頼シートの登録・編集・削除。"],
      ["GET", "/api/work-request-counts", "ログイン", "作業依頼シートの件数。"],
      ["GET", "/api/work-request-data", "ログイン", "シートの中身＋行キー＋手動入力の overlay（scope=workreqcell）をまとめて返す。"],
      ["POST", "/api/work-request-cell", "workReq 編集", "1行ぶんの手動入力（レコード作成 / レコードNo / 作業完了日）を保存。key は「シートID::行キー」。"],
      ["GET", "/api/hid-requests", "ログイン", "HID新規発行依頼の全行（task_override scope=hidreq）。"],
      ["POST / PATCH / DELETE", "/api/hid-requests", "hid 編集", "行の追加・項目更新（fields をマージ）・削除。"],
    ],
  },
  {
    group: "システム",
    rows: [
      ["GET", "/api/system-health", "viewAccounts", "RPC sys_health() / sys_tables() ＋ 取り込み状況＋増加ペース＋容量。各処理を個別に try/catch し、片方が落ちても他は返す。"],
    ],
  },
];

export default function DesignSpecPage() {
  const [active, setActive] = useState(SECTIONS[0].id);

  // 現在読んでいる位置を目次に反映する
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean);
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: "-72px 0px -70% 0px", threshold: 0 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const jump = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    setActive(id);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="wrap page-compact spec-page">
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
          <span className="spec-ver">Agoda Management System</span>
        </div>
      </div>

      <div className="spec-layout">
        {/* 目次 */}
        <nav className="spec-toc" aria-label="目次">
          <div className="spec-toc-h">目次</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={"spec-toc-item" + (active === s.id ? " active" : "")}
              onClick={() => jump(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="spec-body">
          {/* ───────────── 1. 概要 ───────────── */}
          <Sec
            id="overview"
            title="1. システム概要"
            lead="Agoda 案件（施設の YCS 登録・CM 接続作業）の進捗と、担当メンバーの作業工数を1か所で管理するための社内向け Web アプリケーション。"
          >
            <H3>目的</H3>
            <Ul>
              <li>Kintone に入っている案件データを取り込み、案件タイプ別・ステータス別・四半期別に可視化する。</li>
              <li>スプレッドシートで運用していた Regular / Ad Hoc タスクの管理と工数入力を、サイト上に移行する。</li>
              <li>HID 新規発行依頼・新規作業依頼・フォーム回答といった周辺業務を同じ画面から扱えるようにする。</li>
              <li>役割とページ単位の権限で、誰が何を見て編集できるかを管理する。</li>
            </Ul>

            <H3>技術構成</H3>
            <Tbl
              head={["区分", "採用しているもの", "備考"]}
              rows={[
                ["フレームワーク", <>Next.js 15（App Router）</>, "画面は Client Component、サーバー処理は Route Handler。"],
                ["言語", "JavaScript（TypeScript 不使用）", "型定義ファイルは持たない。"],
                ["UI", "React 19 / プレーン CSS 1ファイル", <>UI ライブラリなし。<C>app/globals.css</C> に全スタイルを集約し、<C>:root</C> のカラートークンで統一。</>],
                ["アイコン", "インライン SVG", "アイコンライブラリは使わない。"],
                ["データベース", "Supabase（PostgreSQL）", <>SDK は使わず PostgREST を <C>fetch</C> で叩く。</>],
                ["認証", "Supabase Auth（Google）＋ 自前セッション", "Cookie には不透明なセッションIDのみを入れる。"],
                ["外部データ", "Kintone REST API / Google Sheets", "Sheets はサービスアカウント（JWT 自前署名）または公開 CSV。"],
                ["ホスティング", <>Vercel（リージョン <C>sin1</C>）</>, <><C>vercel.json</C> で指定。</>],
                ["依存パッケージ", <><C>next</C> / <C>react</C> / <C>react-dom</C> のみ</>, "ライブラリを増やさない方針。JWT 署名も Node 標準 crypto で行う。"],
              ]}
            />

            <Note>
              この仕様書は実装（<C>app/</C>・<C>lib/</C>・<C>middleware.js</C>・<C>supabase/</C>）から起こしたもの。
              コードを変更したときは、該当する章も併せて更新すること。
            </Note>
          </Sec>

          {/* ───────────── 2. アーキテクチャ ───────────── */}
          <Sec
            id="arch"
            title="2. アーキテクチャ"
            lead="ブラウザは Supabase・Kintone・Google に直接アクセスしない。必ず自サイトの /api/* を経由し、機密キーはサーバー側だけで使う。"
          >
            <H3>レイヤー構成</H3>
            <div className="spec-flow">
              <div className="spec-flow-step">
                <span className="spec-flow-n">1</span>
                <div>
                  <b>ブラウザ（Client Component）</b>
                  <span>各ページが <C>fetch(&quot;/api/...&quot;)</C> でデータを取得・保存する。権限は <C>/api/auth/me</C> で取得して表示を出し分ける。</span>
                </div>
              </div>
              <div className="spec-flow-step">
                <span className="spec-flow-n">2</span>
                <div>
                  <b>middleware.js</b>
                  <span>全リクエストの入口。セッション検証と「ページ閲覧権限」のチェックを行い、未認証は <C>/login</C>（API は 401 JSON）へ。</span>
                </div>
              </div>
              <div className="spec-flow-step">
                <span className="spec-flow-n">3</span>
                <div>
                  <b>Route Handler（app/api/**/route.js）</b>
                  <span>すべて <C>dynamic = &quot;force-dynamic&quot;</C>。書き込み系は先頭で <C>denyUnlessPerm</C> / <C>denyUnlessPageEdit</C> により権限を再チェックする。</span>
                </div>
              </div>
              <div className="spec-flow-step">
                <span className="spec-flow-n">4</span>
                <div>
                  <b>lib/（サーバー共通処理）</b>
                  <span>Supabase・Kintone・Sheets へのアクセスと、キャッシュ・権限計算・祝日計算などの純粋なロジック。</span>
                </div>
              </div>
              <div className="spec-flow-step">
                <span className="spec-flow-n">5</span>
                <div>
                  <b>外部（Supabase / Kintone / Google Sheets）</b>
                  <span>Supabase は PostgREST（<C>service_role</C> キー）。Kintone は API トークン。Sheets はサービスアカウントまたは公開 CSV。</span>
                </div>
              </div>
            </div>

            <H3>主なファイル</H3>
            <Tbl
              head={["ファイル", "役割"]}
              rows={[
                [<C>app/layout.js</C>, <>ルートレイアウト。<C>&lt;html lang=&quot;ja&quot;&gt;</C> と <C>Shell</C> を置くだけ。</>],
                [<C>app/Shell.js</C>, <>サイドバー＋メインの枠。<C>/login</C> 配下だけメニューを出さない。<C>UiProvider</C> と <C>NavLoadingProvider</C> を張る。</>],
                [<C>app/Nav.js</C>, "左サイドバー。ユーザー用／管理者用をラインで区切り、各タブはページ閲覧権限で出し分ける。"],
                [<C>app/TaskBoard.js</C>, <>ダッシュボード（<C>mode=&quot;view&quot;</C>）とプロジェクト管理（<C>mode=&quot;edit&quot;</C>）で共有する中核コンポーネント。</>],
                [<C>app/kosu/DetailTable.js</C>, "工数明細（日次グリッド）の組み立て。"],
                [<C>app/PageIcons.js</C>, "ページごとのアイコン。サイドバーとページ権限モーダルで同じ絵柄を使う。"],
                [<C>app/Ui.js</C>, "画面共通の UI（中央スピナー・完了チェック・トースト・保存完了メッセージ）。"],
                [<C>app/NavLoading.js</C>, "メニュー遷移時の全画面ローディング。URL 変化で自動解除。"],
                [<C>app/Modal.js</C>, <>共通モーダル。ブラウザ標準の <C>confirm/alert</C> は使わない。</>],
                [<C>lib/supabase.js</C>, <>PostgREST の薄いラッパ（<C>sb</C>）と全件取得（<C>sbAll</C>）。</>],
                [<C>lib/auth.js</C>, "セッション取得・許可リスト照会・権限チェックのヘルパー。"],
                [<C>lib/perms.js</C>, "役割＋個別付与から実効権限を算出。"],
                [<C>lib/pages.js</C>, "ページのカタログと、ページ単位の権限計算。"],
                [<C>lib/cache.js</C>, "サーバー内メモリキャッシュ（期限切れ後も古い値を返しつつ裏で更新）。"],
                [<C>lib/kintone.js</C> , "Kintone REST API（レコード全件・フィールド定義）。"],
                [<C>lib/kintoneSnapshot.js</C>, "Kintone 取得結果の Supabase 保存・読み出し。"],
                [<C>lib/googleSheetsApi.js</C>, "サービスアカウントで Sheets API を読む（JWT を crypto で自前署名）。"],
                [<C>lib/formSheet.js</C> , "シート1タブを表として読む（サービスアカウント優先、無ければ公開 CSV）。"],
                [<C>lib/sheetCell.js</C>, "シートの特定セルを1つ読む／URL からシートID・gid を抽出。"],
                [<C>lib/adhocSheet.js</C> , "進捗シートの ◆Ad Hoc Task 表のパーサ。"],
                [<C>lib/adhocStore.js</C>, <>Ad Hoc の Supabase 保存（<C>adhoc_item</C>）。</>],
                [<C>lib/kosuSheet.js</C>, "作業工数管理シートのパーサ（移行用）。"],
                [<C>lib/holidays.js</C>, "日本の祝日をコードで算出（外部 API に依存しない）。"],
              ]}
            />
          </Sec>

          {/* ───────────── 3. データフロー ───────────── */}
          <Sec
            id="dataflow"
            title="3. データの流れ"
            lead="外部データは「手動ボタンで取り込み → Supabase に保存 → 通常表示は保存済みを読む」が基本方針。毎回の表示で外部 API を叩かない。"
          >
            <H3>案件データ（Kintone）</H3>
            <P>
              画面の「Kintone取込」ボタン → <C>POST /api/kintone-sync</C> → Kintone 全件＋フィールド定義を取得 →{" "}
              <C>kintone_snapshot</C>（1行）に upsert。通常表示の <C>GET /api/records</C> はこのスナップショットを読む。
              スナップショットが無い環境では Kintone を直接取得し、成功したら裏で保存する。Kintone 未設定ならモックデータを返す。
            </P>

            <H3>Ad Hoc タスク（進捗シート）</H3>
            <P>
              「進捗シート取込」→ <C>POST /api/adhoc-import</C> → シートの ◆Ad Hoc Task 表をパースして{" "}
              <C>adhoc_item</C> に upsert。通常表示の <C>GET /api/adhoc</C> は <C>adhoc_item</C> を読み、
              1件も無いときだけシートを読む（移行前の互換経路）。
            </P>

            <H3>工数</H3>
            <P>
              工数入力画面 → <C>POST /api/kosu-entries</C> → <C>kosu_entry</C>（日付 × 作業 × 担当者）。
              工数明細（<C>GET /api/kosu</C>）と週次リソース（<C>GET /api/resource</C>）は、この <C>kosu_entry</C> から集計する。
              スプレッドシートには依存しない（<C>/api/kosu-import</C> は過去データの移行用）。
            </P>

            <H3>スプレッドシート（都度読み取り）</H3>
            <P>
              フォーム回答・新規作業依頼・Ad Hoc の受注数／完了数セルだけは、登録された URL を都度読む。
              いずれも 60 秒のメモリキャッシュを挟む。読み取りは、サービスアカウントが設定されていれば Sheets API（非公開シートを閲覧共有で読める）、
              未設定なら <C>export?format=csv</C>（リンク共有シートのみ）。
            </P>

            <H3>キャッシュ一覧</H3>
            <Tbl
              head={["対象", "TTL", "実装場所"]}
              rows={[
                ["Kintone スナップショットの読み出し", "60 秒", <><C>/api/records</C>（<C>records:snapshot</C>）</>],
                ["Kintone 直取得", "3 分", <><C>/api/records</C>（<C>kintone:records</C>）</>],
                ["進捗シート／作業リソースシートの CSV", "3 分", <><C>/api/adhoc</C>・<C>/api/resource</C></>],
                ["工数明細の組み立て結果", "60 秒", <><C>/api/kosu</C>（<C>kosu:detail</C>・<C>kosu:contents</C>）</>],
                ["フォーム／作業依頼シートのグリッド", "60 秒", <><C>formgrid:*</C>・<C>workreqgrid:*</C></>],
                ["Ad Hoc の連携セル", "60 秒", <><C>sheetcell:*</C></>],
                ["セッション検証結果", "60 秒", <><C>middleware.js</C>（sid 単位）</>],
                ["ページ権限", "30〜60 秒", <><C>lib/auth.js</C>（30秒）／<C>middleware.js</C>（60秒）</>],
                ["保護の有効判定", "5 分", <><C>authEnabled()</C>（<C>middleware.js</C> と <C>lib/auth.js</C>）</>],
                ["Google アクセストークン", "有効期限まで", <><C>lib/googleSheetsApi.js</C></>],
              ]}
            />
            <Note>
              <C>lib/cache.js</C> は「期限切れでも古い値をすぐ返し、裏側で取り直す」方式。待たされるのは初回だけで、
              同時に来たリクエストは1回の取得にまとめられる。保存直後は <C>invalidate(prefix)</C> で明示的に捨てる。
            </Note>
          </Sec>

          {/* ───────────── 4. 認証・権限 ───────────── */}
          <Sec
            id="auth"
            title="4. 認証・権限"
            lead="ログインは Google のみ。Cookie には推測不能なセッションIDだけを入れ、実体は Supabase の app_session に置く。"
          >
            <H3>ログインの流れ</H3>
            <div className="spec-flow">
              <div className="spec-flow-step">
                <span className="spec-flow-n">1</span>
                <div>
                  <b>/login</b>
                  <span>「Google でログイン」→ <C>/api/auth/google</C>。</span>
                </div>
              </div>
              <div className="spec-flow-step">
                <span className="spec-flow-n">2</span>
                <div>
                  <b>/api/auth/google</b>
                  <span>Supabase の <C>/auth/v1/authorize?provider=google&amp;redirect_to=&lt;origin&gt;/auth/callback&amp;prompt=select_account</C> へ 302。</span>
                </div>
              </div>
              <div className="spec-flow-step">
                <span className="spec-flow-n">3</span>
                <div>
                  <b>/auth/callback</b>
                  <span>URL フラグメントの <C>access_token</C> を読み取り、直ちにアドレスバーから消す（URL の使い回しでログインされるのを防ぐため、0/60/200/600ms で繰り返し消去）。</span>
                </div>
              </div>
              <div className="spec-flow-step">
                <span className="spec-flow-n">4</span>
                <div>
                  <b>POST /api/auth/session</b>
                  <span>Supabase 側でトークンを検証 → 許可リスト照合 → Google の写真・アカウント名・最終ログイン時刻を <C>kosu_person</C> に記録 → <C>app_session</C> を作成 → Cookie を発行。</span>
                </div>
              </div>
              <div className="spec-flow-step">
                <span className="spec-flow-n">5</span>
                <div>
                  <b>/dashboard へ</b>
                  <span><C>window.location.replace</C> によるフルリロード。クライアント遷移だと発行直後の Cookie が初回 RSC リクエストに乗らず、middleware に弾かれたうえ「無効な sid」としてキャッシュされてしまうため。</span>
                </div>
              </div>
            </div>

            <H3>セッション</H3>
            <Tbl
              head={["項目", "値"]}
              rows={[
                ["Cookie 名", <C>agoda_sid</C>],
                ["Cookie 属性", <><C>Path=/; HttpOnly; Secure（本番）; SameSite=Lax; Max-Age=30日</C></>],
                ["中身", "セッションID（UUID）のみ。役割やメールは入れない。"],
                ["実体", <><C>app_session</C>（person_id / email / expires_at）を <C>kosu_person</C> と inner join して検証。</>],
                ["失効条件", <>期限切れ、<C>active=false</C>、<C>can_login=false</C>、退職処理、ログアウト。</>],
              ]}
            />
            <Note>
              JWT ではなく不透明IDにしているのは、<b>ログイン許可を外した瞬間にアクセスを止められる</b>ため
              （JWT だと有効期限が切れるまで通ってしまう）。退職処理では <C>app_session</C> も削除する。
            </Note>

            <H3>許可リスト（招待制）</H3>
            <P>
              ログインできるのは、<C>kosu_person</C> にメールが登録されていて <C>active=true</C> かつ <C>can_login=true</C> の人だけ。
              アプリ側（<C>findAllowedPerson</C>）に加えて、DB トリガー <C>enforce_login_allowlist</C> が{" "}
              <C>auth.users</C> の INSERT を弾くため、Supabase 側で直接サインアップされても許可リスト外は登録できない。
            </P>

            <H3>役割と個別付与</H3>
            <Tbl
              head={["役割", "内容"]}
              rows={[
                ["owner（オーナー）", "常に全ページの閲覧・編集が可能。役割と権限フラグを変更できるのはオーナーだけ。ページ権限の保存対象外（保存値を無視して常に全権）。"],
                ["admin（管理者）", "既定で全ページ閲覧可。編集は「個別に許可された項目」のみ。"],
                ["member（メンバー）", "業務系ページの閲覧と、工数入力の編集のみ。管理系ページは開けない。"],
              ]}
            />
            <Tbl
              head={["個別付与フラグ（kosu_person）", "効果"]}
              rows={[
                [<C>can_edit_accounts</C>, "アカウント管理を編集できる（admin のみ意味を持つ）。"],
                [<C>can_edit_tasks</C>, "プロジェクト管理・HID新規発行依頼・新規作業依頼を編集できる（admin のみ意味を持つ）。"],
              ]}
            />

            <H3>ページ権限</H3>
            <P>
              ページのカタログは <C>lib/pages.js</C> の <C>PAGE_GROUPS</C> に定義する。各ページは{" "}
              <C>key / label / path / editable</C> を持ち、<C>editable=false</C> のページは編集対象外（一覧では「—」表示、edit は常に false）。
              保存先は <C>task_override</C> の <C>scope=&quot;pageperm&quot;</C>・<C>key=personId</C>・<C>data.pages</C>。
            </P>
            <Tbl
              head={["ページ", "key", "パス", "編集"]}
              rows={[
                ["ダッシュボード", <C>dashboard</C>, <C>/dashboard</C>, "—"],
                ["施設一覧", <C>facilities</C>, <C>/</C>, "—"],
                ["工数管理", <C>kosu</C>, <C>/kosu</C>, "—"],
                ["工数入力", <C>kosuInput</C>, <C>/kosu/input</C>, "あり"],
                ["HID新規発行依頼", <C>hid</C>, <C>/hid-requests</C>, "あり"],
                ["新規作業依頼", <C>workReq</C>, <C>/work-requests</C>, "あり"],
                ["フォーム回答", <C>forms</C>, <C>/forms</C>, "—"],
                ["プロジェクト管理", <C>project</C>, <C>/project</C>, "あり"],
                ["アカウント管理", <C>accounts</C>, <C>/kosu/persons</C>, "あり"],
                ["設計仕様書", <C>designSpec</C>, <C>/design-spec</C>, "—"],
                ["システムヘルス", <C>systemHealth</C>, <C>/system-health</C>, "—"],
              ]}
            />
            <P>
              <C>computePages(role, cea, cet, stored)</C> が既定値に保存済みの上書きをマージして実効値を出す。
              オーナーは既定（全権）をそのまま返し、保存値を見ない。<C>defaultPagePerms</C> の既定は次のとおり。
            </P>
            <Tbl
              head={["役割", "閲覧の既定", "編集の既定"]}
              rows={[
                ["owner", "全ページ", <>編集可能な全ページ（<C>editable=true</C> のもの）</>],
                ["admin", "全ページ", <><C>kosuInput</C> は常に可。<C>accounts</C> は <C>can_edit_accounts</C>、<C>project</C>・<C>hid</C>・<C>workReq</C> は <C>can_edit_tasks</C> に従う。</>],
                ["member", "業務グループのみ（ダッシュボード／施設一覧／工数管理／工数入力／HID／新規作業依頼／フォーム回答）", <><C>kosuInput</C> のみ</>],
              ]}
            />

            <H3>実効権限（perms）</H3>
            <P>
              <C>effectivePerms()</C> はページ権限を計算したうえで、従来からある粗いフラグをそこから導出する。
              画面側は <C>/api/auth/me</C> が返すこの値で表示を出し分ける。
            </P>
            <Tbl
              head={["フラグ", "導出元"]}
              rows={[
                [<C>viewAccounts</C>, <C>pages.accounts.view</C>],
                [<C>editAccounts</C>, <C>pages.accounts.edit</C>],
                [<C>editTasks</C>, <C>pages.project.edit</C>],
                [<C>editKosu</C>, <C>pages.kosuInput.edit</C>],
                [<C>grantPerms</C>, <>役割が <C>owner</C> のときだけ true</>],
              ]}
            />

            <H3>middleware による強制</H3>
            <Ul>
              <li>
                認証不要パス：<C>/login</C>・<C>/auth/callback</C>・<C>/api/auth/*</C>（login / google / session / logout / me）。
              </li>
              <li>
                未認証：API は <C>401 {"{ error: \"認証が必要です\" }"}</C>、画面は{" "}
                <C>/login?next=&lt;元のパス&gt;</C> へリダイレクトし Cookie を削除。
              </li>
              <li>
                ページ閲覧権限：画面のみチェックする（API は各ルートの権限チェックに任せる）。閲覧不可なら、
                その人が閲覧できる先頭のページへ寄せる。オーナーは常に素通り。
              </li>
              <li>
                <C>matcher</C> で <C>_next/</C>・画像・静的ファイルを除外し、Supabase への問い合わせを減らす。
              </li>
              <li>
                <C>AUTH_REQUIRED=1</C> のときは、許可リストの照会が一時的に失敗しても保護を解除しない（本番では必ず設定する）。
                未設定時は「許可リストに在籍者がいる」かつ「パスワード設定済みの Auth ユーザーが1件以上ある」場合にだけ保護が有効になる
                （初期設定中の締め出しを防ぐため）。
              </li>
            </Ul>
            <Note>
              画面の出し分けだけに頼らず、書き込み系 API は必ずサーバー側でも権限を確認する
              （<C>denyUnlessPerm(req, key)</C> ／ ページ単位の <C>denyUnlessPageEdit(req, pageKey)</C>）。
            </Note>
          </Sec>

          {/* ───────────── 5. DB ───────────── */}
          <Sec
            id="db"
            title="5. データベース設計"
            lead="Supabase（PostgreSQL）。全テーブルで RLS を有効化し、ポリシーは作らない。アプリはサーバー側から service_role キーでアクセスする（RLS をバイパス）。"
          >
            <H3>kosu_person（担当者マスタ）</H3>
            <Tbl
              head={["列", "型", "説明"]}
              rows={[
                [<C>id</C>, "uuid PK", "既定 gen_random_uuid()。"],
                [<C>name</C>, "text NOT NULL", "氏名。一意インデックスあり。"],
                [<C>email</C>, "text", "ログイン用メール。小文字で一意（NULL 可）。"],
                [<C>can_login</C>, "boolean", "ログイン許可。既定 false。"],
                [<C>role</C>, "text", "owner / admin / member。既定 member。"],
                [<C>can_edit_accounts</C>, "boolean", "アカウント管理の編集を個別に許可。"],
                [<C>can_edit_tasks</C>, "boolean", "タスクの編集を個別に許可。"],
                [<C>sort_order</C>, "int", "表示順（ドラッグで振り直す）。"],
                [<C>active</C>, "boolean", "在籍。退職は false（実績は残す）。"],
                [<C>joined_on / left_on</C>, "date", "入社日・退職日。"],
                [<C>avatar_url / login_name / last_login_at</C>, "text / text / timestamptz", "ログイン時に Google から取得して記録。"],
              ]}
            />

            <H3>kosu_task（作業マスタ）</H3>
            <Tbl
              head={["列", "型", "説明"]}
              rows={[
                [<C>id</C>, "uuid PK", ""],
                [<C>task_type</C>, "text", "Regular task / Ad hoc task / その他。"],
                [<C>content</C>, "text", "作業内容（作成時の名前で固定。改名は task_override 側で持つ）。"],
                [<C>unit</C>, "text", "count（件数）/ time（時間）。既定 count。"],
                [<C>sort_order / active</C>, "int / boolean", "表示順・有効。"],
                [<C>completed / completed_on</C>, "boolean / date", "完了。工数明細の「完了」タブ判定に使う。"],
              ]}
            />

            <H3>kosu_entry（日次の工数実績）</H3>
            <Tbl
              head={["列", "型", "説明"]}
              rows={[
                [<C>entry_date</C>, "date", "対象日。"],
                [<C>task_id</C>, "uuid FK", <><C>kosu_task</C> 参照（ON DELETE CASCADE）。</>],
                [<C>person_id</C>, "uuid FK", <><C>kosu_person</C> 参照（ON DELETE RESTRICT＝実績があると担当者を消せない）。</>],
                [<C>value</C>, "numeric", "Regular は件数または時間。Ad Hoc は稼働時間（h）。"],
                [<C>done_count</C>, "numeric", "Ad Hoc の完了数（件）。Regular は null。"],
                [<C>updated_at</C>, "timestamptz", ""],
                ["一意制約", <C>(entry_date, task_id, person_id)</C>, "upsert のキー。"],
              ]}
            />
            <Note>
              列名に <C>count</C> を使っていないのは、PostgREST で集計関数の予約語と衝突するため（<C>done_count</C> にしている）。
            </Note>

            <H3>task_override（画面で編集した内容の上書き・汎用KVS）</H3>
            <P>
              主キーは <C>(scope, key)</C>、値は <C>data</C>（jsonb）。元データ（Kintone / シート）は書き換えず、
              編集した項目だけをここに重ねる。<b>key は「元のタスク名」で固定する</b>ので、表示名を変更しても紐付けが切れない。
              新しいテーブルを増やさずに済むよう、依頼系のデータもこのテーブルに入れている。
            </P>
            <Tbl
              head={["scope", "key", "data の中身"]}
              rows={[
                [<C>regular</C>, "案件タイプ名", <><C>name</C> / <C>status</C> など（Regular Task 表の上書き）。</>],
                [<C>pending</C>, "案件タイプ名", "前年繰越（Pending）表の上書き。"],
                [<C>adhoc</C>, "Ad Hoc タスク名", <><C>name</C>・<C>status</C>・<C>start</C>・<C>end</C>・<C>total</C>・<C>done</C>・<C>daily</C>・<C>effort</C>・<C>issue</C>・<C>next</C>・<C>memo</C>・<C>seq</C>（手動並び）・<C>board</C>（区分）・<C>kosuLink</C>（工数グルーピング先）・<C>sheetUrl</C>/<C>orderCell</C>/<C>doneCell</C>（シート連携）。</>],
                [<C>form</C>, "UUID", <><C>title</C> / <C>url</C> / <C>description</C> / <C>sort</C>（フォーム回答シートの登録）。</>],
                [<C>workreq</C>, "UUID", <><C>title</C> / <C>url</C> / <C>sort</C>（作業依頼シートの登録）。</>],
                [<C>workreqcell</C>, <C>&lt;シートID&gt;::&lt;行キー&gt;</C>, <><C>created</C> / <C>recordNo</C> / <C>doneDate</C>（作業依頼シートの手動入力3項目）。</>],
                [<C>hidreq</C>, "UUID", <><C>fields</C>（HID依頼の全項目）/ <C>sort</C> / <C>createdAt</C>。</>],
                [<C>pageperm</C>, <C>person_id</C>, <><C>pages</C>（ページキー → {"{ view, edit }"}）。</>],
              ]}
            />

            <H3>その他のテーブル</H3>
            <Tbl
              head={["テーブル", "主キー", "説明"]}
              rows={[
                [<C>task_priority</C>, <C>(scope, key)</C>, <><C>priority</C>（int, null 可）。作業の優先順。null／0 は「優先なし」。</>],
                [<C>task_assign</C>, <C>(scope, key, person_id)</C>, <><C>role</C> は main（主担当）/ sub。「誰に割り当てているか（計画）」を持つ。person_id 紐付けなので改名に強い。</>],
                [<C>adhoc_task</C>, <C>id</C>, <>サイトで追加した Ad Hoc タスク（<C>task</C> は一意）。シート由来の分と画面で結合して表示する。</>],
                [<C>adhoc_item</C>, <C>task</C>, <>進捗シートから取り込んだ Ad Hoc の元データ（<C>data</C> jsonb）。</>],
                [<C>kintone_snapshot</C>, <><C>id</C>（常に 1）</>, <>Kintone の取得結果（<C>data</C> jsonb, 約7MB）と <C>fetched_at</C>。<C>check (id = 1)</C> で1行に固定。</>],
                [<C>app_session</C>, <C>id</C>, <>ログインセッション。<C>person_id</C>（CASCADE）・<C>email</C>・<C>expires_at</C>。</>],
              ]}
            />

            <H3>RPC（システムヘルス用）</H3>
            <Tbl
              head={["関数", "内容"]}
              rows={[
                [<C>public.sys_health()</C>, <>接続数・キャッシュヒット率・コミット／ロールバック・<C>max_connections</C>・稼働時間・全DB合計サイズ・バージョンを jsonb で返す。</>],
                [<C>public.sys_tables()</C>, <><C>pg_stat_user_tables</C>（<C>schemaname = 'public'</C>）から、行数・不要タプル・サイズ・Seq/Idx スキャン・最終 VACUUM を返す。</>],
              ]}
            />
            <Note>
              いずれも <C>SECURITY DEFINER</C>（所有者は postgres 想定）。<C>revoke all ... from public, anon, authenticated</C> したうえで{" "}
              <C>service_role</C> にだけ <C>execute</C> を付与している。2つに分けているのは、片方が取れなくてももう一方は表示できるようにするため。
            </Note>
          </Sec>

          {/* ───────────── 6. API ───────────── */}
          <Sec
            id="api"
            title="6. API 一覧"
            lead="すべて app/api/**/route.js の Route Handler。dynamic = force-dynamic。エラーはメッセージを JSON で返し、多くは HTTP 200 のまま { error } を返して画面側で表示する。"
          >
            {API_GROUPS.map((g) => (
              <div key={g.group} className="spec-apigrp">
                <H3>{g.group}</H3>
                <div className="spec-tw">
                  <table className="spec-table spec-api">
                    <thead>
                      <tr>
                        <th className="l">メソッド</th>
                        <th className="l">パス</th>
                        <th className="l">必要な権限</th>
                        <th className="l">処理</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r, i) => (
                        <tr key={i}>
                          <td className="l spec-mcell">
                            {r[0].split(" / ").map((m) => (
                              <M key={m} m={m} />
                            ))}
                          </td>
                          <td className="l">
                            <code className="spec-code">{r[1]}</code>
                          </td>
                          <td className="l spec-permcell">{r[2]}</td>
                          <td className="l">{r[3]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            <H3>共通の約束ごと</H3>
            <Ul>
              <li>
                Supabase 未設定のときは例外を投げず <C>{"{ configured: false }"}</C> などを返し、画面がデモ表示に落ちるようにする。
              </li>
              <li>
                テーブル未作成のときも壊れないように、一覧系は <C>ready: false</C> を返して画面側で判断する（<C>/api/assign</C>・<C>/api/override</C>・<C>/api/adhoc-tasks</C>）。
              </li>
              <li>
                ログイン経路（<C>/api/auth/login</C>・<C>/api/auth/session</C>）は未ログインでも叩けるため、
                例外の内容はレスポンスに出さずサーバーログにのみ残す。
              </li>
              <li>
                PostgREST は 1 リクエスト最大 1000 件で打ち切るため、期間の広い取得は <C>sbAll()</C> が
                <C>offset</C> ページングで全件を取り切る（安定した <C>order</C> を必ず含める）。
              </li>
            </Ul>
          </Sec>

          {/* ───────────── 7. 画面 ───────────── */}
          <Sec
            id="screens"
            title="7. 画面仕様"
            lead="サイドバーは「ユーザー用」と「管理者用」を区切り線で分け、各タブはページ閲覧権限で出し分ける。"
          >
            <Tbl
              head={["画面", "パス", "主な機能", "使用 API"]}
              rows={[
                [
                  "ダッシュボード",
                  <C>/dashboard</C>,
                  <>
                    閲覧専用。<b>スケジュール</b>（連続する2か月のカレンダーと予定一覧。月送りは2つ共通なので常に連続した月になる。予定は Ad Hoc タスクの開始日・期日で、入っている日には印と件数を出す。一覧は日／週／月で範囲を切り替えられ、週・月は日付ごとにまとめて表示する）／<b>全体</b>（Regular Task・Pending のサマリー表と Ad Hoc Task 一覧）／
                    <b>案件詳細</b>（案件タイプ別のステータス×四半期）の3タブ。選択タブは localStorage に保存。カードはドラッグで並べ替え可（localStorage）。
                  </>,
                  <><C>/api/records</C>・<C>/api/adhoc</C>・<C>/api/adhoc-counts</C>・<C>/api/priority</C>・<C>/api/assign</C>・<C>/api/override</C>・<C>/api/adhoc-tasks</C>・<C>/api/kosu?list=1</C>・<C>/api/auth/me</C></>,
                ],
                [
                  "プロジェクト管理",
                  <C>/project</C>,
                  <>
                    同じ <C>TaskBoard</C> を <C>mode=&quot;edit&quot;</C> で使う管理表。区分（すべて／Regular／Pending／Ad Hoc）と、
                    Ad Hoc 選択時の進捗フィルターで絞り込む。編集ボタンで編集モードに入ると、優先・タスク名・開始／期日・対応者・進捗を直接編集できる。
                    タスク追加（区分を選択）、シート連携設定、削除、工数グルーピング（リンクマーク）もここで行う。
                  </>,
                  "同上 ＋ /api/kintone-sync",
                ],
                [
                  "施設一覧",
                  <C>/</C>,
                  <>
                    Kintone の全レコードを表で表示。HID・Hotel Name の検索（200ms デバウンス）、案件名・ステータス・年・四半期での絞り込み、
                    ヘッダークリックで並べ替え。1 ページの件数は表示領域の高さから自動計算（<C>ResizeObserver</C>）。行クリックで詳細モーダル。
                  </>,
                  <><C>/api/records</C>・<C>/api/kintone-sync</C>・<C>/api/auth/me</C></>,
                ],
                [
                  "工数管理",
                  <C>/kosu</C>,
                  <>
                    週次の作業リソース（メンバー別 100% 積み上げ棒・Ad Hoc 詳細・担当者別内訳表）と、下部に工数明細。
                    既定は今週。今週のデータが無ければ実績のある最新週。
                  </>,
                  <><C>/api/resource</C> ＋ 工数明細ぶん</>,
                ],
                [
                  "工数明細（部品）",
                  <>{"—"}（<C>/kosu</C> 内）</>,
                  <>
                    日次グリッド（作業内容 × 担当 × 日付）。対象月を選ぶと月まるごとの日付列を出す（土日・祝日は色分け）。
                    「対応中／完了」タブで切り替え、完了はその週の金曜まで対応中に残す。作業内容の列幅は文字幅を実測して決める。
                  </>,
                  <><C>/api/kosu</C>・<C>/api/kosu-tasks</C>・<C>/api/kosu-entries</C>・<C>/api/assign</C>・<C>/api/override</C>・<C>/api/adhoc</C>・<C>/api/adhoc-tasks</C></>,
                ],
                [
                  "工数入力",
                  <C>/kosu/input</C>,
                  <>
                    対象日を選び、作業 × メンバーで稼働時間（Ad Hoc は稼働時間＋完了数）を入力して保存。
                    メンバー本人がログイン中なら自分の列だけ、オーナー・管理者は全メンバーの列を編集できる。
                    通常の表示条件から外れていても、その日に記録がある作業は行として、退職したメンバーは列として表に出す（そのまま編集できる）。
                  </>,
                  <><C>/api/kosu-status</C>・<C>/api/kosu-tasks</C>・<C>/api/kosu-entries</C>・<C>/api/assign</C>・<C>/api/override</C>・<C>/api/adhoc</C>・<C>/api/auth/me</C></>,
                ],
                [
                  "HID新規発行依頼",
                  <C>/hid-requests</C>,
                  <>
                    11 列（依頼日／HID／施設名／都道府県／申請日／申請状況／Room削除・Plan無効化／プロモ無効化／非掲載／Agoda完了報告／Memo）を手入力する表。
                    行ごとに編集モードへ入り、変更はフィールド単位で即保存。
                  </>,
                  <><C>/api/hid-requests</C>・<C>/api/auth/me</C></>,
                ],
                [
                  "新規作業依頼",
                  <C>/work-requests</C>,
                  <>
                    登録した作業依頼シートを表示し、「レコード作成／レコードNo／作業完了日」の 3 項目だけサイト側で上書き入力する。
                    先頭列〜施設名（日本語）を横スクロール時に固定。「すべて／完了以外」で絞り込み。
                  </>,
                  <><C>/api/work-requests</C>・<C>/api/work-request-data</C>・<C>/api/work-request-cell</C>・<C>/api/form-config</C>・<C>/api/auth/me</C></>,
                ],
                [
                  "フォーム回答",
                  <C>/forms</C>,
                  <>
                    登録した Google フォームの回答シートをカード一覧で表示（総回答数・今月・最終更新の集計バー付き）。
                    カードをクリックすると回答テーブル。TRUE/FALSE 列はチェックボックス表記。ドラッグで並べ替え。
                  </>,
                  <><C>/api/form-sheets</C>・<C>/api/form-sheet-counts</C>・<C>/api/form-sheet-data</C>・<C>/api/form-config</C>・<C>/api/auth/me</C></>,
                ],
                [
                  "アカウント管理",
                  <C>/kosu/persons</C>,
                  <>
                    担当者の追加・改名・メール編集・ログイン許可・役割変更・個別付与・ページ権限・退職／復帰・削除。
                    トグルは楽観的更新（クリック即反映・失敗したら元に戻す）で、成功すると画面中央に完了メッセージを出す。
                    閲覧権限が無い場合はアクセス拒否画面を表示する。
                  </>,
                  <><C>/api/kosu-status</C>・<C>/api/kosu-persons</C>・<C>/api/page-perms</C>・<C>/api/auth/me</C></>,
                ],
                [
                  "システムヘルス",
                  <C>/system-health</C>,
                  <>
                    KPI カード 5 枚（キャッシュヒット率・DB容量・接続数・コミット成功率・稼働時間）、
                    テーブル別の使用状況／データの取り込み状況の 2 カラム、メンテナンス状況（不要タプル・Seq スキャン・最終 VACUUM）、接続先。
                  </>,
                  <><C>/api/system-health</C></>,
                ],
                ["設計仕様書", <C>/design-spec</C>, "このページ。", "—"],
                ["ログイン", <C>/login</C>, <>Google ログイン。<C>?pw=1</C> でパスワードフォームを表示（緊急用）。</>, <><C>/api/auth/google</C>・<C>/api/auth/login</C></>],
                ["認証コールバック", <C>/auth/callback</C>, "トークンを受け取ってセッションを発行し、ダッシュボードへフルリロード遷移。許可されていない場合は専用のお断り画面。", <><C>/api/auth/session</C></>],
              ]}
            />

            <H3>共通の UI ルール</H3>
            <Ul>
              <li>ブラウザ標準の <C>confirm/alert</C> は使わず、共通モーダル（<C>app/Modal.js</C>）に統一する。</li>
              <li>保存中は画面中央のスピナー、完了は中央のチェック（1.2 秒で自動的に消える）、エラーは上部トースト。</li>
              <li>メニュークリック時は全画面ローディングを出し、URL が変わった時点で解除。以降はページ内スピナーに引き継ぐ。</li>
              <li>日付入力はブラウザ既定の表示書式が環境依存（曜日の括弧が付くなど）のため、表示は自前で描き、カレンダーだけ <C>showPicker()</C> で開く。</li>
              <li>サイドバーは 52px のレールで、ホバー（またはキーボードフォーカス）で 216px に展開し、本文に重ねる。</li>
            </Ul>
          </Sec>

          {/* ───────────── 8. ロジック ───────────── */}
          <Sec
            id="logic"
            title="8. 主要ロジック"
            lead="画面の数値がどう作られているか。ここを変えると表示が変わるので、修正時は必ず確認すること。"
          >
            <H3>8-1. 案件の分類（Kintone）</H3>
            <Tbl
              head={["項目", "フィールドコード", "扱い"]}
              rows={[
                ["案件名（案件タイプ）", <C>ドロップダウン_13</C>, <>空欄は <b>Hotel</b> として扱う。表示順は Hotel / ACQ / Liberty / Temairazu / IHM。</>],
                ["Stage（ステータス）", <C>ドロップダウン</C>, "完了・販売開始→「完了」、失注→「失注」、対応不要→「対応不要」、それ以外→「進行中」。"],
                ["作業区分（IHM 用）", <C>ドロップダウン_8</C>, <>Room / Plan / CM。<C>IHM_Room</C> / <C>IHM_Plan</C> / <C>IHM_CM</C> の集計に使う。</>],
                ["対応者", <C>ドロップダウン_3</C>, "対応者が未設定のときの人数表示に使う。"],
                ["DSA", <C>ドロップダウン_11</C>, "Hotel 依頼のサブ作業。値が「完了」なら完了扱い。"],
                ["Stage 変更日", <C>日付</C>, "Pending（前年繰越）の判定に使う。"],
              ]}
            />
            <P>
              Stage の選択肢は区切り行（<C>--</C> で始まる項目）で 2 グループに分かれる。
              <b>グループA</b>＝Hotel・Temairazu、<b>グループB</b>＝ACQ・Liberty・IHM。
              サマリーの内訳列（YCS作成／CM情報待ち／CM接続申請／CM設定CN／CM設定施設／agoda確認／販売待ち）は、
              グループごとに有効な列だけを数え、対象外の列は「—」で表示する。
            </P>

            <H3>8-2. サマリーの計算</H3>
            <Tbl
              head={["指標", "計算式"]}
              rows={[
                ["受注数", "総件数 − 事前登録 − 失注 − 対応不要"],
                ["完了数", <>Stage が完了（グループA は <C>7.販売開始確認（完了）</C>、グループB は <C>完了</C>）の件数</>],
                ["対応中", "受注数 − 完了数"],
                ["完了率", "完了数 ÷ 受注数（受注数 0 のときは 0%）"],
                ["DSA", <>受注数は Hotel の受注数と同じ。完了は <C>ドロップダウン_11 = 完了</C> の件数。</>],
                ["対応人数", "対応者が選択されていればその人数、未設定なら Kintone の実績から集めた人数。"],
              ]}
            />
            <P>
              <b>Pending（前年繰越）</b>：作成日時が「対象年 −1 年」のレコードのうち、
              ①完了しているが Stage 変更日が翌年以降のもの（＝繰り越して完了）、または
              ②事前登録・失注・対応不要のいずれでもなく、まだ完了していないもの、を数える。
              DSA は完了日が Kintone に無いため Pending では集計しない。
            </P>

            <H3>8-3. Ad Hoc の数値の優先順位</H3>
            <P>受注数・完了数は次の順で採用する。上にあるものが優先。</P>
            <Ul>
              <li><b>シート連携</b>（<C>sheetUrl</C> ＋ <C>orderCell</C> / <C>doneCell</C> から読んだ実値）</li>
              <li><b>Kintone 集計</b>（IHM_Room / IHM_Plan / IHM_CM のみ。受注数＝該当件数 − 事前登録 − 失注 − 対応不要、完了数＝Stage が「完了」）</li>
              <li><b>画面での上書き</b>（<C>task_override</C> の <C>total</C> / <C>done</C>）</li>
              <li><b>シート由来の元データ</b></li>
            </Ul>
            <P>
              自動取得（連携・Kintone集計）が効いているときは、残件数と進捗率も自動計算した値に置き換える。
            </P>

            <H3>8-4. 並び順</H3>
            <P>
              <b>実効優先度</b>＝画面で設定した優先順、無ければシートの <C>#</C>（<C>no</C>）。0 と空欄は「優先なし」として扱う。
            </P>
            <P>プロジェクト管理の管理表は、区分ごと（Regular → 追加した Regular → Pending → Ad Hoc）にブロック分けし、各ブロック内を次の順で並べる。</P>
            <Ul>
              <li>優先が入っているものが先（番号の小さい順）。</li>
              <li>
                優先が未設定のものは、そのうち <b>Complete のものを先頭</b>にまとめ、<b>開始日の新しい順</b>で並べる（開始日が無いものは最後）。
              </li>
              <li>それ以外の優先未設定は元の順のまま。</li>
            </Ul>
            <P>
              ダッシュボードの Ad Hoc Task 一覧は、「対応中」タブが優先順（同じ優先度内は手動並び <C>seq</C>）、
              「完了」タブは開始日の新しい順。ドラッグでの並べ替えは <C>seq</C> として保存する。
            </P>

            <H3>8-5. プロジェクト管理と工数の連動</H3>
            <Tbl
              head={["機能", "保存先", "効き方"]}
              rows={[
                [
                  "改名",
                  <><C>task_override(adhoc).name</C></>,
                  <><C>/api/kosu-tasks</C> が <C>kosu_task.content</C> を表示名に差し替えて返す（元名は <C>original_content</C> に残す）。工数入力・工数明細でもダッシュボードと同じ名前になる。</>,
                ],
                [
                  "区分（Regular / Ad Hoc）",
                  <><C>task_override(adhoc).board</C> ＋ <C>kosu_task.task_type</C></>,
                  <>追加時に <C>board=regular</C> を渡すと <C>kosu_task.task_type=&quot;Regular task&quot;</C> で作られ、工数入力に常時表示される。</>,
                ],
                [
                  "グルーピング",
                  <><C>task_override(adhoc).kosuLink</C></>,
                  "ダッシュボードで Tier 1〜4 などに分かれている作業を、工数側では 1 行にまとめる。",
                ],
                [
                  "対応者",
                  <><C>task_assign(scope=adhoc)</C></>,
                  "工数明細で、シートに行が無い担当者の行を補う。",
                ],
                [
                  "進捗",
                  <><C>task_override(adhoc).status</C></>,
                  "工数入力の表示対象と、工数明細の「完了」タブ判定に効く。",
                ],
              ]}
            />
            <P>
              <b>グルーピングは 3 か所で効く。</b>
            </P>
            <Ul>
              <li>
                <C>/api/kosu-tasks</C>：まとめ元の <C>kosu_task</C> を一覧から除外する。ただし、まとめ先・まとめ元の両方が実在するものだけが対象で、
                <b>すでに工数実績（<C>kosu_entry</C>）があるものは除外しない</b>（履歴が見えなくなるため）。
              </li>
              <li>
                工数明細：シート由来の行にもまとめ元が残っているため、<C>groupedAway</C> でシート行からも除外する（これが無いと二重に並ぶ）。
              </li>
              <li>
                工数入力：<C>targetsOf(key)</C> が、まとめ先が指定されていればそこだけ、無ければ元の名前と改名後の両方に対応者・進捗を効かせる。
              </li>
            </Ul>

            <H3>8-6. 工数明細の行の作り方</H3>
            <P><C>/api/kosu</C> が作る土台に、<C>DetailTable</C> が 4 段階で行を足していく。</P>
            <Ul>
              <li>
                <b>土台（サーバー）</b>：作業ごとに「入力実績のある担当者 ＋ アサインされた担当者」の行を作る。
                日付軸は入力開始月〜当月（入力が先の月まであればそこまで）の全日。
              </li>
              <li>
                <b>① シートに無い作業</b>：サイトで追加・取り込みした作業について、割当担当者・実績のある担当者・進捗シートの対応者ぶんの行を作る。
              </li>
              <li>
                <b>② シートにある Ad Hoc</b>：ダッシュボードで割り当てた対応者のうち、シートに行が無い人を足す（まとめ先の行には、まとめ元の対応者も含める）。
              </li>
              <li>
                <b>③ Regular とトータル作業時間</b>：全メンバー共通の作業なので、シートに行が無い在籍メンバー（後から追加した人）の行を足す。
                これが無いと、新しく追加したメンバーは工数明細に出ず、入力した値も表示されない。
              </li>
            </Ul>
            <P>
              セルの値は、シートの値をベースに <C>kosu_entry</C>（工数入力）があればそれで上書きする。
              「<b>トータル作業時間</b>」は入力値ではなく自動集計で、<b>Regular の時間（<C>unit=time</C>）＋ Ad Hoc の稼働時間</b>の合計。
              件数系（<C>unit=count</C>）は時間ではないので含めない。
            </P>
            <P>
              <b>完了の判定</b>：①作業内容管理で <C>completed</C> にした、②紐づくダッシュボードの Ad Hoc タスクが全て Complete、
              ③名前を正規化（NFKC・空白除去・小文字化）した集合に一致、のいずれか。
              進捗シートと作業工数管理シートで全角／半角カッコや空白が食い違っても照合できるようにするため。
              完了しても、<b>その週の金曜日までは「対応中」タブに残す</b>。
            </P>

            <H3>8-7. 工数入力の表示条件</H3>
            <Ul>
              <li>「トータル作業時間」は集計行なので入力画面には出さない。</li>
              <li>Regular task は常時表示（進捗・担当での絞り込みをしない）。</li>
              <li>
                Ad Hoc task は進捗が <b>On Track / Behind のものだけ</b>表示する（Onhold・Complete は出さない）。
                グルーピング済みの場合は、まとめ元のいずれかが該当すれば表示する。進捗が未設定のものは判断できないので表示する。
              </li>
              <li>開始日より前の日付では表示しない。完了済みは、期日（無ければ完了日）より後の日付では表示しない。</li>
              <li>
                上の条件から外れていても、<b>その日に記録がある</b>作業は行として出す（「記録あり」バッジ付き）。
                完了した作業や無効化した作業の記録を、あとから直せなくならないようにするため。トータル作業時間は自動集計なので対象外。
              </li>
              <li>
                退職したメンバーも、その日に記録があるときだけ列を出す（「退職」バッジ付き）。記録が無い日は列を増やさない。
                本人ログイン時（selfOnly）は自分の列だけなので、退職者の列は出ない。
              </li>
              <li>
                担当者列は<b>メンバーのみ</b>（オーナー・管理者は作業者ではないので工数の対象外）。
                メンバー本人がログイン中なら自分の列だけを出し、サーバー側でも他人ぶんの保存を拒否する。
              </li>
            </Ul>

            <H3>8-8. 週次リソース（/api/resource）</H3>
            <Ul>
              <li>週は月曜始まり。実績のある最小〜最大の月曜日まで連続で並べる。</li>
              <li>
                <b>Regular は <C>unit=time</C> の行だけ</b>を工数（時間）として合算する。
                メール・荷電・Kintone 登録などの件数（<C>unit=count</C>）は時間ではないので合算しない。
              </li>
              <li>Ad Hoc は <C>value</C> がそのまま稼働時間（件数は <C>done_count</C> 側なので混ざらない）。</li>
              <li>「トータル作業時間」など、その他の種別は日次の合計値なので二重計上を避けて集計しない。</li>
              <li>オーナー・管理者はリソース集計に含めない。全週ゼロの Ad Hoc 作業は詳細グラフに出さない。</li>
              <li>実績が 1 件も無いときだけ、作業リソースシートを読む（移行前の互換経路）。</li>
            </Ul>

            <H3>8-9. 祝日（lib/holidays.js）</H3>
            <P>
              外部 API・外部シートに依存せずコードで算出する。2020 年以降の現行法（天皇誕生日 2/23・スポーツの日・山の日）に準拠。
              春分・秋分は 1980〜2099 年で有効な近似式を使用。<b>国民の休日</b>（祝日に挟まれた平日）と
              <b>振替休日</b>（日曜が祝日なら次の祝日でない日）も算出する。年ごとの結果はメモリにキャッシュする。
            </P>

            <H3>8-10. その他の細かい仕様</H3>
            <Ul>
              <li>日付は表示・保存とも <C>YYYY/MM/DD</C>。<C>&lt;input type=&quot;date&quot;&gt;</C> 用に <C>YYYY-MM-DD</C> と相互変換する。</li>
              <li>数値は 3 桁区切り。数値に見えないもの（<C>98%</C>・<C>1h 100件</C> など）はそのまま表示する。</li>
              <li>上書きの保存は 600ms のデバウンスでまとめてから送る。</li>
              <li>退職した担当者も割当を残し、対応者欄に「退職」と分かる形で表示する。対応者の選択肢に出すのは、既に割り当てられている場合か、そのタスクが Complete のときだけ。</li>
              <li>フィルターやタブの選択枠は、選択中ボタンの実寸を測って CSS 変数（<C>--thumb-x</C> / <C>--thumb-w</C>）に渡し、<C>transform</C> で滑らかに移動させる。</li>
            </Ul>
          </Sec>

          {/* ───────────── 9. セキュリティ ───────────── */}
          <Sec
            id="security"
            title="9. セキュリティ"
            lead="社内向けだが、キーの流出・権限の迂回・第三者への情報露出を前提に多層で守る。"
          >
            <Tbl
              head={["観点", "対策"]}
              rows={[
                [
                  "機密キー",
                  <><C>SUPABASE_SERVICE_ROLE_KEY</C>・Kintone トークン・Google 秘密鍵はすべてサーバー側（環境変数）のみ。<C>NEXT_PUBLIC_</C> 接頭辞は使わず、ブラウザには一切渡さない。</>,
                ],
                [
                  "RLS",
                  <>全テーブルで有効化し、<b>ポリシーを作らない</b>。<C>anon</C> / <C>authenticated</C> からは何も読めない。<C>service_role</C> は RLS をバイパスするのでアプリの動作には影響しない。直接権限も <C>revoke</C> 済み。</>,
                ],
                [
                  "セッション",
                  <>Cookie は <C>HttpOnly</C> ＋ 本番 <C>Secure</C> ＋ <C>SameSite=Lax</C>。中身は不透明IDのみ。ログイン許可を外した瞬間に無効化される。</>,
                ],
                [
                  "認可の二重化",
                  <>画面の出し分けだけに頼らず、書き込み系 API は <C>denyUnlessPerm</C> / <C>denyUnlessPageEdit</C> でサーバー側でも確認する。役割・権限フラグの変更はオーナーのみ（管理者による自己昇格を防ぐ）。</>,
                ],
                [
                  "工数の書き込み",
                  <>オーナー・管理者以外は自分の <C>person_id</C> 以外を含む保存を拒否する（画面の絞り込みだけに頼らない）。</>,
                ],
                [
                  "SQL への文字列埋め込み",
                  <><b>テーブル名・列名をクエリに埋めるのは固定の許可リストのみ</b>（システムヘルスの <C>INGEST</C> / <C>GROWTH</C>）。ユーザー入力は絶対に通さない。</>,
                ],
                [
                  "接続情報の表示",
                  <><b>接続先にパスワードを出さない。</b>システムヘルスでは URL のホスト名だけを表示し、取得に失敗したときは「(不明)」を返す。</>,
                ],
                [
                  "パスワード",
                  <>パスワードログインは既定で無効（<C>PASSWORD_LOGIN=1</C> のときのみ）。管理者によるパスワード設定はサーバー経由で Supabase に渡すだけで、<b>保存・記録は一切しない</b>。</>,
                ],
                [
                  "トークンの URL 残留",
                  <><C>/auth/callback</C> は <C>access_token</C> を読み取り次第アドレスバーから消す（URL をコピーして他ブラウザで開かれるのを防ぐ）。</>,
                ],
                [
                  "エラーの出し方",
                  "未ログインでも叩けるログイン経路では、内部エラーの内容をレスポンスに含めずサーバーログにのみ残す。",
                ],
                [
                  "HTTP ヘッダー",
                  <>全レスポンスに CSP・<C>X-Frame-Options: DENY</C>・<C>X-Content-Type-Options: nosniff</C>・<C>Referrer-Policy</C>・<C>Permissions-Policy</C>・HSTS を付与（<C>next.config.mjs</C>）。</>,
                ],
                [
                  "CSP",
                  <>読み込む外部リソースは Google アバター画像（<C>https://*.googleusercontent.com</C>）のみ。<C>object-src 'none'</C>・<C>frame-ancestors 'none'</C>・<C>form-action 'self'</C>。Next.js のハイドレーションのため <C>'unsafe-inline'</C> は許可、<C>'unsafe-eval'</C> と <C>ws:</C> は開発時のみ。</>,
                ],
                [
                  "本番の強制保護",
                  <><C>AUTH_REQUIRED=1</C> を設定し、許可リスト照会が一時的に失敗しても「全公開」に落ちないようにする。</>,
                ],
              ]}
            />
          </Sec>

          {/* ───────────── 10. 運用 ───────────── */}
          <Sec id="ops" title="10. 運用・環境変数" lead="デプロイは Vercel（リージョン sin1）。環境変数は Vercel のプロジェクト設定と、ローカルの .env.local に置く。">
            <H3>環境変数</H3>
            <Tbl
              head={["変数", "必須", "内容"]}
              rows={[
                [<C>SUPABASE_URL</C>, "必須", "Supabase プロジェクトの URL。"],
                [<C>SUPABASE_SERVICE_ROLE_KEY</C>, "必須", "サーバー側からのみ使用。絶対に公開しない。"],
                [<C>SUPABASE_ANON_KEY</C>, "任意", "トークン検証などで使用（未設定なら service_role で代用）。"],
                [<C>AUTH_REQUIRED</C>, "本番で必須", <>1 にすると常に保護 ON。</>],
                [<C>PASSWORD_LOGIN</C>, "任意", "1 でパスワードログインを有効化（Google が使えない緊急時のみ）。"],
                [<C>KINTONE_SUBDOMAIN</C>, "必須", <>{"https://◯◯◯.cybozu.com"} の ◯◯◯ 部分。</>],
                [<C>KINTONE_APP_ID</C>, "必須", "対象アプリの ID。"],
                [<C>KINTONE_API_TOKEN</C>, "必須", "レコード閲覧のみで可。"],
                [<C>KINTONE_DOMAIN</C>, "任意", <>既定 <C>cybozu.com</C>。</>],
                [<C>GOOGLE_SA_EMAIL</C>, "任意", "サービスアカウントのメール。対象シートにこのアドレスを閲覧共有すると非公開シートを読める。"],
                [<C>GOOGLE_SA_PRIVATE_KEY</C>, "任意", <>秘密鍵。改行は <C>\n</C> でも可（前後のクオートは自動で外す）。</>],
                [
                  <>
                    <C>KOSU_SHEET_ID</C> / <C>KOSU_GID</C> / <C>ADHOC_GID</C> / <C>RESOURCE_GID</C>
                  </>,
                  "任意",
                  "移行元シートの指定。既定値がコードに入っているため通常は設定不要。",
                ],
                [<C>SUPABASE_DB_LIMIT_MB</C>, "任意", <>DB 容量の上限（MB）。既定 500（無料プラン）。</>],
                [<C>SUPABASE_PLAN_NAME</C>, "任意", <>表示用のプラン名。既定「無料プラン」。</>],
              ]}
            />
            <Note>
              <b>容量の上限値はプラン変更時に必ず直すこと。</b>直し忘れると「上限間近」と誤表示する。
              無料 = 500MB / Pro = 8192MB。環境変数 <C>SUPABASE_DB_LIMIT_MB</C> でも上書きできる。
            </Note>

            <H3>初期セットアップ（Supabase SQL Editor で実行）</H3>
            <Tbl
              head={["ファイル", "内容", "実行タイミング"]}
              rows={[
                [<C>supabase/schema.sql</C>, "全テーブル・インデックス・ログイン許可リストのトリガー。", "最初に 1 回（何度実行しても安全）。"],
                [<C>supabase/rls.sql</C>, "全テーブルの RLS 有効化と、公開ロールからの権限剥奪。", "schema の後に 1 回（冪等）。"],
                [<C>db/sys_health.sql</C>, "システムヘルス用の RPC 2 つと実行権限の設定。", "システムヘルスを使うとき。"],
              ]}
            />
            <P>
              Supabase ダッシュボード側では、Authentication → Providers で Google を有効化し、
              リダイレクト URL に <C>&lt;サイトURL&gt;/auth/callback</C> を登録する。
              「Allow new users to sign up」は、許可リストのトリガーがあるため ON のままで安全。
            </P>

            <H3>日々の運用</H3>
            <Ul>
              <li><b>Kintone 取込</b>：施設一覧またはプロジェクト管理の取込ボタン（タスク編集権限が必要）。数秒〜十数秒かかる。</li>
              <li><b>アカウント追加</b>：アカウント管理で氏名とメールを登録 →「ログイン」を許可 → 必要ならページ権限を設定。ログインは Google で行う。</li>
              <li><b>退職</b>：削除ではなく「退職」を使う。実績は残り、担当割当とログインセッションだけが外れる。工数実績があるアカウントは削除できない。</li>
              <li><b>容量の監視</b>：システムヘルスの「DB容量」カードで使用率と上限到達目安を確認する。</li>
            </Ul>

            <H3>既知の制約</H3>
            <Ul>
              <li>Kintone の全件取得は 500 件 × 最大 40 ページ（20,000 件）まで。</li>
              <li>シートの表示は 1,000 行まで（超過分は <C>truncated</C> で表示）。</li>
              <li>「完了希望日 / Google Form 受領日 / 作業依頼 受領日」は対応する Kintone フィールドが特定できていないため未設定。</li>
              <li>作業リソースシートのフォールバック経路は担当者名が固定（田中 / 長内 / 原）。実績が入っていれば通らない経路。</li>
            </Ul>
          </Sec>

          <p className="spec-foot">
            Agoda Management System ／ 設計仕様書 — 実装から作成（2026/09/07 時点）
          </p>
        </div>
      </div>
    </div>
  );
}
