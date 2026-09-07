// Google ドライブへの書き込み（作業シートのアップロード・フォルダ間の移動）。
//
// 置き場所が「共有ドライブ」ではなく個人のマイドライブなので、
// サービスアカウントのままでは保存容量が無くファイル作成に失敗する
// （storageQuotaExceeded）。そのため Google Workspace の
// 「ドメイン全体の委任」で実在ユーザー（GOOGLE_DRIVE_USER）になりすまして操作する。
// 作成したファイルはそのユーザーの所有になり、普段どおりドライブに並ぶ。
//
// 必要な環境変数:
//   GOOGLE_SA_EMAIL        … サービスアカウントのメール
//   GOOGLE_SA_PRIVATE_KEY  … サービスアカウントの秘密鍵
//   GOOGLE_DRIVE_USER      … 代理するユーザーのメール（フォルダの持ち主）
//   GOOGLE_DRIVE_FOLDER_NEW / _DONE / _HOLD … 各フォルダID（未設定なら既定値）
import { createSign } from "node:crypto";

const SCOPE = "https://www.googleapis.com/auth/drive";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

// 運用中のフォルダ（アップ先／完了／保留）
export const DRIVE_FOLDERS = {
  new: process.env.GOOGLE_DRIVE_FOLDER_NEW || "1KFnrcBpPbilgC20wOFlRm-yOpq-tfIha",
  done: process.env.GOOGLE_DRIVE_FOLDER_DONE || "1ZN1KOn5Ob2jT3dZm5wf_S5-WrvsbS2mm",
  hold: process.env.GOOGLE_DRIVE_FOLDER_HOLD || "1Qi8GMVPSywyle1rr1UftHLicSxZry2g7",
};
export const FOLDER_LABEL = { new: "アップ先", done: "完了", hold: "保留" };

export function driveConfigured() {
  return !!(
    process.env.GOOGLE_SA_EMAIL &&
    process.env.GOOGLE_SA_PRIVATE_KEY &&
    process.env.GOOGLE_DRIVE_USER
  );
}
export function driveUser() {
  return process.env.GOOGLE_DRIVE_USER || null;
}

/** スプレッドシート／ドライブのURLからファイルIDを取り出す */
export function fileIdFromUrl(url) {
  const s = String(url || "");
  const m =
    s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) ||
    s.match(/\/file\/d\/([a-zA-Z0-9-_]+)/) ||
    s.match(/[?&]id=([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

const b64url = (s) =>
  Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlBuf = (buf) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let cachedToken = { token: null, exp: 0 };

// 代理ユーザー（sub）付きでアクセストークンを取る
async function getToken() {
  if (cachedToken.token && Date.now() < cachedToken.exp - 60000) return cachedToken.token;
  const email = process.env.GOOGLE_SA_EMAIL;
  const sub = process.env.GOOGLE_DRIVE_USER;
  // 前後のクオートを外し、\n を実改行に戻す（Vercel等での貼り付けゆれに対応）
  let key = String(process.env.GOOGLE_SA_PRIVATE_KEY || "").trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, "\n");

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: email,
      sub, // ← ドメイン全体の委任。これが無いと容量不足で書き込めない
      scope: SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${b64urlBuf(signer.sign(key))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
    cache: "no-store",
  });
  const j = await res.json();
  if (!j.access_token) {
    const d = j.error_description || j.error || "unknown";
    // よくある原因を日本語で添える（設定漏れを追いやすくするため）
    const hint = /unauthorized_client/i.test(String(d))
      ? "（管理コンソールの「ドメイン全体の委任」にクライアントIDとスコープ https://www.googleapis.com/auth/drive が登録されているかご確認ください）"
      : /invalid_grant/i.test(String(d))
      ? "（GOOGLE_DRIVE_USER のメールアドレス、または秘密鍵をご確認ください）"
      : "";
    throw new Error(`Google の認可に失敗しました: ${d}${hint}`);
  }
  cachedToken = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

async function driveFetch(path, init = {}) {
  const token = await getToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
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
    const msg = data?.error?.message || (typeof data === "string" ? data : JSON.stringify(data));
    throw new Error(`Drive ${res.status}: ${String(msg).slice(0, 300)}`);
  }
  return data;
}

/**
 * Excel などをアップロードして Google スプレッドシートに変換し、指定フォルダに置く。
 * 返り値: { id, name, url }
 */
export async function uploadAsSpreadsheet({ name, bytes, mimeType, folderKey = "new" }) {
  const parent = DRIVE_FOLDERS[folderKey] || DRIVE_FOLDERS.new;
  const meta = {
    name,
    parents: [parent],
    mimeType: SHEET_MIME, // ← 変換先を指定するとアップロード時にスプレッドシート化される
  };
  const boundary = "agoda" + Math.random().toString(36).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
      meta
    )}\r\n--${boundary}\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([head, Buffer.from(bytes), tail]);

  const token = await getToken();
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
      cache: "no-store",
    }
  );
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = data?.error?.message || String(data);
    const hint = /storage quota/i.test(String(msg))
      ? "（サービスアカウント自身の容量で作成しようとしています。GOOGLE_DRIVE_USER とドメイン全体の委任の設定をご確認ください）"
      : /File not found/i.test(String(msg))
      ? "（アップ先フォルダが見つかりません。フォルダIDと、代理ユーザーがそのフォルダを編集できるかをご確認ください）"
      : "";
    throw new Error(`アップロードに失敗しました: ${String(msg).slice(0, 300)}${hint}`);
  }
  return {
    id: data.id,
    name: data.name,
    url: `https://docs.google.com/spreadsheets/d/${data.id}/edit`,
  };
}

/** ファイルを別フォルダへ移す（元の親から外して付け替える） */
export async function moveToFolder(fileId, folderKey) {
  const to = DRIVE_FOLDERS[folderKey];
  if (!to) throw new Error("移動先のフォルダが不正です");
  const cur = await driveFetch(
    `files/${encodeURIComponent(fileId)}?fields=parents,name&supportsAllDrives=true`
  );
  const parents = (cur.parents || []).join(",");
  const q =
    `files/${encodeURIComponent(fileId)}?addParents=${encodeURIComponent(to)}` +
    (parents ? `&removeParents=${encodeURIComponent(parents)}` : "") +
    `&supportsAllDrives=true&fields=id,name,parents`;
  const out = await driveFetch(q, { method: "PATCH" });
  return { id: out.id, name: out.name, folder: folderKey };
}
