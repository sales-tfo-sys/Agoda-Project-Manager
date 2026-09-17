// CM情報フォームの回答を、施設一覧（Kintone）に反映する。
//
// 決めごと（利用者と合意した内容）
//   ・突き合わせは HID。空なら施設名（英語）で探す
//   ・Kintone 側が空の項目にだけ入れる（手で直した内容は消さない）
//   ・CM種別は Kintone の選択肢に無ければ入れず、その旨を残す
//   ・何をどう入れたかは記録に残し、あとから取り消し・付け替えができるようにする
//
// 記録の置き場所（テーブルは増やさない）
//   task_override(scope="cmimp",    key=<回答の見分け>)  … 1回答ぶんの結果
//   task_override(scope="cmimpcfg", key="cols")          … 列の対応（見出しが変わったとき用）
import { sb, supabaseConfigured } from "./supabase";

// フォームの回答 → Kintone のフィールド
export const TARGETS = {
  cm: { code: "ドロップダウン_2", label: "CM種別" },
  url: { code: "文字列__1行__6", label: "URL" },
  id: { code: "文字列__1行__7", label: "ID" },
  pw: { code: "文字列__1行__8", label: "PW" },
  contract: { code: "文字列__1行__9", label: "契約コード" },
};
export const HID_CODE = "文字列__1行_";
export const NAME_CODE = "文字列__1行__0"; // Hotel Name（英語）

// 見出しから列を探すときの手がかり。見つからなければ、下の既定の位置を使う。
const HINTS = {
  hid: [/HID/i],
  name: [/施設名.*英/, /ホテル名.*英/, /hotel\s*name/i, /英語/],
  cm: [/CM種別/, /CMS種別/, /サイトコントローラ/, /サイコン/],
  url: [/URL/i, /ログイン.*先/],
  id: [/^ID$/i, /ログインID/i, /ユーザー?ID/i],
  pw: [/^PW$/i, /パスワード/, /^PASS/i],
  contract: [/契約コード/],
};
// 既定の位置（1始まりの列番号。利用者の指定：6=CM種別 7=URL 8=ID 9=PW 10=契約コード）
const DEFAULT_COLS = { cm: 6, url: 7, id: 8, pw: 9, contract: 10 };

// 見出し行から列の対応を作る。cfg（保存した設定）があればそれを最優先にする。
export function resolveCols(headers, cfg) {
  const hs = (headers || []).map((h) => String(h || "").replace(/[\s　]/g, ""));
  const find = (key) => {
    const c = cfg?.[key];
    if (Number.isInteger(c) && c >= 0) return c; // 設定（0始まり）
    for (const re of HINTS[key] || []) {
      const i = hs.findIndex((h) => re.test(h));
      if (i >= 0) return i;
    }
    const d = DEFAULT_COLS[key];
    return d ? d - 1 : -1;
  };
  const out = {};
  for (const key of ["hid", "name", "cm", "url", "id", "pw", "contract"]) out[key] = find(key);
  return out;
}

// 回答1件を見分ける鍵。タイムスタンプ＋HID（どちらも空なら行番号）
export function answerKey(row, cols, index) {
  const ts = String(row?.[0] ?? "").trim();
  const hid = cols.hid >= 0 ? String(row[cols.hid] ?? "").trim() : "";
  const k = [ts, hid].filter(Boolean).join("|");
  return k || `#${index}`;
}

// 施設名の突き合わせ用に、記号と大文字小文字のゆれを吸収する
export function normName(v) {
  return String(v || "")
    .normalize("NFKC")
    .replace(/[\s　・,.'’"“”\-–—_()（）]/g, "")
    .toLowerCase();
}

// 保存してある結果を読む（key → data）
export async function readResults() {
  if (!supabaseConfigured()) return {};
  const rows = await sb("task_override?scope=eq.cmimp&select=key,data").catch(() => []);
  const out = {};
  for (const r of rows || []) out[r.key] = r.data || {};
  return out;
}

export async function writeResult(key, data) {
  if (!supabaseConfigured()) return false;
  await sb("task_override?on_conflict=scope,key", {
    method: "POST",
    body: [{ scope: "cmimp", key, data, updated_at: new Date().toISOString() }],
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  return true;
}

export async function readCfg() {
  if (!supabaseConfigured()) return null;
  const rows = await sb("task_override?scope=eq.cmimpcfg&key=eq.cols&select=data").catch(() => []);
  return rows?.[0]?.data || null;
}
