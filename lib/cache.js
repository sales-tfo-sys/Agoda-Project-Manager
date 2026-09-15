// 外部（Kintone / Google スプレッドシート）への問い合わせは数秒かかるため、
// サーバー内のメモリに短時間ためておく。
// 期限が切れた後も「古い値をすぐ返しつつ裏で取り直す」ので、待たされるのは初回だけ。
const store = new Map(); // key -> { value, at, pending }

/**
 * ためた値と、その値を実際に取りに行った時刻（ミリ秒）を組で返す。{ value, at }
 * 値と時刻は同じ瞬間に取り出すので、必ず食い違わない。
 * （値を受け取った後で別に時刻を問い合わせると、その間に裏の取り直しが終わって
 *  「画面の値より新しい時刻」を返してしまうことがあるため、組で返す）
 */
export async function cachedEntry(key, ttlMs, loader) {
  const now = Date.now();
  const hit = store.get(key);

  // 新しい：そのまま返す
  if (hit && now - hit.at < ttlMs) return { value: hit.value, at: hit.at };

  // 古いがある：先に返して、裏で取り直す
  if (hit) {
    if (!hit.pending) {
      hit.pending = loader()
        .then((v) => {
          store.set(key, { value: v, at: Date.now() });
          return v;
        })
        .catch(() => {
          hit.pending = null; // 失敗したら次回また試す
        });
    }
    return { value: hit.value, at: hit.at };
  }

  // 初回：取得を待つ（同時に来た分は1回にまとめる）
  const inflight = store.get(key + ":inflight");
  if (inflight) return inflight;
  const p = loader().then(
    (v) => {
      const at = Date.now();
      store.set(key, { value: v, at });
      store.delete(key + ":inflight");
      return { value: v, at };
    },
    (e) => {
      store.delete(key + ":inflight");
      throw e;
    }
  );
  store.set(key + ":inflight", p);
  return p;
}

/** ためた値だけを返す（時刻が要らない呼び出し側向け。動きは cachedEntry と同じ） */
export async function cached(key, ttlMs, loader) {
  return (await cachedEntry(key, ttlMs, loader)).value;
}

/** 明示的に捨てる（保存直後など、すぐ反映したい時に使う） */
export function invalidate(prefix) {
  for (const k of [...store.keys()]) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}
