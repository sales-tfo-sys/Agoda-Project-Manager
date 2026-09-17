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

// レコードを1件取得する（更新した直後に、入った値を読み直すのに使う）。
export async function fetchRecord(recordId) {
  const url = `https://${SUBDOMAIN}.${DOMAIN}/k/v1/record.json?app=${APP_ID}&id=${encodeURIComponent(recordId)}`;
  const res = await fetch(url, {
    headers: { "X-Cybozu-API-Token": API_TOKEN },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Kintone レコードの取得に失敗しました (${res.status})`);
  const j = await res.json();
  return j.record || null;
}

/**
 * レコードの項目を書き換える。
 *   values … { フィールドコード: 文字列 }
 *   revision … 画面が見ていた版。ほかの人が先に直していたら弾かれる（上書き事故を防ぐ）
 * 返り値: { revision }
 */
export async function updateRecord(recordId, values, revision) {
  const record = {};
  for (const [code, v] of Object.entries(values || {})) {
    record[code] = { value: v == null ? "" : String(v) };
  }
  const body = { app: Number(APP_ID), id: Number(recordId), record };
  if (revision) body.revision = String(revision);

  const res = await fetch(`https://${SUBDOMAIN}.${DOMAIN}/k/v1/record.json`, {
    method: "PUT",
    headers: { "X-Cybozu-API-Token": API_TOKEN, "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    let msg = t;
    try {
      const j = JSON.parse(t);
      msg = j?.message || t;
      // 版が合わない＝ほかの人が先に更新している
      if (j?.code === "GAIA_CO02" || res.status === 409) {
        throw new Error(
          "ほかの方が先にこのレコードを更新しています。画面を開き直してから、もう一度お試しください。"
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("ほかの方が")) throw e;
    }
    if (res.status === 403) {
      throw new Error("Kintone に書き込む権限がありません（APIトークンのアクセス権をご確認ください）");
    }
    throw new Error(`Kintone の更新に失敗しました (${res.status}): ${String(msg).slice(0, 300)}`);
  }
  const j = await res.json();
  return { revision: j.revision };
}

/**
 * レコードをまとめて更新する（1回に100件まで）。
 * list: [{ id, values: { フィールドコード: 文字列 } }]
 * 返り値: { revisions: [{id, revision}] }
 * ※途中で失敗すると、その回のぶんは反映されない（Kintone の一括更新は全件まとめて扱われる）
 */
export async function updateRecords(list) {
  const out = [];
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100).map((x) => ({
      id: Number(x.id),
      record: Object.fromEntries(
        Object.entries(x.values || {}).map(([code, v]) => [code, { value: v == null ? "" : String(v) }])
      ),
    }));
    const res = await fetch(`https://${SUBDOMAIN}.${DOMAIN}/k/v1/records.json`, {
      method: "PUT",
      headers: { "X-Cybozu-API-Token": API_TOKEN, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ app: Number(APP_ID), records: chunk }),
    });
    if (!res.ok) {
      const t = await res.text();
      let msg = t;
      try {
        msg = JSON.parse(t)?.message || t;
      } catch {}
      if (res.status === 403) throw new Error("Kintone に書き込む権限がありません（APIトークンのアクセス権）");
      throw new Error(`Kintone の一括更新に失敗しました (${res.status}): ${String(msg).slice(0, 300)}`);
    }
    const j = await res.json();
    out.push(...(j.records || []));
  }
  return { revisions: out };
}

// 指定したレコード番号のレコードをまとめて取り直す（更新後の値をスナップショットに入れるため）
export async function fetchRecordsByIds(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100).map((x) => `"${String(x).replace(/"/g, "")}"`);
    const query = encodeURIComponent(`$id in (${chunk.join(",")}) limit 100`);
    const res = await fetch(
      `https://${SUBDOMAIN}.${DOMAIN}/k/v1/records.json?app=${APP_ID}&query=${query}`,
      { headers: { "X-Cybozu-API-Token": API_TOKEN }, cache: "no-store" }
    );
    if (!res.ok) throw new Error(`Kintone レコードの取得に失敗しました (${res.status})`);
    const j = await res.json();
    out.push(...(j.records || []));
  }
  return out;
}

// レコードのコメント（施設一覧の「メモ」に使う）。新しい順に返す。
// Kintone は1回に10件までしか返さないので、ページを送って集める（既定で最大50件）。
export async function listComments(recordId, max = 50) {
  const out = [];
  for (let offset = 0; offset < max; offset += 10) {
    const url =
      `https://${SUBDOMAIN}.${DOMAIN}/k/v1/record/comments.json` +
      `?app=${APP_ID}&record=${encodeURIComponent(recordId)}&order=desc&offset=${offset}&limit=10`;
    const res = await fetch(url, {
      headers: { "X-Cybozu-API-Token": API_TOKEN },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Kintone コメントの取得に失敗しました (${res.status}): ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const page = data.comments || [];
    out.push(
      ...page.map((c) => ({
        id: c.id,
        text: c.text,
        at: c.createdAt,
        by: c.creator?.name || "",
        byCode: c.creator?.code || "",
      }))
    );
    if (page.length < 10 || data.older === false) break;
  }
  return out;
}

// コメントを1件消す。
// Kintone ではコメントを書き換えるAPIが無いため、サイトの「編集」も
// 「消してから書き直す」で実現する。
export async function deleteComment(recordId, commentId) {
  const url = `https://${SUBDOMAIN}.${DOMAIN}/k/v1/record/comment.json`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { "X-Cybozu-API-Token": API_TOKEN, "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      app: Number(APP_ID),
      record: Number(recordId),
      comment: Number(commentId),
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    let why = t;
    try {
      why = JSON.parse(t)?.message || t;
    } catch {}
    if (res.status === 403 || res.status === 520) {
      throw new Error(
        "このメモは消せません。Kintone でご本人が書いたコメントは、サイト（APIトークン）からは削除できません。"
      );
    }
    throw new Error(`Kintone コメントの削除に失敗しました (${res.status}): ${String(why).slice(0, 200)}`);
  }
  return true;
}

// コメントを1件足す。
export async function addComment(recordId, text) {
  const url = `https://${SUBDOMAIN}.${DOMAIN}/k/v1/record/comment.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-Cybozu-API-Token": API_TOKEN, "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      app: Number(APP_ID),
      record: Number(recordId),
      comment: { text },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    let why = t;
    try {
      why = JSON.parse(t)?.message || t;
    } catch {}
    if (res.status === 403) {
      throw new Error(
        "Kintone にコメントを書き込めません（APIトークンの権限、またはアプリのコメント機能をご確認ください）"
      );
    }
    throw new Error(`Kintone コメントの登録に失敗しました (${res.status}): ${String(why).slice(0, 200)}`);
  }
  return true;
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
