import { sb, supabaseConfigured } from "../../../lib/supabase";
import { denyUnlessPerm } from "../../../lib/auth";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// ── DB容量の上限（プラン依存）─────────────────────────────────────
// ★★ プランを変更したら必ずこの値も直すこと ★★
//    直し忘れると「上限間近」と誤表示する（無料500MBのまま移行して誤警告した事例あり）。
//    無料 = 500MB / Pro = 8192MB。環境変数でも上書きできる。
const DB_LIMIT_MB = Number(process.env.SUPABASE_DB_LIMIT_MB || 500);
const DB_PLAN_NAME = process.env.SUPABASE_PLAN_NAME || "無料プラン";

// ── 取り込み状況に出す「表示名 / テーブル / 日付列」──────────────────
// ★ テーブル名・列名はクエリに埋め込むため、必ずこの固定の許可リストのみ。
//   ユーザー入力は絶対に通さない。
const INGEST = [
  { label: "Kintone スナップショット", table: "kintone_snapshot", dateCol: "fetched_at" },
  { label: "工数実績", table: "kosu_entry", dateCol: "entry_date" },
  { label: "Ad Hoc タスク", table: "adhoc_task", dateCol: "created_at" },
  { label: "Ad Hoc 明細", table: "adhoc_item", dateCol: "updated_at" },
  { label: "依頼・上書きデータ", table: "task_override", dateCol: "updated_at" },
];

// ── 日々増えるテーブル（増加ペースの推定に使う）──────────────────────
// ★ 同じく固定の許可リストのみ。
const GROWTH = [
  { table: "kosu_entry", dateCol: "entry_date" },
  { table: "app_session", dateCol: "created_at" },
  { table: "kintone_snapshot", dateCol: "fetched_at" },
  { table: "adhoc_task", dateCol: "created_at" },
];

// PostgREST の件数（Content-Range ヘッダ）を読む
async function countWhere(table, filter) {
  const res = await fetch(
    `${SB_URL}/rest/v1/${table}?select=*${filter ? "&" + filter : ""}`,
    {
      method: "HEAD",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        Prefer: "count=exact",
        Range: "0-0",
      },
      cache: "no-store",
    }
  );
  const cr = res.headers.get("content-range"); // 例 "0-0/12345"
  const total = cr ? cr.split("/")[1] : null;
  const n = total && total !== "*" ? Number(total) : null;
  return Number.isFinite(n) ? n : null;
}

async function maxDate(table, col) {
  const rows = await sb(`${table}?select=${col}&order=${col}.desc.nullslast&limit=1`);
  return rows?.[0]?.[col] ?? null;
}

// 接続先ホスト。パスワードは絶対に出さない（URLのホスト名だけを返す）
function connHost() {
  try {
    return new URL(SB_URL).host;
  } catch {
    return "(不明)";
  }
}

export async function GET(req) {
  // 管理者/オーナーのみ
  const denied = await denyUnlessPerm(req, "viewAccounts");
  if (denied) return denied;

  if (!supabaseConfigured()) {
    return Response.json({ ok: false, configured: false });
  }

  const checkedAt = new Date().toISOString();

  // ① 健全性＋容量＋バージョン（取れなければ null＝画面では「—」）
  let health = null;
  try {
    const r = await sb("rpc/sys_health", { method: "POST", body: {} });
    health = r && typeof r === "object" ? r : null;
  } catch {
    health = null;
  }

  // ② テーブル統計（別 try/catch。片方が落ちても他は出す）
  let tables = [];
  try {
    const r = await sb("rpc/sys_tables", { method: "POST", body: {} });
    tables = Array.isArray(r) ? r : [];
  } catch {
    tables = [];
  }

  // ③ 取り込み状況（テーブルごとに個別 try/catch）
  const ingest = await Promise.all(
    INGEST.map(async (it) => {
      try {
        const [latest, count] = await Promise.all([
          maxDate(it.table, it.dateCol).catch(() => null),
          countWhere(it.table).catch(() => null),
        ]);
        return { label: it.label, latest, count };
      } catch {
        return { label: it.label, latest: null, count: null };
      }
    })
  );

  // ④ 増加ペース（MB/日）
  //    各テーブルで「直近30日の行数 / 30」×「1行あたりバイト数」を合算する。
  const bytesByTable = Object.fromEntries(
    (tables || []).map((t) => [t.name, { bytes: Number(t.bytes) || 0, live: Number(t.live) || 0 }])
  );
  let perDayBytes = 0;
  let growthOk = false;
  for (const g of GROWTH) {
    try {
      const info = bytesByTable[g.table];
      if (!info || !info.bytes) continue;
      const latest = await maxDate(g.table, g.dateCol);
      if (!latest) continue;
      const since = new Date(new Date(latest).getTime() - 30 * 86400000).toISOString();
      const recent = await countWhere(g.table, `${g.dateCol}=gte.${encodeURIComponent(since)}`);
      if (recent == null) continue;
      const bytesPerRow = info.bytes / Math.max(info.live, 1);
      perDayBytes += (recent / 30) * bytesPerRow;
      growthOk = true;
    } catch {
      // 1テーブル取れなくても他は続ける
    }
  }

  // ⑤ 容量（上限に対する使用率・到達目安）
  let capacity = null;
  if (health?.db_bytes != null) {
    const limitBytes = DB_LIMIT_MB * 1024 * 1024;
    const used = Number(health.db_bytes) || 0;
    const remain = Math.max(0, limitBytes - used);
    capacity = {
      limitBytes,
      usedBytes: used,
      planName: DB_PLAN_NAME,
      usedPct: limitBytes > 0 ? (100 * used) / limitBytes : null,
      perDayBytes: growthOk && perDayBytes > 0 ? perDayBytes : null,
      daysToLimit: growthOk && perDayBytes > 0 ? remain / perDayBytes : null,
    };
  }

  return Response.json({
    ok: true,
    configured: true,
    checkedAt,
    health,
    tables,
    ingest,
    capacity,
    host: connHost(),
  });
}
