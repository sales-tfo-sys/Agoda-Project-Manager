// AI健康診断（月1回の点検）の中身。画面（/api/ai-health）と月初の自動実行（/api/cron/ai-health）で使う。
//
// 点検は Supabase 公式の Advisors を使う（Management API）。
//   GET https://api.supabase.com/v1/projects/{ref}/advisors/security
//   GET https://api.supabase.com/v1/projects/{ref}/advisors/performance
//   ヘッダ Authorization: Bearer SUPABASE_ACCESS_TOKEN（Advisors の読み取り権限だけのトークン）
// このAPIは experimental 扱いなので、返り方が変わったら「指摘0件」と誤って残さず、エラーにする。
//
// SUPABASE_ACCESS_TOKEN が無いときだけ、予備として自作SQL（rpc/sys_advisor）で点検する。
//
// ★ トークンはサーバー側だけで使い、ログやエラー文に出さない。
import { sb } from "./supabase";

export const SCOPE = "aihealth";

export const monthKey = (d = new Date()) => {
  // 月の区切りは日本時間で数える（月初の自動実行が 9:00 JST に走るため）
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, "0")}`;
};

// Supabase のプロジェクト参照（https://<ref>.supabase.co から取る）
export function projectRef() {
  const m = String(process.env.SUPABASE_URL || "").match(/^https?:\/\/([a-z0-9-]+)\.supabase\./i);
  return m ? m[1] : null;
}

// Advisors の level → 画面の重さ
const LEVEL = { ERROR: "high", WARN: "med", INFO: "low" };

// よく出る指摘の日本語。対訳がずれても取り違えないよう、画面では必ず API の name も併記する。
const JA = {
  // セキュリティ
  rls_disabled_in_public: "RLS が無効な public の表",
  rls_enabled_no_policy: "RLS は有効だがポリシーが無い",
  policy_exists_rls_disabled: "ポリシーはあるが RLS が無効",
  security_definer_view: "作成者の権限で動くビュー",
  function_search_path_mutable: "search_path を固定していない関数",
  extension_in_public: "public スキーマに入った拡張",
  extension_versions_outdated: "古い版のままの拡張",
  auth_users_exposed: "auth.users が API から見える",
  rls_references_user_metadata: "RLS が user_metadata を参照している",
  materialized_view_in_api: "マテリアライズドビューが API から見える",
  foreign_table_in_api: "外部テーブルが API から見える",
  unsupported_reg_types: "API で扱えない型の列",
  insecure_queue_exposed_in_api: "キューが API から見える",
  fkey_to_auth_unique: "auth のユニーク制約への外部キー",
  sensitive_columns_exposed: "機密らしい列が API から見える",
  vulnerable_postgres_version: "Postgres に適用できるセキュリティ更新がある",
  auth_leaked_password_protection: "流出パスワードの保護が無効",
  auth_insufficient_mfa_options: "多要素認証の選択肢が少ない",
  auth_otp_long_expiry: "ワンタイムコードの有効期限が長い",
  auth_otp_short_length: "ワンタイムコードが短い",
  // パフォーマンス
  unindexed_foreign_keys: "外部キーに索引が無い",
  auth_rls_initplan: "RLS で auth 関数を行ごとに評価している",
  no_primary_key: "主キーが無い表",
  unused_index: "使われていない索引",
  multiple_permissive_policies: "許可ポリシーが重なっている",
  duplicate_index: "同じ内容の索引が重複",
  table_bloat: "表が肥大化している",
  auth_db_connections_absolute: "Auth の接続数が固定値",
};

// Advisors の1件 → 画面・記録の形
export function mapLint(l, kind) {
  const name = String(l?.name || "");
  const md = l?.metadata || {};
  const target = md.entity || [md.schema, md.name].filter(Boolean).join(".") || "";
  return {
    kind,
    level: LEVEL[String(l?.level || "").toUpperCase()] || "low",
    code: name,
    apiName: name,
    title: JA[name] || String(l?.title || name),
    apiTitle: String(l?.title || ""),
    target,
    detail: String(l?.detail || l?.description || ""),
    remediation: l?.remediation ? String(l.remediation) : "",
    categories: Array.isArray(l?.categories) ? l.categories : [],
    facing: l?.facing ? String(l.facing) : "",
  };
}

// 失敗の意味（トークンは出さない）
function explain(status) {
  if (status === 401) return "トークンが無効か、期限切れです（401）";
  if (status === 403) return "トークンの権限が足りません（403）";
  if (status === 404) return "プロジェクトIDが違います（404）";
  if (status === 429) return "呼び出しが多すぎます。少し待ってから試してください（429）";
  return `Supabase の点検APIがエラーを返しました（${status}）`;
}

async function fetchAdvisors(kind, ref, token) {
  let res;
  try {
    res = await fetch(`https://api.supabase.com/v1/projects/${ref}/advisors/${kind}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    throw new Error("Supabase の点検APIにつながりませんでした");
  }
  if (!res.ok) throw new Error(explain(res.status));
  let j;
  try {
    j = await res.json();
  } catch {
    throw new Error("Supabase の点検APIの応答を読めませんでした");
  }
  // experimental のため、形が違ったら「0件」とせずエラーにする
  if (!j || !Array.isArray(j.lints)) {
    throw new Error("Supabase の点検APIの応答の形が想定と違います（lints が配列ではありません）");
  }
  return j.lints.map((l) => mapLint(l, kind));
}

