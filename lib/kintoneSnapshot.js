// Kintone データの「スナップショット（Supabase保存）」を扱うヘルパー。
//   通常のページ表示は Supabase に保存済みのデータを読む（Kintone は叩かない）。
//   更新は画面の「Kintone取込」ボタン（/api/kintone-sync）から手動で行う。
import { gzipSync, gunzipSync } from "node:zlib";
import { fetchAllRecords, fetchFields } from "./kintone";
import { sb, supabaseConfigured } from "./supabase";

// Kintone から全件＋フィールド定義を取得して、保存/表示用のペイロードにまとめる。
export async function buildKintonePayload() {
  const [records, fields] = await Promise.all([
    fetchAllRecords(),
    fetchFields().catch(() => null),
  ]);
  return {
    configured: true,
    source: "kintone",
    count: records.length,
    fields,
    records,
  };
}

// 保存の形式。
//   v1 … { v: 1, gz: "<gzip した JSON の base64>" }
//   旧 … ペイロードをそのまま入れたもの（読み込みは今も対応する）
// 生の JSON は 9MB ほどあり、そのまま jsonb に入れると Supabase 側の
// statement_timeout（57014 canceling statement due to statement timeout）に
// 当たって書き込めないことがある。gzip すると 1/10 以下になり、
// 書き込みが短時間で終わるようにする。
function packSnapshot(payload) {
  return { v: 1, gz: gzipSync(Buffer.from(JSON.stringify(payload), "utf8")).toString("base64") };
}
function unpackSnapshot(data) {
  if (data && typeof data === "object" && typeof data.gz === "string") {
    return JSON.parse(gunzipSync(Buffer.from(data.gz, "base64")).toString("utf8"));
  }
  return data; // 旧形式（そのまま入っている）
}

// Supabase に保存済みのスナップショットを読む。無ければ null。
export async function readSnapshot() {
  if (!supabaseConfigured()) return null;
  const rows = await sb(
    "kintone_snapshot?id=eq.1&select=data,fetched_at"
  ).catch(() => null);
  const snap = Array.isArray(rows) ? rows[0] : null;
  if (!snap || !snap.data) return null;
  return { data: unpackSnapshot(snap.data), fetchedAt: snap.fetched_at };
}

// スナップショットを1行だけ upsert する。
export async function writeSnapshot(payload) {
  if (!supabaseConfigured()) return false;
  try {
    await sb("kintone_snapshot?on_conflict=id", {
      method: "POST",
      body: { id: 1, data: packSnapshot(payload), fetched_at: new Date().toISOString() },
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes("57014")) {
      throw new Error(
        "Supabase への保存が時間切れになりました（データ量が多すぎます）。少し待ってからもう一度お試しください。"
      );
    }
    throw e;
  }
  return true;
}
