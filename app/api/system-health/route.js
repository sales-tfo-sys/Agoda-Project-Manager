import { supabaseConfigured, sb } from "../../../lib/supabase";
import { readSnapshot } from "../../../lib/kintoneSnapshot";
import { denyUnlessPerm } from "../../../lib/auth";

export const dynamic = "force-dynamic";

// このアプリが Supabase に持っている実テーブル
const TABLES = [
  "kosu_task",
  "kosu_entry",
  "kosu_person",
  "task_assign",
  "task_priority",
  "task_override",
  "adhoc_task",
  "adhoc_item",
  "app_session",
  "kintone_snapshot",
];

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// PostgREST の推定件数（Content-Range ヘッダ）を読む。大きなテーブルでも速い。
async function estCount(table) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?select=*&limit=1`, {
      method: "HEAD",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        Prefer: "count=estimated",
        "Range-Unit": "items",
        Range: "0-0",
      },
      cache: "no-store",
    });
    const cr = res.headers.get("content-range"); // 例: "0-0/12345" or "*/12345"
    if (!cr) return { name: table, rows: null };
    const total = cr.split("/")[1];
    const n = total === "*" ? null : Number(total);
    return { name: table, rows: Number.isFinite(n) ? n : null };
  } catch {
    return { name: table, rows: null };
  }
}

export async function GET(req) {
  const denied = await denyUnlessPerm(req, "viewAccounts");
  if (denied) return denied;

  if (!supabaseConfigured()) {
    return Response.json({ ok: false, configured: false });
  }

  const checkedAt = new Date().toISOString();

  // 1) 接続の死活＋応答速度（軽い1件取得）
  let reachable = false;
  let latencyMs = null;
  {
    const t0 = Date.now();
    try {
      await sb("kosu_person?select=id&limit=1");
      reachable = true;
    } catch {
      reachable = false;
    }
    latencyMs = Date.now() - t0;
  }

  // 2) テーブル別の推定行数（並列）
  const tables = reachable ? await Promise.all(TABLES.map(estCount)) : [];
  tables.sort((a, b) => (b.rows || 0) - (a.rows || 0));

  // 3) Kintone 取込の鮮度
  let kintone = null;
  try {
    const snap = await readSnapshot();
    kintone = { fetchedAt: snap?.fetchedAt || null, count: snap?.data?.count ?? null };
  } catch {
    kintone = null;
  }

  // 4) 深い Postgres 統計（キャッシュヒット率・DB容量・肥大化・VACUUM 等）。
  //    Supabase に SQL 関数 public.sys_health() を入れてある場合だけ取得できる。
  //    未導入なら db=null（画面側は該当セクションを非表示にする）。
  let db = null;
  try {
    const r = await sb("rpc/sys_health", { method: "POST", body: {} });
    db = r && typeof r === "object" ? r : null;
  } catch {
    db = null; // 関数未導入 or 権限なし
  }

  return Response.json({ ok: true, configured: true, checkedAt, reachable, latencyMs, tables, kintone, db });
}
