import { denyUnlessPageEdit, getPerms } from "../../../lib/auth";
import {
  ensureBucket,
  exists,
  joinPath,
  KEEP,
  listDir,
  move,
  remove,
  safeName,
  safePath,
  storageConfigured,
  upload,
  walkPaths,
} from "../../../lib/storage";

export const dynamic = "force-dynamic";

const fail = (e) => Response.json({ error: String(e?.message || e) }, { status: 200 });

// 閲覧できない人には中身を返さない。
async function denyUnlessView(req) {
  const { perms } = await getPerms(req);
  if (!perms) return Response.json({ error: "ログインが必要です" }, { status: 401 });
  if (!perms.pages?.files?.view) {
    return Response.json({ error: "このページを見る権限がありません" }, { status: 403 });
  }
  return null;
}

// 一覧：?path=フォルダ のひと階層ぶん
export async function GET(req) {
  const denied = await denyUnlessView(req);
  if (denied) return denied;
  if (!storageConfigured()) return Response.json({ folders: [], files: [], error: "Supabase 未設定です" });
  try {
    const path = safePath(new URL(req.url).searchParams.get("path") || "");
    await ensureBucket();
    const { folders, files } = await listDir(path);
    return Response.json({ path, folders, files });
  } catch (e) {
    return fail(e);
  }
}

// フォルダを作る： { path, name }
export async function POST(req) {
  const denied = await denyUnlessPageEdit(req, "files");
  if (denied) return denied;
  try {
    const b = await req.json();
    const dir = safePath(b?.path || "");
    const name = safeName(b?.name);
    const key = joinPath(dir, name);
    if (await exists(key)) return Response.json({ error: "同じ名前がすでにあります" });
    // 空のフォルダを残すための目印。中身が入っても消さない（削除時にまとめて消す）。
    await upload(`${key}/${KEEP}`, new Uint8Array(0), "text/plain");
    return Response.json({ ok: true, path: key });
  } catch (e) {
    return fail(e);
  }
}

// 名前を変える： { path, name, newName, kind }
export async function PATCH(req) {
  const denied = await denyUnlessPageEdit(req, "files");
  if (denied) return denied;
  try {
    const b = await req.json();
    const dir = safePath(b?.path || "");
    const name = safeName(b?.name);
    const newName = safeName(b?.newName);
    if (name === newName) return Response.json({ ok: true });
    const from = joinPath(dir, name);
    const to = joinPath(dir, newName);
    if (await exists(to)) return Response.json({ error: "同じ名前がすでにあります" });
    if (b?.kind === "folder") {
      // フォルダには実体が無いので、配下のファイルを1つずつ移す
      const keys = await walkPaths(from);
      if (keys.length === 0) return Response.json({ error: "中身を取得できませんでした" });
      for (const k of keys) await move(k, to + k.slice(from.length));
    } else {
      await move(from, to);
    }
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

// 消す： ?path=フォルダ&name=名前&kind=file|folder
export async function DELETE(req) {
  const denied = await denyUnlessPageEdit(req, "files");
  if (denied) return denied;
  try {
    const q = new URL(req.url).searchParams;
    const dir = safePath(q.get("path") || "");
    const name = safeName(q.get("name"));
    const key = joinPath(dir, name);
    if (q.get("kind") === "folder") {
      const keys = await walkPaths(key);
      // 1回の削除はキー数が多くなりすぎないよう分けて投げる
      for (let i = 0; i < keys.length; i += 100) await remove(keys.slice(i, i + 100));
    } else {
      await remove([key]);
    }
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
