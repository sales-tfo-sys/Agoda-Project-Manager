import { denyUnlessPageEdit, getPerms } from "../../../lib/auth";
import {
  ensureBucket,
  exists,
  folderStat,
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
    // フォルダは実体が無いので、中を数えて サイズ・作成・更新 を出す。
    // 読み取り回数はここでまとめて上限を決め、深いフォルダで増えすぎないようにする。
    const budget = { left: 40 };
    const withStat = [];
    for (const d of folders) {
      const s = await folderStat(path ? `${path}/${d.name}` : d.name, budget);
      withStat.push({
        ...d,
        size: s.size,
        files: s.files,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        partial: s.partial,
      });
    }
    return Response.json({ path, folders: withStat, files });
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

// 名前を変える／別のフォルダへ移す： { path, name, newName, toPath, kind }
//   newName だけ … 同じ場所で改名
//   toPath だけ  … 名前はそのままで移動
//   両方        … 移動して改名
export async function PATCH(req) {
  const denied = await denyUnlessPageEdit(req, "files");
  if (denied) return denied;
  try {
    const b = await req.json();
    const dir = safePath(b?.path || "");
    const name = safeName(b?.name);
    const newName = b?.newName === undefined ? name : safeName(b.newName);
    const toDir = b?.toPath === undefined ? dir : safePath(b.toPath);
    if (name === newName && toDir === dir) return Response.json({ ok: true });
    const from = joinPath(dir, name);
    const to = joinPath(toDir, newName);
    // フォルダを自分自身や自分の中へは移せない（入れ子が壊れ、元に戻せなくなる）
    if (b?.kind === "folder" && (to === from || to.startsWith(from + "/"))) {
      return Response.json({ error: "そのフォルダの中へは移動できません" });
    }
    if (await exists(to)) return Response.json({ error: "移動先に同じ名前がすでにあります" });
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
// 削除だけは編集とは別の許可（pages.files.del）が要る。
export async function DELETE(req) {
  const { perms } = await getPerms(req);
  if (!perms) return Response.json({ error: "ログインが必要です" }, { status: 401 });
  if (!perms.pages?.files?.del) {
    return Response.json({ error: "削除する権限がありません" }, { status: 403 });
  }
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
