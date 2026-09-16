import { sb, supabaseConfigured } from "../../../lib/supabase";
import { denyUnlessPageEdit } from "../../../lib/auth";
import { writeSheetCells } from "../../../lib/sheetWrite";
import { invalidate } from "../../../lib/cache";

export const dynamic = "force-dynamic";

// 作業依頼シートの1行に対する手動入力（レコード作成/レコードNo/作業完了日）を保存する。
//   scope=workreqcell, key=`<sheetId>::<rowKey>`, data={ created, recordNo, doneDate }
// あわせて、同じ値を元のスプレッドシートの同じ列にも書き戻す
// （シートを見ている人にも伝わるように）。シートへの書き込みに失敗しても
// サイト側の保存は残し、その旨を sheetError で返す。

// 画面と同じ規則で列を探す（app/work-requests/page.js の cols と合わせる）
function findCols(headers) {
  const h = (headers || []).map((x) => String(x || ""));
  const find = (pred) => h.findIndex(pred);
  return {
    recCreate: find((x) => x.replace(/\s/g, "").includes("レコード作成")),
    recNo: find((x) => x.replace(/\s/g, "").includes("レコードNo")),
    done: find((x) => x.includes("作業完了日")),
  };
}

// 行の見分け方も画面と同じ（先頭列＝タイムスタンプ。空なら「#行番号」）
function findRowIndex(rows, rowKey) {
  if (rowKey.startsWith("#")) {
    const i = Number(rowKey.slice(1));
    return Number.isInteger(i) && i >= 0 && i < rows.length ? i : -1;
  }
  const hit = rows.findIndex((r) => String(r?.[0] ?? "").trim() === rowKey);
  return hit;
}

export async function POST(req) {
  const denied = await denyUnlessPageEdit(req, "workReq");
  if (denied) return denied;
  if (!supabaseConfigured()) return Response.json({ error: "Supabase 未設定です" }, { status: 200 });
  try {
    const b = await req.json();
    const sheetId = String(b?.sheetId || "").trim();
    const rowKey = String(b?.rowKey ?? "").trim();
    if (!sheetId || !rowKey) return Response.json({ error: "sheetId と rowKey が必要です" }, { status: 200 });
    const data = {
      created: !!b?.created,
      recordNo: String(b?.recordNo ?? "").trim(),
      doneDate: String(b?.doneDate ?? "").trim(),
    };
    const key = `${sheetId}::${rowKey}`;
    const enc = encodeURIComponent(key);
    const exist = await sb(`task_override?scope=eq.workreqcell&key=eq.${enc}&select=key`);
    if (exist && exist.length) {
      await sb(`task_override?scope=eq.workreqcell&key=eq.${enc}`, {
        method: "PATCH",
        body: { data },
        prefer: "return=minimal",
      });
    } else {
      await sb("task_override", {
        method: "POST",
        body: { scope: "workreqcell", key, data },
        prefer: "return=minimal",
      });
    }

    // ここからスプレッドシートへの書き戻し
    let sheetError = null;
    try {
      const rows = await sb(
        `task_override?scope=eq.workreq&key=eq.${encodeURIComponent(sheetId)}&select=data`
      );
      const url = rows?.[0]?.data?.url;
      if (!url) {
        sheetError = "シートのURLが登録されていないため、スプレッドシートには反映していません";
      } else {
        const res = await writeSheetCells(
          url,
          (r) => findRowIndex(r, rowKey),
          (grid) => {
            const cols = findCols(grid.headers);
            return [
              { col: cols.recCreate, value: data.created ? "〇" : "" },
              { col: cols.recNo, value: data.recordNo },
              // 日付はシートの表記に合わせて YYYY/MM/DD で入れる
              { col: cols.done, value: data.doneDate ? data.doneDate.replace(/-/g, "/") : "" },
            ];
          }
        );
        if (res.error) sheetError = res.error;
        else invalidate(`workreqgrid:${sheetId}`); // 次に開いたときシートの値を読み直す
      }
    } catch (e) {
      sheetError = String(e?.message || e);
    }

    return Response.json({ ok: true, sheetError });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
