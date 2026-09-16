import { NextResponse } from "next/server";
import { kintoneConfigured, listComments, addComment } from "@/lib/kintone";
import { denyUnlessPerm, getPerms } from "@/lib/auth";

export const dynamic = "force-dynamic";

// 施設一覧の詳細で出す「メモ」＝ Kintone のレコードのコメント。
//   GET  ?id=3663        … そのレコードのコメントを新しい順に返す
//   POST { id, text }    … コメントを1件足す
//
// 書き込みは API トークンで行うため、Kintone 上の投稿者は
// トークンの利用者（Administrator）になる。誰が書いたのか分かるように、
// 本文の先頭にサイトのログイン名を付ける。

export async function GET(req) {
  if (!kintoneConfigured()) return NextResponse.json({ comments: [] });
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id が必要です" });
    const comments = await listComments(id);
    return NextResponse.json({ comments });
  } catch (e) {
    return NextResponse.json({ comments: [], error: String(e?.message || e) });
  }
}

export async function POST(req) {
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  if (!kintoneConfigured()) return NextResponse.json({ error: "Kintone が未設定です" });
  try {
    const b = await req.json();
    const id = String(b?.id || "").trim();
    const text = String(b?.text ?? "").trim();
    if (!id) return NextResponse.json({ error: "id が必要です" });
    if (!text) return NextResponse.json({ error: "メモの内容を入れてください" });
    // Kintone のコメントは 65535 文字まで
    if (text.length > 60000) return NextResponse.json({ error: "メモが長すぎます" });

    const { session } = await getPerms(req);
    const who = session?.name || session?.email || null;
    const body = who ? `${who}：${text}` : text;

    await addComment(id, body);
    const comments = await listComments(id);
    return NextResponse.json({ ok: true, comments });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) });
  }
}
