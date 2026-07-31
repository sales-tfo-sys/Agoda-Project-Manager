import { cached } from "../../../lib/cache";
import { supabaseConfigured } from "../../../lib/supabase";
import { readAdhocItems } from "../../../lib/adhocStore";
import { parseAdhocCsv } from "../../../lib/adhocSheet";

// Ad Hoc タスクの取得。
//   通常は Supabase の保存済みデータ（adhoc_item）を返す（シートは読まない）。
//   まだ取り込んでいなければ、進捗シートを読んでそのまま返す（移行前の互換）。
//   取り込みは画面の「進捗シート取込」ボタン（POST /api/adhoc-import）で行う。
const SHEET_ID =
  process.env.KOSU_SHEET_ID || "1mXUySyokFhE0fjjmSIjmpF2VNKGWZCzEkuwccK9UPwY";
const GID = process.env.ADHOC_GID || "111345294";

export const dynamic = "force-dynamic";

export async function GET() {
  // ① Supabase に取り込み済みならそれを返す（シートを読まない＝速い・シート非依存）
  if (supabaseConfigured()) {
    try {
      const items = await readAdhocItems();
      if (items) {
        return Response.json({ tasks: items, source: "supabase", stored: true });
      }
    } catch {
      /* 読めなければ下のシート読み込みへ */
    }
  }

  // ② 未取込 → 進捗シートを読む（メモリ3分キャッシュ。移行が済めば通らない経路）
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`;
  try {
    const text = await cached("sheet:adhoc", 3 * 60 * 1000, async () => {
      const res = await fetch(url, { next: { revalidate: 300 } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    });
    if (text.trimStart().startsWith("<")) {
      return Response.json(
        { error: "シートが公開されていません（リンク共有をご確認ください）" },
        { status: 200 }
      );
    }
    return Response.json({ tasks: parseAdhocCsv(text), source: "google-sheet" });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
