import { sb, supabaseConfigured } from "../../../lib/supabase";
import { denyUnlessPageEdit } from "../../../lib/auth";
import { writeSheetCells } from "../../../lib/sheetWrite";
import { invalidate } from "../../../lib/cache";

export const dynamic = "force-dynamic";

// フォーム回答シート（Temairazu）のチェック欄を、スプレッドシートに書き戻す。
//   body: { id, row, rowKey, col, header, value }
//     id     … 登録済みフォームシートの id（scope=form）
//     row    … 画面の行番号（0始まり）、rowKey … その行の先頭列の値
//     col    … 画面の列番号（0始まり）、header … その列の見出し
//     value  … true / false
//
// 画面を開いたあとに誰かが行を足していると位置がずれるので、
// 行と列が画面で見えていたものと同じかを必ず確かめてから書く。
export async function POST(req) {
  const denied = await denyUnlessPageEdit(req, "workReq");
  if (denied) return denied;
  if (!supabaseConfigured()) return Response.json({ error: "Supabase 未設定です" }, { status: 200 });
  try {
    const b = await req.json();
    const id = String(b?.id || "").trim();
    const row = Number(b?.row);
    const col = Number(b?.col);
    const rowKey = String(b?.rowKey ?? "");
    const header = String(b?.header ?? "");
    const value = !!b?.value;
    if (!id || !Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) {
      return Response.json({ error: "行と列の指定が正しくありません" }, { status: 200 });
    }

    const rows = await sb(`task_override?scope=eq.form&key=eq.${encodeURIComponent(id)}&select=data`);
    const url = rows?.[0]?.data?.url;
    if (!url) return Response.json({ error: "シートのURLが登録されていません" }, { status: 200 });

    const stale =
      "シートの中身が変わっています。画面を開き直してから、もう一度お試しください。";
    const res = await writeSheetCells(
      url,
      (rs) => {
        // 画面と同じ行か（先頭列の値で確かめる）。ずれていたら同じ値の行を探し直す
        if (String(rs?.[row]?.[0] ?? "") === rowKey) return row;
        const hits = rs
          .map((r, i) => (String(r?.[0] ?? "") === rowKey ? i : -1))
          .filter((i) => i >= 0);
        return hits.length === 1 ? hits[0] : -1;
      },
      (grid) => {
        // 画面と同じ列か（見出しで確かめる）
        const heads = (grid.headers || []).map((x) => String(x || ""));
        let c = heads[col] === header ? col : heads.indexOf(header);
        if (header && c < 0) return [];
        return [{ col: c, value: value ? "TRUE" : "FALSE" }];
      }
    );
    if (res.error) return Response.json({ error: res.error }, { status: 200 });
    if (res.skipped) return Response.json({ error: stale }, { status: 200 });

    invalidate(`formgrid:${id}`); // 次に開いたときシートの値を読み直す
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
