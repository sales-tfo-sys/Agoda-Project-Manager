// Google サービスアカウントで Sheets API を読み書きする（非公開シート対応）。
// 追加ライブラリは使わず、Node標準の crypto で JWT(RS256) を署名してトークン取得する。
//
// 使い方（サーバー側env）:
//   GOOGLE_SA_EMAIL       … サービスアカウントのメール（xxx@yyy.iam.gserviceaccount.com）
//   GOOGLE_SA_PRIVATE_KEY … サービスアカウントの秘密鍵（-----BEGIN...。改行は \n でもOK）
// 対象シートを、このメールに「閲覧者」で共有すれば読める（公開は不要）。
// サイトからシートに書き戻す場合は「編集者」で共有する。
import { createSign } from "node:crypto";

export function googleServiceConfigured() {
  return !!(process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY);
}

export function serviceAccountEmail() {
  return process.env.GOOGLE_SA_EMAIL || null;
}

const b64url = (s) =>
  Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlBuf = (buf) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let cachedToken = { token: null, exp: 0 };

async function getAccessToken() {
  if (cachedToken.token && Date.now() < cachedToken.exp - 60000) return cachedToken.token;
  const email = process.env.GOOGLE_SA_EMAIL;
  // 前後のクオートを外し、\n を実改行に戻す（Vercel等での貼り付けゆれに対応）
  let key = String(process.env.GOOGLE_SA_PRIVATE_KEY || "").trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: email,
      // 読み取りだけでなく、サイトで入力した値をシートに書き戻すので読み書きの権限を取る。
      // ただし実際に書けるのは「編集者」で共有されたシートだけ（共有していなければ403）。
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const sig = b64urlBuf(signer.sign(key));
  const jwt = `${header}.${claim}.${sig}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const j = await res.json();
  if (!j.access_token) {
    throw new Error(
      "Google認証に失敗しました（秘密鍵 GOOGLE_SA_PRIVATE_KEY の形式・改行をご確認ください）: " +
        (j.error_description || j.error || "unknown")
    );
  }
  cachedToken = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

// 読み取り上限（429）と一時的なサーバーエラー（5xx）は、少し待って数回だけやり直す。
// Sheets API の上限は「1分あたり」なので、待てば通ることが多い。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRY_WAIT = [600, 1500, 3000];
async function fetchRetry(url, init) {
  let res;
  for (let i = 0; i <= RETRY_WAIT.length; i++) {
    res = await fetch(url, init);
    if (res.status !== 429 && res.status < 500) return res;
    if (i === RETRY_WAIT.length) break;
    // Google が待ち時間を指定してきたらそれに従う（長すぎる指定は5秒で頭打ち）
    const ra = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 5000) : RETRY_WAIT[i]);
  }
  return res;
}

// 上限に当たったときのメッセージ。throw にするのは、
// これをキャッシュに残さず次のアクセスで取り直させるため。
const RATE_LIMIT_MSG =
  "Google スプレッドシートの読み取り上限に達しました。1分ほど待ってから、もう一度開いてください。";

// gid → シート名（タイトル）の対応。シート構成はめったに変わらないので
// しばらく覚えておき、1回の読み取りにつき Sheets API の呼び出しを1回減らす。
const titleCache = new Map(); // id -> { at, sheets }
const TITLE_TTL = 10 * 60 * 1000;

async function sheetTitles(id, auth) {
  const hit = titleCache.get(id);
  if (hit && Date.now() - hit.at < TITLE_TTL) return hit.sheets;
  const res = await fetchRetry(
    // gridProperties（行数・列数）は、書き込みが枠をはみ出していないかを見るのに使う
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties(sheetId,title,index,gridProperties)`,
    { headers: auth, cache: "no-store" }
  );
  if (!res.ok) {
    if (res.status === 429) throw new Error(RATE_LIMIT_MSG);
    if (res.status === 401) {
      return { error: "Google認証に失敗しました（秘密鍵 GOOGLE_SA_PRIVATE_KEY の形式をご確認ください）" };
    }
    if (res.status === 403) {
      return {
        error:
          "アクセスできません。対象シートをサービスアカウントに閲覧共有し、プロジェクトで Google Sheets API を有効化してください。",
      };
    }
    if (res.status === 404) return { error: "シートが見つかりません（URLをご確認ください）" };
    // 5xx はキャッシュに残さず次で取り直す
    throw new Error(`Sheets API エラー(${res.status})`);
  }
  const meta = await res.json();
  const sheets = meta.sheets || [];
  titleCache.set(id, { at: Date.now(), sheets });
  if (titleCache.size > 200) titleCache.clear();
  return sheets;
}

