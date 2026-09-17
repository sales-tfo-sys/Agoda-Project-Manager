import { NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/supabase";
import { kintoneConfigured, updateRecord, fetchRecord } from "@/lib/kintone";
import { patchSnapshotRecord } from "@/lib/kintoneSnapshot";
import { writeEditor } from "@/lib/kintoneEditor";
import { denyUnlessPerm, getPerms } from "@/lib/auth";
import { invalidate } from "@/lib/cache";
import { readResults, writeResult } from "@/lib/cmImport";
import { buildPlan, applyPlans, autolinkByHid } from "@/lib/cmImportRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// CM情報フォームの回答を施設一覧（Kintone）へ反映する。
//   GET                      … 反映の予定と、これまでの結果を返す（書き込みはしない）
//   POST { keys, limit }     … 反映する（keys 省略時は反映できるもの全部。1回の上限が limit）
//   POST { revert: key }     … その回答で入れた内容を取り消す（入れた値のままなら空に戻す）
//   POST { relink: {key,id}} … 施設を選んで（付け替えて）入れ直す
//   POST { unlink: key }     … 紐づけを外す
//   POST { autolinkByHid }   … Hotel ID がそのまま一致する回答を、まとめて紐づけて反映する
//
// 突き合わせは HID →（空なら）施設名（英語）→（それも空なら）施設名（日本語）。
// Kintone 側が空の項目にだけ入れる。CM種別は選択肢に無ければ入れずに知らせる。
// シートの「Kintoneへ反映済み」に印がある回答は対象にせず、反映したらその列に〇を付ける。

const text = (v) => String(v ?? "").trim();

export async function GET() {
  if (!supabaseConfigured()) return NextResponse.json({ error: "Supabase 未設定です" });
  try {
    return NextResponse.json(await buildPlan());
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) });
  }
}

export async function POST(req) {
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  if (!kintoneConfigured()) return NextResponse.json({ error: "Kintone が未設定です" });
  try {
    const b = await req.json().catch(() => ({}));
    const { session } = await getPerms(req);
    const who = session?.name || session?.email || "フォーム取込";

    // ── 取り消し：こちらで入れた値のままなら空に戻す ──
    if (b?.revert) {
      const results = await readResults();
      const r = results[b.revert];
      const applied = r?.applied || {};
      if (!Object.keys(applied).length) {
        return NextResponse.json({ error: "取り消せる記録がありません" });
      }
      let n = 0;
      const left = {};
      for (const [recordId, one] of Object.entries(applied)) {
        const rec = await fetchRecord(recordId).catch(() => null);
        const values = {};
        for (const [code, v] of Object.entries(one.wrote || {})) {
          if (text(rec?.[code]?.value) === text(v)) values[code] = "";
        }
        if (!Object.keys(values).length) {
          left[recordId] = one; // 入れたあとに変わっているものは残す
          continue;
        }
        const { revision } = await updateRecord(recordId, values);
        const after = await fetchRecord(recordId).catch(() => null);
        if (after) await patchSnapshotRecord(after).catch(() => {});
        await writeEditor(recordId, { name: who, revision }).catch(() => {});
        n += Object.keys(values).length;
      }
      if (!n) {
        return NextResponse.json({ error: "入れたあとに値が変わっているため、取り消しませんでした" });
      }
      await writeResult(b.revert, {
        ...r,
        applied: left,
        reverted: { at: new Date().toISOString(), by: who },
      });
      invalidate("records:snapshot");
      invalidate("kintone:records");
      invalidate("kintone:basics");
      return NextResponse.json({ ok: true, reverted: n });
    }

    // ── Hotel ID でまとめて紐づけ（そのまま反映）──
    if (b?.autolinkByHid) {
      const res = await autolinkByHid(who, { limit: Math.min(Number(b?.limit) || 200, 300) });
      if (res.error) return NextResponse.json({ error: res.error });
      return NextResponse.json({ ok: true, ...res });
    }

    // ── 紐づけを外す（入れた値はそのまま。必要なら先に取り消してから外す）──
    if (b?.unlink) {
      const results = await readResults();
      const r = results[b.unlink] || {};
      await writeResult(b.unlink, {
        ...r,
        recordIds: [],
        recordId: null,
        pinned: false,
        unlinked: { at: new Date().toISOString(), by: who },
      });
      return NextResponse.json({ ok: true });
    }

    // ── 付け替え：別のレコードに入れ直す ──
    if (b?.relink?.key && (b?.relink?.id || b?.relink?.ids?.length)) {
      const ids = (b.relink.ids || [b.relink.id]).map(String).filter(Boolean);
      const results = await readResults();
      const r = results[b.relink.key] || {};
      await writeResult(b.relink.key, {
        ...r,
        recordIds: ids,
        recordId: ids[0] || null,
        pinned: true,
        matchedBy: "選択",
        relinked: { at: new Date().toISOString(), by: who },
      });
      const plan = await buildPlan();
      if (plan.error) return NextResponse.json({ error: plan.error });
      const one = (plan.rows || []).filter((x) => x.key === b.relink.key && x.status === "pending");
      const res = one.length ? await applyPlans(one, who, plan.sheet, plan.cols, 1) : { applied: 0 };
      return NextResponse.json({ ok: true, linked: ids.length, applied: res.applied });
    }

    // ── 反映 ──
    const plan = await buildPlan();
    if (plan.error) return NextResponse.json({ error: plan.error });
    const only = Array.isArray(b?.keys) && b.keys.length ? new Set(b.keys) : null;
    const pending = (plan.rows || []).filter(
      (r) => r.status === "pending" && (!only || only.has(r.key))
    );
    const limit = Math.min(Math.max(Number(b?.limit) || 100, 1), 200);
    const res = await applyPlans(pending, who, plan.sheet, plan.cols, limit);
    return NextResponse.json({ ok: true, ...res, count: plan.count });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) });
  }
}
