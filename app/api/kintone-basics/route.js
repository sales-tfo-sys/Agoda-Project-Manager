import { NextResponse } from "next/server";
import { cached } from "@/lib/cache";
import { supabaseConfigured } from "@/lib/supabase";
import { readSnapshot } from "@/lib/kintoneSnapshot";

export const dynamic = "force-dynamic";

// 作業依頼の一覧に Kintone の内容をそのまま出すための、軽い一覧。
// 案件データ全体（約9MB）を画面に送ると重いので、必要な項目だけを
// レコードNo と HID で引ける形にして返す。
//
// key は画面側で使う項目名。値は Kintone のフィールドコード。
const FIELDS = {
  ステータス: "ドロップダウン",
  CM種別: "ドロップダウン_2",
  CM設定: "ドロップダウン_4",
  URL: "文字列__1行__6",
  ID: "文字列__1行__7",
  PW: "文字列__1行__8",
  契約コード: "文字列__1行__9",
  Stage変更日: "日付",
  CM情報受領日: "日付_2",
  YCS完了メール: "日付_8",
  掲載開始: "日付_6",
  DSA: "ドロップダウン_11",
  滞留理由: "文字列__複数行__1",
  いつまでに: "日付_3",
  誰が: "ドロップダウン_7",
  なにをする: "文字列__複数行__4",
  Hotel: "文字列__1行__0",
};
const HID_CODE = "文字列__1行_";

// Kintone の値（{type,value}）を、画面にそのまま出せる文字列にする。
// 日付は施設一覧と同じ YYYY/MM/DD にそろえる。
function textOf(field) {
  if (!field) return "";
  const v = field.value;
  if (v == null || v === "") return "";
  if (field.type === "DATE") return String(v).replaceAll("-", "/");
  if (field.type === "DATETIME" || field.type === "CREATED_TIME" || field.type === "UPDATED_TIME") {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
  }
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === "object" && v[0] !== null) {
      return "name" in v[0] ? v.map((x) => x.name).join(", ") : `（${v.length}件）`;
    }
    return v.join(", ");
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

async function build() {
  const snap = await readSnapshot();
  const records = snap?.data?.records || [];
  const byId = {};
  const byHid = {};
  for (const r of records) {
    const row = {};
    for (const [name, code] of Object.entries(FIELDS)) {
      const t = textOf(r[code]);
      if (t) row[name] = t;
    }
    const id = r.$id?.value ? String(r.$id.value) : null;
    if (id) byId[id] = row;
    const hid = String(r[HID_CODE]?.value ?? "").trim();
    // 同じ HID が複数あるときは、レコード番号の大きい方（新しい方）を残す
    if (hid) {
      const cur = byHid[hid];
      if (!cur || Number(id) >= Number(cur.__id || 0)) byHid[hid] = { ...row, __id: id };
    }
  }
  for (const k of Object.keys(byHid)) delete byHid[k].__id;
  return { names: Object.keys(FIELDS), byId, byHid, fetchedAt: snap?.fetchedAt || null };
}

// 取り出しと圧縮解除が重いので、少しのあいだためておく
const load = () => cached("kintone:basics", 3 * 60 * 1000, build);

export async function GET() {
  if (!supabaseConfigured()) return NextResponse.json({ byId: {}, byHid: {} });
  try {
    return NextResponse.json(await load());
  } catch (e) {
    return NextResponse.json({ byId: {}, byHid: {}, error: String(e?.message || e) });
  }
}

// 画面が必要とする行だけを返す（全件を送ると1MBほどになるため）。
//   body: { ids: ["3663", …], hids: ["96273929", …] }
export async function POST(req) {
  if (!supabaseConfigured()) return NextResponse.json({ byId: {}, byHid: {} });
  try {
    const b = await req.json().catch(() => ({}));
    const all = await load();
    const pick = (src, keys) => {
      const out = {};
      for (const k of Array.isArray(keys) ? keys.slice(0, 5000) : []) {
        const key = String(k ?? "").trim();
        if (key && src[key]) out[key] = src[key];
      }
      return out;
    };
    return NextResponse.json({
      names: all.names,
      byId: pick(all.byId, b?.ids),
      byHid: pick(all.byHid, b?.hids),
      fetchedAt: all.fetchedAt,
    });
  } catch (e) {
    return NextResponse.json({ byId: {}, byHid: {}, error: String(e?.message || e) });
  }
}