// 予備：自作SQL（db/sys_advisor.sql）で点検する
async function fromSql() {
  let res;
  try {
    res = await sb("rpc/sys_advisor", { method: "POST", body: {} });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/PGRST202|does not exist|Not Found|404/i.test(msg)) {
      throw new Error(
        "点検用の関数がまだありません。db/sys_advisor.sql を Supabase の SQL Editor に貼って1回実行してください。"
      );
    }
    throw new Error("自作SQLでの点検に失敗しました");
  }
  const out = Array.isArray(res) ? res[0] : res;
  if (!out || !Array.isArray(out.findings)) throw new Error("自作SQLの点検結果を読めませんでした");
  return out.findings.map((f) => ({ ...f, apiName: f.code || "", source: "sql" }));
}

/**
 * 点検する。security と performance の両方が取れたときだけ結果を返す（片方だけは返さない）。
 * 返り値: { source: "advisors" | "sql", findings: [...] }
 */
export async function runCheck() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) return { source: "sql", findings: await fromSql() };
  const ref = projectRef();
  if (!ref) throw new Error("SUPABASE_URL からプロジェクトIDを読めませんでした");
  const [sec, perf] = await Promise.all([
    fetchAdvisors("security", ref, token),
    fetchAdvisors("performance", ref, token),
  ]);
  return { source: "advisors", findings: [...sec, ...perf] };
}

// 今月の記録
export async function readMonth(month = monthKey()) {
  const rows = await sb(`task_override?scope=eq.${SCOPE}&key=eq.${encodeURIComponent(month)}&select=data`).catch(
    () => []
  );
  return rows?.[0]?.data || null;
}

/** 点検して記録する（両方取れたときだけ保存） */
export async function runAndSave(who) {
  const { source, findings } = await runCheck();
  const month = monthKey();
  const at = new Date().toISOString();
  const data = { ...((await readMonth(month)) || {}) };
  for (const kind of ["security", "performance"]) {
    data[kind] = {
      ...(data[kind] || {}),
      at,
      by: who,
      auto: true,
      source,
      findings: findings.filter((f) => f?.kind === kind),
    };
  }
  await sb("task_override?on_conflict=scope,key", {
    method: "POST",
    body: [{ scope: SCOPE, key: month, data, updated_at: at }],
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  return { month, data, total: findings.length, source };
}
