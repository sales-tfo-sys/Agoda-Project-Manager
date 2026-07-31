import { supabaseConfigured, sb } from "../../../lib/supabase";
import { getSession, SESSION_COOKIE } from "../../../lib/auth";

export const dynamic = "force-dynamic";

function readCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

// 入力値の取得
//   1日ぶん : /api/kosu-entries?date=2026-07-22
//   期間ぶん: /api/kosu-entries?from=2025-12-08&to=2026-07-31（工数明細用）
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!supabaseConfigured()) {
    return Response.json({ configured: false, entries: [] });
  }
  try {
    if (from && to) {
      const entries = await sb(
        `kosu_entry?entry_date=gte.${encodeURIComponent(from)}` +
          `&entry_date=lte.${encodeURIComponent(to)}` +
          `&select=entry_date,task_id,person_id,value,done_count`
      );
      return Response.json({ configured: true, entries: entries || [] });
    }
    if (!date) return Response.json({ configured: true, entries: [] });
    const entries = await sb(
      `kosu_entry?entry_date=eq.${encodeURIComponent(
        date
      )}&select=task_id,person_id,value,done_count`
    );
    return Response.json({ configured: true, entries: entries || [] });
  } catch (e) {
    return Response.json({ configured: true, entries: [], error: String(e?.message || e) });
  }
}

// 指定日の入力値を保存（upsert）
// body: { date, entries: [{ task_id, person_id, value }] }
export async function POST(req) {
  if (!supabaseConfigured()) {
    return Response.json({ error: "Supabase 未接続のため保存できません" }, { status: 200 });
  }
  try {
    const b = await req.json();
    const date = b?.date;
    const list = Array.isArray(b?.entries) ? b.entries : [];
    if (!date) return Response.json({ error: "date が必要です" }, { status: 200 });
    if (!list.length) return Response.json({ saved: 0 });

    // オーナー・管理者以外（＝メンバー）は自分ぶんしか書き込めない
    // （画面での絞り込みだけに頼らずサーバー側でも制限する）
    const session = await getSession(readCookie(req, SESSION_COOKIE));
    const selfOnly =
      session && !["owner", "admin"].includes(session.role) ? session.personId : null;

    let valid = list.filter((e) => e && e.task_id && e.person_id);
    if (selfOnly) {
      const mine = valid.filter((e) => String(e.person_id) === String(selfOnly));
      if (mine.length !== valid.length) {
        return Response.json(
          { error: "他のメンバーぶんの工数は保存できません" },
          { status: 200 }
        );
      }
      valid = mine;
    }
    // 稼働時間(value)と完了数(done_count)の両方が空なら「入力を消した」＝削除
    const blank = (x) => x === null || x === undefined || x === "";
    const isEmpty = (e) => blank(e.value) && blank(e.done_count);
    const dels = valid.filter(isEmpty);
    const rows = valid
      .filter((e) => !isEmpty(e))
      .map((e) => ({
        entry_date: date,
        task_id: e.task_id,
        person_id: e.person_id,
        value: Number(e.value) || 0,
        // Ad Hoc の完了数。Regular は送られてこないので null のまま
        done_count: blank(e.done_count) ? null : Number(e.done_count) || 0,
        updated_at: new Date().toISOString(),
      }));

    if (rows.length) {
      await sb("kosu_entry?on_conflict=entry_date,task_id,person_id", {
        method: "POST",
        body: rows,
        prefer: "resolution=merge-duplicates,return=minimal",
      });
    }
    for (const d of dels) {
      await sb(
        `kosu_entry?entry_date=eq.${encodeURIComponent(date)}` +
          `&task_id=eq.${encodeURIComponent(d.task_id)}` +
          `&person_id=eq.${encodeURIComponent(d.person_id)}`,
        { method: "DELETE", prefer: "return=minimal" }
      );
    }
    return Response.json({ saved: rows.length, deleted: dels.length });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
