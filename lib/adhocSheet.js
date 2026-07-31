// 「進捗 (Regular・Ad hoc)」シートの ◆Ad Hoc Task 表を読むためのパーサ。
// Supabase へ取り込む処理（/api/adhoc-import）と、未取込時のフォールバック
// （/api/adhoc）の両方から使う。
const SHEET_ID =
  process.env.KOSU_SHEET_ID || "1mXUySyokFhE0fjjmSIjmpF2VNKGWZCzEkuwccK9UPwY";
const GID = process.env.ADHOC_GID || "111345294";

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

const val = (row, i) => (i == null ? "" : String(row?.[i] ?? "").trim());

// CSV テキスト → Ad Hoc タスク配列
export function parseAdhocCsv(text) {
  const g = parseCSV(text);

  // ◆ Ad Hoc Task の見出し位置を探す
  let secIdx = -1;
  for (let i = 0; i < g.length; i++) {
    if ((g[i] || []).some((c) => String(c).includes("Ad Hoc Task"))) {
      secIdx = i;
      break;
    }
  }
  if (secIdx < 0) return [];

  const header = g[secIdx + 1] || [];
  const col = (label) => {
    const i = header.findIndex((c) => String(c).trim() === label);
    return i >= 0 ? i : null;
  };
  const cTask = col("タスク");
  const cReq = col("依頼者");
  const cCat1 = col("大カテゴリ");
  const cCat2 = col("小カテゴリ");
  const cChain = col("Chain");
  const cStatus = col("進捗");
  const cEffort = col("実作業工数");
  const cIssue = col("課題・遅延理由");
  const cNext = col("次回アクション");
  const cPic = col("対応者");
  const cMemo = col("メモ");

  // ラベルの無い数値ブロック（Chain の右側から順に並ぶ）
  const base = cChain != null ? cChain : 23;
  const cStart = base + 1; // 開始
  const cEnd = base + 5; // 期日
  const cTotal = base + 9; // 受注数
  const cDone = base + 12; // 完了数
  const cRest = base + 15; // 残件数
  const cPct = base + 18; // 進捗率
  const cDaily = base + 27; // 目標対応件数（Daily）
  const cPeople = base + 49; // 対応人数
  const cNo = 1; // シート上の作業優先順（#）

  const tasks = [];
  for (let i = secIdx + 2; i < g.length; i++) {
    const r = g[i] || [];
    const name = val(r, cTask);
    if (!name) continue;
    const num = (i2) => {
      const n = Number(String(val(r, i2)).replace(/,/g, ""));
      return Number.isFinite(n) ? n : null;
    };
    tasks.push({
      no: num(cNo),
      task: name,
      requester: val(r, cReq),
      cat1: val(r, cCat1),
      cat2: val(r, cCat2),
      chain: val(r, cChain),
      start: val(r, cStart),
      end: val(r, cEnd),
      total: num(cTotal),
      done: num(cDone),
      rest: num(cRest),
      pct: val(r, cPct),
      daily: num(cDaily),
      people: num(cPeople),
      status: val(r, cStatus),
      effort: val(r, cEffort),
      issue: val(r, cIssue),
      next: val(r, cNext),
      pic: val(r, cPic),
      memo: val(r, cMemo),
    });
  }
  return tasks;
}

// シートから取得して Ad Hoc タスク配列を返す（未公開なら例外）。
export async function fetchAdhocFromSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error("シートが公開されていません（リンク共有をご確認ください）");
  }
  return parseAdhocCsv(text);
}
