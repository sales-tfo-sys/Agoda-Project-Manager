// Kintone REST API からレコードを取得するヘルパー。
// トークンなどの機密はすべて環境変数から読み込み、サーバー側だけで使う。

const SUBDOMAIN = process.env.KINTONE_SUBDOMAIN;
const APP_ID = process.env.KINTONE_APP_ID;
const API_TOKEN = process.env.KINTONE_API_TOKEN;
const DOMAIN = process.env.KINTONE_DOMAIN || "cybozu.com";

// 接続に必要な環境変数がすべて揃っているか
export function kintoneConfigured() {
  return Boolean(SUBDOMAIN && APP_ID && API_TOKEN);
}

// アプリのフィールド定義（ラベル・並び順）を取得。失敗しても致命的ではない。
export async function fetchFields() {
  const url = `https://${SUBDOMAIN}.${DOMAIN}/k/v1/app/form/fields.json?app=${APP_ID}`;
  const res = await fetch(url, {
    headers: { "X-Cybozu-API-Token": API_TOKEN },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.properties || null;
}

// 全レコードを取得（500件ずつページング）。案件数が多くない前提の実装。
export async function fetchAllRecords() {
  const base = `https://${SUBDOMAIN}.${DOMAIN}/k/v1/records.json`;
  const limit = 500;
  let offset = 0;
  const all = [];

  // 安全のため最大 20,000 件（40ページ）まで
  for (let page = 0; page < 40; page++) {
    const query = encodeURIComponent(`limit ${limit} offset ${offset}`);
    const url = `${base}?app=${APP_ID}&query=${query}`;
    const res = await fetch(url, {
      headers: { "X-Cybozu-API-Token": API_TOKEN },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Kintone API エラー (${res.status}): ${text}`);
    }

    const data = await res.json();
    all.push(...data.records);

    if (data.records.length < limit) break; // 最終ページ
    offset += limit;
  }

  return all;
}
