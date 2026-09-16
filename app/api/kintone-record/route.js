import { NextResponse } from "next/server";
import { kintoneConfigured, updateRecord, fetchRecord } from "@/lib/kintone";
import { patchSnapshotRecord } from "@/lib/kintoneSnapshot";
import { writeEditor, readEditor } from "@/lib/kintoneEditor";
import { denyUnlessPerm, getPerms } from "@/lib/auth";
import { invalidate } from "@/lib/cache";

export const dynamic = "force-dynamic";

// 施設一覧の詳細から、Kintone のレコードを直す。
//   GET  ?id=3663                      … サイトから最後に直した人（表示用）
//   POST { id, revision, values:{} }   … 項目を書き換える
//
// ★ 書き換えてよいフィールドコードは、この固定の一覧のみ。
//   画面から送られてきたコードは、必ずここに載っているものだけを通す。
//   （計算・レコード番号・作成者/更新者などは Kintone 側で書き換え不可）
export const WRITABLE = {
  ドロップダウン_13: "案件名",
  文字列__1行_: "HID",
  文字列__1行__0: "Hotel Name",
  ドロップダウン: "ステータス",
  ドロップダウン_2: "CM種別",
  ドロップダウン_4: "CM設定",
  文字列__1行__6: "URL",
  文字列__1行__7: "ID",
  文字列__1行__8: "PW",
  文字列__1行__9: "契約コード",
  日付: "Stage変更日",
  日付_8: "YCS完了メール",
  日付_6: "掲載開始",
  ドロップダウン_11: "DSA",
  文字列__複数行__1: "滞留理由",
  日付_3: "いつまでに",
  ドロップダウン_7: "誰が",
  文字列__複数行__4: "なにをする",
};

export async function GET(req) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ editor: null });
    return NextResponse.json({ editor: await readEditor(id) });
  } catch {
    return NextResponse.json({ editor: null });
  }
}

export async function POST(req) {
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  if (!kintoneConfigured()) return NextResponse.json({ error: "Kintone が未設定です" });
  try {
    const b = await req.json();
    const id = String(b?.id || "").trim();
    if (!id) return NextResponse.json({ error: "id が必要です" });

    // 許可した項目だけを通す
    const values = {};
    for (const [code, v] of Object.entries(b?.values || {})) {
      if (code in WRITABLE) values[code] = v == null ? "" : String(v);
    }
    if (!Object.keys(values).length) return NextResponse.json({ error: "変更がありません" });

    const { revision } = await updateRecord(id, values, b?.revision);

    // 誰が直したかを覚えておく（Kintone 側の更新者はトークンの持ち主になるため）
    const { session } = await getPerms(req);
    const who = session?.name || session?.email || "";
    await writeEditor(id, { name: who, revision }).catch(() => {});

    // 入った値を読み直して、保存済みのデータ（スナップショット）にも反映する。
    // これで一覧・詳細とも、次の「Kintone取込」を待たずに新しい値になる。
    const record = await fetchRecord(id);
    if (record) {
      await patchSnapshotRecord(record).catch(() => {});
      invalidate("records:snapshot");
      invalidate("kintone:records");
      invalidate("kintone:basics");
    }

    return NextResponse.json({ ok: true, record, revision, editor: { name: who, rev: String(revision) } });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) });
  }
}
