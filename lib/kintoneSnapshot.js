// Kintone データの「スナップショット（Supabase保存）」を扱うヘルパー。
//   通常のページ表示は Supabase に保存済みのデータを読む（Kintone は叩かない）。
//   更新は画面の「Kintone取込」ボタン（/api/kintone-sync）から手動で行う。
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

// Supabase に保存済みのスナップショットを読む。無ければ null。
export async function readSnapshot() {
  if (!supabaseConfigured()) return null;
  const rows = await sb(
    "kintone_snapshot?id=eq.1&select=data,fetched_at"
  ).catch(() => null);
  const snap = Array.isArray(rows) ? rows[0] : null;
  if (!snap || !snap.data) return null;
  return { data: snap.data, fetchedAt: snap.fetched_at };
}

// スナップショットを1行だけ upsert する。
export async function writeSnapshot(payload) {
  if (!supabaseConfigured()) return false;
  await sb("kintone_snapshot?on_conflict=id", {
    method: "POST",
    body: { id: 1, data: payload, fetched_at: new Date().toISOString() },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  return true;
}
