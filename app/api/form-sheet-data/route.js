import { cachedEntry } from "../../../lib/cache";
import { sb, supabaseConfigured } from "../../../lib/supabase";
import { fetchSheetGrid } from "../../../lib/formSheet";

export const dynamic = "force-dynamic";

// 登録済みフォームシート（id）の中身を表として返す。
export async function GET(req) {
  if (!supabaseConfigured()) return Response.json({ error: "Supabase 未設定です" }, { status: 200 });
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return Response.json({ error: "id が必要です" }, { status: 200 });
    const rows = await sb(
      `task_override?scope=eq.form&key=eq.${encodeURIComponent(id)}&select=data`
    );
    const url = rows?.[0]?.data?.url;
    if (!url) return Response.json({ error: "URLが未登録です" }, { status: 200 });
    // 中身と、それを実際にシートから読んだ時刻を組で受け取る（サーバーで最大1分ためている）
    const { value: data, at } = await cachedEntry(`formgrid:${id}`, 60 * 1000, () =>
      fetchSheetGrid(url)
    );
    if (data?.error) return Response.json(data);
    return Response.json({ ...data, fetchedAt: new Date(at).toISOString() });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
