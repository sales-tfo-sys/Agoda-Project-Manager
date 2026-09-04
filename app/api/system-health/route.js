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

// DB容量の上限（プラン依存）。現在は無料プラン＝500MB。
// 有料プランへ移行したら環境変数 SUPABASE_DB_LIMIT_MB / SUPABASE_PLAN_NAME で変更する
// （例：Pro なら 8192 と「Proプラン」）。
const DB_LIMIT_MB = Number(process.env.SUPABASE_DB_LIMIT_MB || 500);
const DB_PLAN_NAME = process.env.SUPABASE_PLAN_NAME || "無料プラン";

// DB容量の推移を1日1件だけ記録し、増加ペース／上限到達目安を出せるようにする。
// （task_override を流用。scope=dbsize / key=YYYY-MM-DD）
async function trackDbSize(bytes) {
  if (bytes == null) return null;
  const today = new Date().toISOString().slice(0, 10);
  try {
    await sb("task_override?on_conflict=scope,key", {
      method: "POST",
      body: [{ scope: "dbsize", key: today, data: { bytes }, updated_at: new Date().toISOString() }],
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  } catch {}
  try {
    const rows = await sb("task_override?scope=eq.dbsize&select=key,data&order=key.asc");
    const pts = (rows || [])
      .map((r) => ({ day: r.key, bytes: Number(r.data?.bytes) }))
      .filter((p) => Number.isFinite(p.bytes));
    if (pts.length < 2) return { days: pts.length, perDayBytes: null };
    const first = pts[0];
    const last = pts[pts.length - 1];
    const spanDays = Math.max(
      1,
      Math.round((new Date(last.day) - new Date(first.day)) / 86400000)
    );
    return { days: pts.length, perDayBytes: (last.bytes - first.bytes) / spanDays };
  } catch {
    return null;
  }
}

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

  // DB容量の上限・増加ペース（プラン上限に対する使用率を出すため）
  let capacity = null;
  if (db?.db_size_bytes != null) {
    const growth = await trackDbSize(db.db_size_bytes);
    const limitBytes = DB_LIMIT_MB * 1024 * 1024;
    const perDay = growth?.perDayBytes ?? null;
    const remain = limitBytes - db.db_size_bytes;
    capacity = {
      limitBytes,
      planName: DB_PLAN_NAME,
      usedPct: limitBytes > 0 ? (100 * db.db_size_bytes) / limitBytes : null,
      perDayBytes: perDay,
      // 上限到達までの日数（増加が無い/減っている場合は null）
      daysToLimit: perDay && perDay > 0 ? remain / perDay : null,
      samples: growth?.days ?? 0,
    };
  }

  return Response.json({ ok: true, configured: true, checkedAt, reachable, latencyMs, tables, kintone, db, capacity });
}
