// Supabase Storage（REST）への薄いラッパー。SDK は使わず fetch のみ。
// サーバー側の API ルートからのみ呼ぶ（キーは never client）。
//
// フォルダは Supabase Storage には実体が無く、キーの前半（プレフィックス）でしかない。
// 空のフォルダも画面に出したいので、フォルダを作るときは目印として
// 中に KEEP（0バイト）を1つ置き、一覧では隠している。

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// 資料の置き場。非公開バケット（配信は署名付きURLのみ）。
export const BUCKET = "work-files";

// 空フォルダの目印。一覧には出さない。
export const KEEP = ".keep";

// 1ファイルの上限。Supabase の無料プランはファイル50MB・合計1GB。
// ※プランを上げたらこの値も必ず直すこと（画面の案内文もこの定数を使う）。
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function storageConfigured() {
  return Boolean(URL_ && KEY);
}

function headers(extra) {
  return { apikey: KEY, Authorization: `Bearer ${KEY}`, ...(extra || {}) };
}

async function call(path, { method = "GET", body, raw, contentType } = {}) {
  if (!storageConfigured()) throw new Error("Supabase 未設定です");
  const h = headers();
  if (raw !== undefined) h["Content-Type"] = contentType || "application/octet-stream";
  else if (body !== undefined) h["Content-Type"] = "application/json";
  const res = await fetch(`${URL_}/storage/v1/${path}`, {
    method,
    headers: h,
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = typeof data === "object" ? JSON.stringify(data) : String(data);
    throw new Error(`Storage ${res.status}: ${msg.slice(0, 300)}`);
  }
  return data;
}

// 制御文字（改行やNULなど、目に見えないもの）が混ざっていないか。
// キーに入るとURLや一覧表示が壊れるので、名前・パスの両方で弾く。
function hasControlChar(str) {
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 32 || c === 127) return true;
  }
  return false;
}

// 保管庫の中のパスを安全な形に直す。
// 「..」やバックスラッシュ・制御文字は通さない（バケットの外や別の場所を触られないため）。
export function safePath(raw) {
  const s = String(raw ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (s === "") return "";
  const parts = s.split("/").filter((p) => p !== "");
  for (const p of parts) {
    if (p === "." || p === "..") throw new Error("不正なパスです");
    if (hasControlChar(p)) throw new Error("不正なパスです");
  }
  const out = parts.join("/");
  if (out.length > 900) throw new Error("パスが長すぎます");
  return out;
}

// フォルダ名・ファイル名。区切り文字は入れさせない。
export function safeName(raw) {
  const s = String(raw ?? "").trim();
  if (!s) throw new Error("名前を入力してください");
  if (/[/\\]/.test(s)) throw new Error("名前に / や \\ は使えません");
  if (s === "." || s === "..") throw new Error("その名前は使えません");
  if (hasControlChar(s)) throw new Error("名前に使えない文字が含まれています");
  if (s.length > 200) throw new Error("名前が長すぎます");
  return s;
}

export function joinPath(dir, name) {
  const d = safePath(dir);
  return d ? `${d}/${name}` : name;
}

// Supabase Storage のキーに使えるのは ASCII の限られた文字だけで、
// 日本語のフォルダ名・ファイル名はそのままでは弾かれる（InvalidKey）。
// そこで名前は1階層ずつ base64url に変えて保存し、画面に出すときに戻す。
// ※ここを通した後のキーは Supabase の管理画面では読めない形になる。
function encSeg(name) {
  return Buffer.from(name, "utf8").toString("base64url");
}
function decSeg(seg) {
  try {
    const back = Buffer.from(seg, "base64url").toString("utf8");
    // 戻して同じものに符号化できないものは、想定外のキーなのでそのまま出す
    return back && encSeg(back) === seg ? back : seg;
  } catch {
    return seg;
  }
}
// 画面上のパス（日本語のまま）→ 保管庫のキー
export function keyOf(path) {
  if (!path) return "";
  return path.split("/").map(encSeg).join("/");
}

const enc = (p) => p.split("/").map(encodeURIComponent).join("/");

// バケットが無ければ作る。作成は初回だけなので、成否をメモしておく。
let bucketReady = false;
export async function ensureBucket() {
  if (bucketReady) return;
  const list = await call("bucket");
  if (Array.isArray(list) && list.some((b) => b.id === BUCKET || b.name === BUCKET)) {
    bucketReady = true;
    return;
  }
  await call("bucket", {
    method: "POST",
    body: { id: BUCKET, name: BUCKET, public: false, file_size_limit: MAX_FILE_BYTES },
  });
  bucketReady = true;
}

// 1階層ぶんの中身。引数・戻り値はどちらも画面上の名前（日本語のまま）。
// フォルダは id が null で返ってくる。
export async function listDir(dir) {
  const prefix = keyOf(dir);
  const out = [];
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const page = await call(`object/list/${BUCKET}`, {
      method: "POST",
      body: {
        prefix: prefix ? `${prefix}/` : "",
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      },
    });
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    if (page.length < limit) break;
  }
  const folders = [];
  const files = [];
  let hasKeep = false;
  let keepAt = null; // 目印を置いた時刻＝そのフォルダを作った時刻
  for (const o of out) {
    if (!o?.name) continue;
    const name = decSeg(o.name);
    if (o.id == null) folders.push({ name, kind: "folder" });
    else if (name === KEEP) {
      hasKeep = true;
      keepAt = o.created_at || null;
    } else
      files.push({
        name,
        kind: "file",
        size: o.metadata?.size ?? null,
        mime: o.metadata?.mimetype || "",
        createdAt: o.created_at || null,
        updatedAt: o.updated_at || o.created_at || null,
      });
  }
  return { folders, files, hasKeep, keepAt };
}

