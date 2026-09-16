// 「このレコードを、サイトから最後に直したのは誰か」を覚えておく。
//
// サイトからの書き込みは API トークンで行うため、Kintone 側の更新者は
// トークンの持ち主（Admin）になる。それだけでは誰の操作か分からないので、
// こちらで「版（revision）＋名前」を持っておき、詳細画面では
// 「Admin（青木）」のように出す。
//
// 置き場所は task_override（scope=kinby, key=レコード番号）。
import { sb, supabaseConfigured } from "./supabase";

export async function readEditor(recordId) {
  if (!supabaseConfigured() || !recordId) return null;
  const rows = await sb(
    `task_override?scope=eq.kinby&key=eq.${encodeURIComponent(String(recordId))}&select=data`
  ).catch(() => null);
  return rows?.[0]?.data || null;
}

export async function writeEditor(recordId, { name, revision }) {
  if (!supabaseConfigured() || !recordId) return false;
  const key = String(recordId);
  const enc = encodeURIComponent(key);
  const data = { name: name || "", rev: revision ? String(revision) : "", at: new Date().toISOString() };
  const exist = await sb(`task_override?scope=eq.kinby&key=eq.${enc}&select=key`).catch(() => null);
  if (exist && exist.length) {
    await sb(`task_override?scope=eq.kinby&key=eq.${enc}`, {
      method: "PATCH",
      body: { data },
      prefer: "return=minimal",
    });
  } else {
    await sb("task_override", {
      method: "POST",
      body: { scope: "kinby", key, data },
      prefer: "return=minimal",
    });
  }
  return true;
}
