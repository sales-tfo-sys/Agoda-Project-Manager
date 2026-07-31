import { cached } from "../../../lib/cache";
import { holidayName, dowLabel } from "../../../lib/holidays";

// 作業工数管理シート（Google スプレッドシート）を CSV で取得して整形する API。
// リンク共有で公開されているため認証不要（gviz CSV エンドポイント）。
const SHEET_ID =
  process.env.KOSU_SHEET_ID || "1mXUySyokFhE0fjjmSIjmpF2VNKGWZCzEkuwccK9UPwY";
const GID = process.env.KOSU_GID || "1039908240";

export const revalidate = 300; // 5分キャッシュ

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\n") {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      } else if (c === "\r") {
        // skip
      } else cur += c;
    }
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

// 日付ラベル（"12/8" 形式・昇順）に西暦を割り当てる。
// 末尾を当年とみなし、さかのぼって月が増える箇所で年をまたぐ。
function assignYears(dates) {
  const parsed = dates.map((d) => {
    const m = String(d).match(/^(\d{1,2})\s*\/\s*(\d{1,2})/);
    return m ? { m: Number(m[1]), d: Number(m[2]) } : null;
  });
  const years = new Array(parsed.length).fill(null);
  let y = new Date().getFullYear();
  for (let i = parsed.length - 1; i >= 0; i--) {
    if (!parsed[i]) continue;
    const next = parsed[i + 1];
    if (next && parsed[i].m > next.m) y -= 1;
    years[i] = y;
  }
  return parsed.map((p, i) => (p ? { y: years[i], m: p.m, d: p.d } : null));
}

function buildData(text) {
  const g = parseCSV(text);
  if (!g.length) return { months: [], rows: [], persons: [] };
  const header = g[0];

  // 日付列（6列目以降・非空セルが日付、その次の列はスペーサ）
  const dateCols = [];
  for (let c = 6; c < header.length; c++) {
    const label = (header[c] || "").trim();
    if (label) dateCols.push({ c, label });
  }

  // 出現順の月バケット（"12月","1月"…）＋各日付列→月indexの対応
  const months = [];
  const colMonthIdx = [];
  for (const dc of dateCols) {
    const m = parseInt(String(dc.label).split("/")[0], 10);
    const mLabel = Number.isFinite(m) ? `${m}月` : dc.label;
    let idx = months.length - 1;
    if (idx < 0 || months[idx] !== mLabel) {
      months.push(mLabel);
      idx = months.length - 1;
    }
    colMonthIdx.push(idx);
  }

  // データ行：タスク種別・作業詳細を下方向に補完
  let curType = "";
  let curDetail = "";
  const rows = [];
  const persons = [];
  for (let r = 1; r < g.length; r++) {
    const row = g[r];
    if (!row) continue;
    const type = (row[1] || "").trim();
    const detail = (row[2] || "").trim();
    const tanto = (row[5] || "").trim();
    if (type) curType = type;
    if (detail) curDetail = detail;
    if (!tanto && !detail && !type) continue; // 空行スキップ
    if (tanto && !persons.includes(tanto)) persons.push(tanto);

    const monthly = new Array(months.length).fill(0);
    const daily = new Array(dateCols.length).fill(0);
    let total = 0;
    dateCols.forEach((dc, di) => {
      const v = row[dc.c];
      if (v === "" || v == null) return;
      const n = Number(v);
      if (!Number.isFinite(n)) return;
      daily[di] = Math.round(n * 10) / 10;
      monthly[colMonthIdx[di]] += n;
      total += n;
    });

    // 作業時間・トータル作業時間は「時間系」、それ以外は「件数系」
    const isTime = /作業時間/.test(curDetail);
    rows.push({
      type: curType,
      detail: curDetail,
      tanto,
      total: Math.round(total * 10) / 10,
      monthly: monthly.map((v) => Math.round(v * 10) / 10),
      daily,
      unit: isTime ? "time" : "count",
    });
  }

  return {
    months,
    // 日次の列（ラベルと、それぞれが属する月のindex）
    dates: dateCols.map((d) => d.label),
    dateMonthIdx: colMonthIdx,
    rows,
    persons,
  };
}

export async function GET(req) {
  // ?list=1 で作業内容の一覧だけを返す（日次データを含めない軽量版）
  const listOnly = new URL(req.url).searchParams.get("list") === "1";
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`;
  try {
    const text = await cached("sheet:kosu", 3 * 60 * 1000, async () => {
      const res = await fetch(url, { next: { revalidate: 300 } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    });
    if (text.trimStart().startsWith("<")) {
      return Response.json(
        { error: "シートが公開されていません（リンク共有をご確認ください）" },
        { status: 200 }
      );
    }
    const data = buildData(text);

    if (listOnly) {
      // 作業内容は担当者ごとに行が分かれているため重複を除く
      const seen = new Set();
      const contents = [];
      for (const r of data.rows) {
        if (!r.detail || seen.has(r.detail)) continue;
        seen.add(r.detail);
        contents.push({ type: r.type, detail: r.detail });
      }
      return Response.json({ contents });
    }

    // 祝日・曜日はコードで算出（シートに依存しない）
    const ymd = assignYears(data.dates);
    const holidayOf = ymd.map((p) => (p ? holidayName(p.y, p.m, p.d) : null));
    const dowOf = ymd.map((p) => (p ? dowLabel(p.y, p.m, p.d) : null));
    // Supabase の入力値（entry_date）と日付列を突き合わせるための ISO 日付
    const isoDates = ymd.map((p) =>
      p ? `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}` : null
    );

    return Response.json({ ...data, holidayOf, dowOf, isoDates, source: "google-sheet" });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
