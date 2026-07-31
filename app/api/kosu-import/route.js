import { NextResponse } from "next/server";
import { sb, supabaseConfigured } from "@/lib/supabase";
import { denyUnlessPerm } from "@/lib/auth";
import { fetchKosuSheet, parseKosuSheet } from "@/lib/kosuSheet";

export const dynamic = "force-dynamic";

const isAdHoc = (type) => /ad\s*hoc/i.test(type || "");

// 作業工数管理シートの過去データを kosu_entry に取り込む（手動・移行用）。
// Regular は value（件数/時間）、Ad Hoc は value=稼働時間・count=完了数。
export async function POST(req) {
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "Supabase が未設定です" }, { status: 200 });
  }
  try {
    // シートを読む（西暦は当年基準で末尾から割当）
    const text = await fetchKosuSheet();
    const thisYear = new Date().getFullYear();
    const rows = parseKosuSheet(text, thisYear);
    if (!rows.length) {
      return NextResponse.json({ error: "取り込む行がありません" }, { status: 200 });
    }

    // 担当者・作業マスタを取得
    const [personsRaw, tasksRaw] = await Promise.all([
      sb("kosu_person?select=id,name"),
      sb("kosu_task?select=id,task_type,content"),
    ]);
    const personByName = new Map((personsRaw || []).map((p) => [p.name, p.id]));
    const taskByContent = new Map(
      (tasksRaw || []).map((t) => [t.content, { id: t.id, type: t.task_type }])
    );

    // シートにあって kosu_task に無い作業を作成する
    const missing = new Map(); // content -> task_type
    for (const r of rows) {
      if (!r.content) continue;
      if (!taskByContent.has(r.content) && !missing.has(r.content)) {
        missing.set(r.content, r.type);
      }
    }
    if (missing.size) {
      const body = [...missing.entries()].map(([content, type]) => ({
        task_type: type || "Ad hoc task",
        content,
        // Ad Hoc と作業時間は「時間」、その他は「件数」
        unit: isAdHoc(type) || /作業時間/.test(content) ? "time" : "count",
      }));
      const created = await sb("kosu_task", {
        method: "POST",
        body,
        prefer: "return=representation",
      });
      for (const t of created || []) {
        taskByContent.set(t.content, { id: t.id, type: t.task_type });
      }
    }

    // kosu_entry の upsert 行を組み立てる
    const now = new Date().toISOString();
    const entries = [];
    let skippedPerson = 0;
    for (const r of rows) {
      const person_id = personByName.get(r.tanto);
      if (!person_id) {
        skippedPerson += r.days.length;
        continue;
      }
      const task = taskByContent.get(r.content);
      if (!task) continue;
      const adhoc = isAdHoc(r.type);
      for (const d of r.days) {
        entries.push({
          entry_date: d.date,
          task_id: task.id,
          person_id,
          value: d.v1 != null ? d.v1 : 0,
          done_count: adhoc ? (d.v2 != null ? d.v2 : null) : null,
          updated_at: now,
        });
      }
    }

    // 500件ずつ upsert（entry_date,task_id,person_id で衝突マージ）
    let saved = 0;
    for (let i = 0; i < entries.length; i += 500) {
      const chunk = entries.slice(i, i + 500);
      await sb("kosu_entry?on_conflict=entry_date,task_id,person_id", {
        method: "POST",
        body: chunk,
        prefer: "resolution=merge-duplicates,return=minimal",
      });
      saved += chunk.length;
    }

    // Ad Hoc タスクは、実績のある担当者を対応者(task_assign)に登録する。
    // これで工数入力・ダッシュボードに表示され、以降その人が入力できる。
    const assignPairs = new Map(); // "content|person_id" → {key, person_id}
    for (const r of rows) {
      if (!isAdHoc(r.type)) continue;
      const person_id = personByName.get(r.tanto);
      if (!person_id || !r.content) continue;
      assignPairs.set(`${r.content}|${person_id}`, { key: r.content, person_id });
    }
    const assignRows = [...assignPairs.values()].map((a) => ({
      scope: "adhoc",
      key: a.key,
      person_id: a.person_id,
      role: "main",
      updated_at: now,
    }));
    for (let i = 0; i < assignRows.length; i += 500) {
      await sb("task_assign?on_conflict=scope,key,person_id", {
        method: "POST",
        body: assignRows.slice(i, i + 500),
        prefer: "resolution=merge-duplicates,return=minimal",
      }).catch(() => {});
    }
    // ※ 作業工数管理シートにあって進捗シートに無い Ad Hoc は、
    //   多くが「連携（集約）先のラベル」（例：IHM ← IHM_CM/Plan/Room）なので、
    //   ダッシュボードに独立タスクとしては追加しない。

    return NextResponse.json({
      ok: true,
      saved,
      tasksCreated: missing.size,
      assigned: assignRows.length,
      skippedPerson,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
