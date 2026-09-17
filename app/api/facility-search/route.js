import { NextResponse } from "next/server";
import { cached } from "@/lib/cache";
import { supabaseConfigured } from "@/lib/supabase";
import { readSnapshot } from "@/lib/kintoneSnapshot";

export const dynamic = "force-dynamic";

// 施設をさがす（回答に紐づける施設を、人が選ぶための一覧）。
//   /api/facility-search?q=95060302  … HID・施設名・レコード番号で部分一致
// 返すのは最大30件。重いスナップショットは3分ためておく。
const HID = "文字列__1行_";
const NAME = "文字列__1行__0";
const STAGE = "ドロップダウン";
const TYPE = "ドロップダウン_13";

const text = (v) => String(v ?? "").trim();
const norm = (v) =>
  String(v || "")
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .toLowerCase();

async function list() {
  const snap = await readSnapshot();
  return (snap?.data?.records || []).map((r) => ({
    id: text(r?.$id?.value),
    hid: text(r?.[HID]?.value),
    name: text(r?.[NAME]?.value),
    stage: text(r?.[STAGE]?.value),
    type: text(r?.[TYPE]?.value) || "Hotel",
  }));
}

export async function GET(req) {
  if (!supabaseConfigured()) return NextResponse.json({ items: [] });
  try {
    const q = norm(new URL(req.url).searchParams.get("q") || "");
    const all = await cached("facility:search", 3 * 60 * 1000, list);
    if (!q) {
      // 何も入れていないときは、新しいレコードから少しだけ出す
      const items = [...all].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 30);
      return NextResponse.json({ items });
    }
    const hit = all.filter(
      (x) => norm(x.hid).includes(q) || norm(x.name).includes(q) || x.id === q
    );
    // HID がそのまま一致するものを先に、あとはレコード番号の新しい順
    hit.sort((a, b) => {
      const ea = norm(a.hid) === q ? 0 : 1;
      const eb = norm(b.hid) === q ? 0 : 1;
      return ea - eb || Number(b.id) - Number(a.id);
    });
    return NextResponse.json({ items: hit.slice(0, 30), total: hit.length });
  } catch (e) {
    return NextResponse.json({ items: [], error: String(e?.message || e) });
  }
}
