"use client";

// 画面をまたいで使う取得結果の置き場。
//
// 案件データ（/api/records）は 2,668 件 × 46 項目で、生の JSON は約 9MB ある。
// ページを移るたびに取り直すと、そのたびに転送と読み込みが走って待たされるので、
// 一度取ったものはしばらく使い回す。
//
//   ・同じURLを同時に呼んだら1回にまとめる（重複リクエストを出さない）
//   ・期限内ならその場で返す（通信なし＝待ち時間ゼロ）
//   ・Kintone取込のあとは invalidate() で捨てて、次に取り直す

const store = new Map(); // url -> { at, data, promise }

export function cachedJson(url, ttlMs = 3 * 60 * 1000) {
  const hit = store.get(url);
  const now = Date.now();
  if (hit?.promise) return hit.promise; // 取得中なら、その結果を待つ
  if (hit && now - hit.at < ttlMs) return Promise.resolve(hit.data);

  const promise = fetch(url, { cache: "no-store" })
    .then((r) => r.json())
    .then((data) => {
      store.set(url, { at: Date.now(), data });
      return data;
    })
    .catch((e) => {
      store.delete(url);
      throw e;
    });
  store.set(url, { at: now, promise });
  return promise;
}

// 前に取ったものがあれば、それを即返す（無ければ null）。
// 先に画面を出しておいて、裏で取り直すときに使う。
export function peekJson(url, ttlMs = 3 * 60 * 1000) {
  const hit = store.get(url);
  return hit && !hit.promise && Date.now() - hit.at < ttlMs ? hit.data : null;
}

// 取込などで中身が変わったときに捨てる。前方一致で消す。
export function invalidate(prefix) {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