// 指定タブ（gid）の全セルを2次元配列で返す。403等は分かりやすいエラーにする。
export async function readGridApi(id, gid) {
  const token = await getAccessToken();
  const auth = { Authorization: `Bearer ${token}` };

  const sheets = await sheetTitles(id, auth);
  if (sheets?.error) return sheets;
  let title = null;
  if (gid != null) {
    const s = sheets.find((x) => String(x.properties?.sheetId) === String(gid));
    title = s?.properties?.title;
  }
  if (!title) title = sheets[0]?.properties?.title;
  if (!title) return { grid: [] };

  const range = encodeURIComponent(title);
  const vr = await fetchRetry(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?majorDimension=ROWS`,
    { headers: auth, cache: "no-store" }
  );
  if (!vr.ok) {
    if (vr.status === 429) throw new Error(RATE_LIMIT_MSG);
    if (vr.status === 403) {
      return { error: "このシートはサービスアカウントに共有されていません（閲覧者で共有してください）" };
    }
    // タブ名が変わった等でキャッシュが古い可能性があるので、次回は引き直す
    if (vr.status === 400 || vr.status === 404) titleCache.delete(id);
    throw new Error(`Sheets API ${vr.status}`);
  }
  const j = await vr.json();
  return { grid: j.values || [] };
}

// 番号 → 列文字（1=A, 26=Z, 27=AA …）
function numToCol(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * 指定タブ（gid）のセルを書き換える。
 * cells: [{ row, col, value }] … row/col は0始まりの「シート上の位置」、value は文字列
 * 返り値: { ok: true } か { error: "..." }
 *
 * 値は USER_ENTERED で送るので、日付は日付として、TRUE/FALSE はチェックとして入る。
 */
export async function writeCellsApi(id, gid, cells) {
  if (!cells || !cells.length) return { ok: true };
  const token = await getAccessToken();
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // 書き込み先のタブを決める。あわせて、そのタブの大きさ（行数・列数）も見る。
  const pickSheet = async () => {
    const sheets = await sheetTitles(id, auth);
    if (sheets?.error) return sheets;
    let s = null;
    if (gid != null) s = sheets.find((x) => String(x.properties?.sheetId) === String(gid));
    if (!s) s = sheets[0];
    const p = s?.properties;
    if (!p?.title) return { error: "書き込み先のタブが見つかりません" };
    return { title: p.title, grid: p.gridProperties || null };
  };

  const send = async (title) => {
    // タブ名に ' が入っていてもよいように、A1 表記では '' に置き換える
    const t = `'${String(title).replace(/'/g, "''")}'`;
    const data = cells.map((c) => ({
      range: `${t}!${numToCol(c.col + 1)}${c.row + 1}`,
      values: [[c.value == null ? "" : String(c.value)]],
    }));
    return fetchRetry(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
      method: "POST",
      headers: auth,
      cache: "no-store",
      body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
    });
  };

  let picked = await pickSheet();
  if (picked.error) return picked;

  // シートの枠（行数・列数）をはみ出していないか先に確かめる。
  // はみ出したまま送ると Google からは 400 しか返らず、理由が分からないため。
  const gp = picked.grid;
  if (gp?.rowCount != null || gp?.columnCount != null) {
    const over = cells.find(
      (c) =>
        (gp.rowCount != null && c.row + 1 > gp.rowCount) ||
        (gp.columnCount != null && c.col + 1 > gp.columnCount)
    );
    if (over) {
      return {
        error: `シートの範囲外に書き込もうとしました（${numToCol(over.col + 1)}${over.row + 1}／このタブは ${gp.rowCount}行 × ${gp.columnCount}列）。画面を開き直してからお試しください。`,
      };
    }
  }

  let res = await send(picked.title);

  // 400/404 はタブ名が変わっている（覚えている名前が古い）ことがあるので、
  // 覚えていた名前を捨てて引き直し、1回だけやり直す。
  if ((res.status === 400 || res.status === 404) && titleCache.has(id)) {
    titleCache.delete(id);
    const again = await pickSheet();
    if (!again.error && again.title !== picked.title) {
      picked = again;
      res = await send(picked.title);
    }
  }

  if (!res.ok) {
    if (res.status === 429) return { error: RATE_LIMIT_MSG };
    if (res.status === 403) {
      return {
        error:
          "シートに書き込めません。対象シートをサービスアカウントに「編集者」で共有してください（いまは閲覧のみです）。",
      };
    }
    if (res.status === 401) {
      return { error: "Google認証に失敗しました（秘密鍵 GOOGLE_SA_PRIVATE_KEY の形式をご確認ください）" };
    }
    titleCache.delete(id);
    // Google が返した理由をそのまま添える（原因が分からないと直しようがないため）
    let why = "";
    try {
      const j = await res.json();
      why = j?.error?.message || "";
    } catch {
      why = "";
    }
    // よくある原因は日本語で言い換える。保護は「共有」ではなく範囲ごとの設定なので、
    // 閲覧・編集の共有ができていても書けないことがある。
    if (/protected/i.test(why)) {
      const who = serviceAccountEmail();
      return {
        error:
          "シートのセルが保護されているため書き込めません。スプレッドシートで［データ］→［シートと範囲を保護］を開き、その範囲の編集できる人に " +
          (who || "サービスアカウント") +
          " を追加してください（または保護を外してください）。",
      };
    }
    return {
      error: `シートに書き込めません（Sheets API ${res.status}）${why ? "：" + why : ""}`,
    };
  }
  return { ok: true };
}
