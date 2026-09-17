import { sb, supabaseConfigured } from "../../../lib/supabase";
import { denyUnlessPerm } from "../../../lib/auth";
import { writeSheetCells } from "../../../lib/sheetWrite";
import { invalidate } from "../../../lib/cache";

export const dynamic = "force-dynamic";

// フォーム回答シートの「決められた列」だけ、文字を書き換えられるようにする。
//   body: { id, row, rowKey, col, header, text }
//
// いまのところ対象は Hotel ID（施設一覧との紐づけに使う列）だけ。
// 回答そのもの（お客様が書いた内容）を書き換えられると困るので、
// 見出しがこの一覧に当てはまる列以外は受け付けない。
const ALLOW_HEADERS = [/^HotelID$/i, /^HID$/i, /ホテルID/];
const MAX = 64;

export async function POST(req) {
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  if (!supabaseConfigured()) return Response.json({ error: "Supabase 未設定です" }, { status: 200 });
  try {
    const b = await req.json();
    const id = String(b?.id || "").trim();
    const row = Number(b?.row);
    const col = Number(b?.col);
    const rowKey = String(b?.rowKey ?? "");
    const header = String(b?.header ?? "");
    const value = String(b?.text ?? "").trim();

    if (!id || !Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) {
      return Response.json({ error: "行と列の指定が正しくありません" }, { status: 200 });
    }
    const flat = header.replace(/[\s　]/g, "");
    if (!ALLOW_HEADERS.some((re) => re.test(flat))) {
      return Response.json({ error: "この列は画面から直せません" }, { status: 200 });
    }
    if (value.length > MAX || /[\r\n\t]/.test(value)) {
      return Response.json({ error: "入れられない文字が含まれています" }, { status: 200 });
    }

    const rows = await sb(`task_override?scope=eq.form&key=eq.${encodeURIComponent(id)}&select=data`);
    const url = rows?.[0]?.data?.url;
    if (!url) return Response.json({ error: "シートのURLが登録されていません" }, { status: 200 });

    const res = await writeSheetCells(
      url,
      (rs) => {
        // 画面と同じ行かを、先頭列（タイムスタンプ）で確かめる
        if (String(rs?.[row]?.[0] ?? "") === rowKey) return row;
        const hits = rs
          .map((r, i) => (String(r?.[0] ?? "") === rowKey ? i : -1))
          .filter((i) => i >= 0);
        return hits.length === 1 ? hits[0] : -1;
      },
      (grid) => {
        // 画面と同じ列かを、見出しで確かめる
        const heads = (grid.headers || []).map((x) => String(x || ""));
        const c = heads[col] === header ? col : heads.indexOf(header);
        if (c < 0) return [];
        return [{ col: c, value }];
      }
    );
    if (res.error) return Response.json({ error: res.error }, { status: 200 });
    if (res.skipped) {
      return Response.json(
        { error: "シートの中身が変わっています。画面を開き直してからお試しください。" },
        { status: 200 }
      );
    }

    invalidate(`formgrid:${id}`); // 次に開いたときシートの値を読み直す
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
