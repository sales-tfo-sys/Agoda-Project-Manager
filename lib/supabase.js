// Supabase REST（PostgREST）への薄いラッパー。
// SDK は使わず fetch のみ。サーバー側APIルートからのみ呼ぶ（キーは never client）。

const URL = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

export function supabaseConfigured() {
  return Boolean(URL && KEY);
}

// path 例: "kosu_task?active=eq.true&order=sort_order"
export async function sb(path, { method = "GET", body, prefer } = {}) {
  if (!supabaseConfigured()) throw new Error("Supabase 未設定");
  const headers = {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
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
    throw new Error(`Supabase ${res.status}: ${msg.slice(0, 300)}`);
  }
  return data;
}

// PostgREST は1リクエスト最大1000件で打ち切るため、offset で全件を取り切る。
// path には安定した並び（order=...）を含めること（ページ境界での重複/欠落を防ぐ）。
export async function sbAll(path, { pageSize = 1000 } = {}) {
  const sep = path.includes("?") ? "&" : "?";
  let out = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await sb(`${path}${sep}limit=${pageSize}&offset=${offset}`);
    if (!Array.isArray(page) || page.length === 0) break;
    out = out.concat(page);
    if (page.length < pageSize) break;
  }
  return out;
}
