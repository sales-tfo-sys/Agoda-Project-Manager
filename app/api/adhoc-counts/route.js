import { cached } from "../../../lib/cache";
import { readAdhocItems } from "../../../lib/adhocStore";
import { sb, supabaseConfigured } from "../../../lib/supabase";
import { extractSheetId, extractGid, fetchSheetCell } from "../../../lib/sheetCell";

export const dynamic = "force-dynamic";

// 数値化（"1,234" → 1234／数値でなければ null）
function toNum(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

// Ad Hoc タスクごとに登録したシート（URL＋シート名＋セル）から
// 受注数・完了数を取得して { items: { [taskKey]: { total, done } } } を返す。
// 設定は task_override.data（scope=adhoc）に保存されている。
// 読めなかったタスクは errors[taskKey] に理由を入れる（画面で理由を出せるように）。
//
// 進捗が Complete のタスクは、シートを読まずに保存済みの値を返す。
// 完了後も毎回シートを読みに行くと、タスクが増えるほど表示が遅くなるため。
// まだ保存されていなければ1回だけ読んで task_override に焼き付ける（設定はそのまま残す）。
export async function GET() {
  if (!supabaseConfigured()) return Response.json({ items: {}, errors: {} });
  try {
    const rows = await sb("task_override?scope=eq.adhoc&select=key,data");
    // 進捗は「上書き → 取込データ」の順で効く。表示と同じ判定にするため両方見る
    const srcStatus = new Map();
    for (const it of (await readAdhocItems().catch(() => null)) || []) {
      if (it?.task) srcStatus.set(it.task, it.status);
    }
    const items = {};
    const errors = {};
    // 焼き付けた値。クライアント側の上書きデータにも混ぜてもらう
    // （そうしないと、次に何か編集して保存したときに消えてしまう）
    const frozen = {};
    // 失敗は投げずに { err } で返し、受注数・完了数のどちらが原因でも理由を拾えるようにする
    const cell = (id, gid, ref) =>
      ref
        ? cached(`sheetcell:${id}:${gid || ""}:${ref}`, 60 * 1000, () =>
            fetchSheetCell(id, gid, ref)
          ).then(
            (v) => ({ v }),
            (e) => ({ err: String(e?.message || e) })
          )
        : Promise.resolve({ v: null });

    await Promise.all(
      (rows || []).map(async (row) => {
        const d = row.data || {};
        const done0 = (d.status ?? srcStatus.get(row.key)) === "Complete";
        const saved = { total: toNum(d.total), done: toNum(d.done) };
        // 完了済み＋保存済み → シートは読まない
        if (done0 && (saved.total != null || saved.done != null)) {
          items[row.key] = saved;
          return;
        }
        const id = extractSheetId(d.sheetUrl);
        // タブは URL の gid で特定する（受注数・完了数は同じタブ前提）
        const gid = extractGid(d.sheetUrl);
        if (!d.orderCell && !d.doneCell) return;
        if (!id) {
          if (d.sheetUrl) errors[row.key] = "URL からスプレッドシートを特定できません";
          return;
        }
        const [order, done] = await Promise.all([
          cell(id, gid, d.orderCell),
          cell(id, gid, d.doneCell),
        ]);
        const err = order.err || done.err;
        if (err) errors[row.key] = err;
        const got = { total: toNum(order.v), done: toNum(done.v) };
        items[row.key] = got;

        // 完了済みなら、この1回ぶんを保存して以降は読まないようにする
        if (done0 && (got.total != null || got.done != null)) {
          frozen[row.key] = got;
          await sb("task_override?on_conflict=scope,key", {
            method: "POST",
            body: [
              {
                scope: "adhoc",
                key: row.key,
                data: { ...d, total: got.total, done: got.done },
                updated_at: new Date().toISOString(),
              },
            ],
            prefer: "resolution=merge-duplicates,return=minimal",
          }).catch(() => {});
        }
      })
    );

    return Response.json({ items, errors, frozen });
  } catch (e) {
    return Response.json(
      { items: {}, errors: {}, frozen: {}, error: String(e?.message || e) },
      { status: 200 }
    );
  }
}
