// 日本の祝日をコードで算出する（外部シート・外部APIに依存しない）。
// 2020年以降の現行法（天皇誕生日2/23・スポーツの日・山の日）に準拠。
// 春分/秋分は 1980〜2099 年で有効な近似式を使用。

function nthMonday(year, month, nth) {
  // その月の第 nth 月曜日の「日」を返す
  const first = new Date(Date.UTC(year, month - 1, 1));
  const dow = first.getUTCDay(); // 0=日, 1=月
  const offset = (1 - dow + 7) % 7;
  return 1 + offset + (nth - 1) * 7;
}

function vernalEquinoxDay(y) {
  return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}
function autumnalEquinoxDay(y) {
  return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}

const key = (m, d) => `${m}-${d}`;

/**
 * 指定年の祝日を { "M-D": 名称 } で返す（振替休日・国民の休日を含む）
 */
export function holidaysForYear(year) {
  const base = new Map();
  const add = (m, d, name) => base.set(key(m, d), name);

  add(1, 1, "元日");
  add(1, nthMonday(year, 1, 2), "成人の日");
  add(2, 11, "建国記念の日");
  add(2, 23, "天皇誕生日");
  add(3, vernalEquinoxDay(year), "春分の日");
  add(4, 29, "昭和の日");
  add(5, 3, "憲法記念日");
  add(5, 4, "みどりの日");
  add(5, 5, "こどもの日");
  add(7, nthMonday(year, 7, 3), "海の日");
  add(8, 11, "山の日");
  add(9, nthMonday(year, 9, 3), "敬老の日");
  add(9, autumnalEquinoxDay(year), "秋分の日");
  add(10, nthMonday(year, 10, 2), "スポーツの日");
  add(11, 3, "文化の日");
  add(11, 23, "勤労感謝の日");

  const result = new Map(base);
  const isBase = (dt) => base.has(key(dt.getUTCMonth() + 1, dt.getUTCDate()));
  const day = (m, d) => new Date(Date.UTC(year, m - 1, d));
  const shift = (dt, n) => new Date(dt.getTime() + n * 86400000);

  // 国民の休日：祝日に挟まれた平日（例：敬老の日と秋分の日の間）
  for (const k of base.keys()) {
    const [m, d] = k.split("-").map(Number);
    const mid = shift(day(m, d), 1);
    const after = shift(day(m, d), 2);
    if (mid.getUTCFullYear() !== year) continue;
    if (!isBase(mid) && isBase(after) && mid.getUTCDay() !== 0) {
      result.set(key(mid.getUTCMonth() + 1, mid.getUTCDate()), "国民の休日");
    }
  }

  // 振替休日：日曜が祝日なら、次の「祝日でない日」を振替休日にする
  for (const k of base.keys()) {
    const [m, d] = k.split("-").map(Number);
    const dt = day(m, d);
    if (dt.getUTCDay() !== 0) continue;
    let next = shift(dt, 1);
    while (result.has(key(next.getUTCMonth() + 1, next.getUTCDate()))) {
      next = shift(next, 1);
    }
    if (next.getUTCFullYear() === year) {
      result.set(key(next.getUTCMonth() + 1, next.getUTCDate()), "振替休日");
    }
  }

  return result;
}

const cache = new Map();
function yearMap(year) {
  if (!cache.has(year)) cache.set(year, holidaysForYear(year));
  return cache.get(year);
}

/** 祝日名を返す（祝日でなければ null） */
export function holidayName(year, month, dayOfMonth) {
  return yearMap(year).get(key(month, dayOfMonth)) || null;
}

const DOW = ["日", "月", "火", "水", "木", "金", "土"];
/** 曜日（"月" など） */
export function dowLabel(year, month, dayOfMonth) {
  return DOW[new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay()];
}