// フォルダの中身をまとめた値（合計サイズ・作った時刻・最後に動いた時刻）。
// フォルダはストレージに実体が無く、そのままでは日付もサイズも出せないので、
// 中を数えて出す。数えるのは budget 回の読み取りまで（深いところは打ち切る）。
export async function folderStat(path, budget = { left: 40 }, depth = 0) {
  const out = { size: 0, files: 0, createdAt: null, updatedAt: null, partial: false };
  if (depth > 4 || budget.left <= 0) {
    out.partial = true;
    return out;
  }
  budget.left -= 1;
  const { folders, files, keepAt } = await listDir(path);
  out.createdAt = keepAt;
  const newer = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
  const older = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
  out.updatedAt = keepAt;
  for (const f of files) {
    out.size += f.size || 0;
    out.files += 1;
    out.updatedAt = newer(out.updatedAt, f.updatedAt);
    out.createdAt = older(out.createdAt, f.createdAt);
  }
  for (const d of folders) {
    const sub = await folderStat(`${path}/${d.name}`, budget, depth + 1);
    out.size += sub.size;
    out.files += sub.files;
    out.updatedAt = newer(out.updatedAt, sub.updatedAt);
    out.createdAt = older(out.createdAt, sub.createdAt);
    if (sub.partial) out.partial = true;
  }
  return out;
}

// dir 配下のファイルを全部たどる（フォルダの削除・名前変更に使う）。
// 返すのは画面上のパス。目印ファイルは listDir が一覧から隠すので、あった場合だけ足す。
export async function walkPaths(dir, depth = 0) {
  if (depth > 20) return []; // 念のための歯止め
  const { folders, files, hasKeep } = await listDir(dir);
  const base = dir ? `${dir}/` : "";
  let paths = files.map((f) => `${base}${f.name}`);
  if (hasKeep) paths.push(`${base}${KEEP}`);
  for (const d of folders) paths = paths.concat(await walkPaths(`${base}${d.name}`, depth + 1));
  return paths;
}

export async function upload(path, bytes, contentType) {
  await ensureBucket();
  return call(`object/${BUCKET}/${enc(keyOf(path))}`, {
    method: "POST",
    raw: bytes,
    contentType: contentType || "application/octet-stream",
  });
}

// アップロード用の一時URL。
// ファイルの中身はここを使ってブラウザから直接ストレージへ送る。
// 自前のAPIを経由させると、置いているサーバー（Vercel）の
// リクエスト本文の上限（約4.5MB）に引っかかって大きいファイルが送れないため。
// URLは1つのキーにだけ有効で、鍵そのものはブラウザに渡らない。
export async function signUploadUrl(path) {
  await ensureBucket();
  const r = await call(`object/upload/sign/${BUCKET}/${enc(keyOf(path))}`, { method: "POST" });
  const signed = r?.url || r?.signedURL || r?.signedUrl;
  if (!signed) throw new Error("アップロード用のURLを発行できませんでした");
  return `${URL_}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`;
}

export async function move(from, to) {
  return call("object/move", {
    method: "POST",
    body: { bucketId: BUCKET, sourceKey: keyOf(from), destinationKey: keyOf(to) },
  });
}

export async function remove(paths) {
  if (!paths.length) return null;
  return call(`object/${BUCKET}`, { method: "DELETE", body: { prefixes: paths.map(keyOf) } });
}

export async function exists(path) {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { folders, files } = await listDir(dir);
  return folders.some((f) => f.name === name) || files.some((f) => f.name === name);
}

// 署名付きURL。既定は60秒で切れる。download にファイル名を渡すと添付として落ちる。
export async function signUrl(path, { expiresIn = 60, download = null } = {}) {
  const r = await call(`object/sign/${BUCKET}/${enc(keyOf(path))}`, {
    method: "POST",
    body: { expiresIn },
  });
  const signed = r?.signedURL || r?.signedUrl;
  if (!signed) throw new Error("URLを発行できませんでした");
  const u = new URL(`${URL_}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`);
  if (download) u.searchParams.set("download", download);
  return u.toString();
}
