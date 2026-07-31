// 外部（Kintone / Google スプレッドシート）への問い合わせは数秒かかるため、
// サーバー内のメモリに短時間ためておく。
// 期限が切れた後も「古い値をすぐ返しつつ裏で取り直す」ので、待たされるのは初回だけ。
const store = new Map(); // key -> { value, at, pending }

export async function cached(key, ttlMs, loader) {
  const now = Date.now();
  const hit = store.get(key);

  // 新しい：そのまま返す
  if (hit && now - hit.at < ttlMs) return hit.value;

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
    return hit.value;
  }

  // 初回：取得を待つ（同時に来た分は1回にまとめる）
  const inflight = store.get(key + ":inflight");
  if (inflight) return inflight;
  const p = loader().then(
    (v) => {
      store.set(key, { value: v, at: Date.now() });
      store.delete(key + ":inflight");
      return v;
    },
    (e) => {
      store.delete(key + ":inflight");
      throw e;
    }
  );
  store.set(key + ":inflight", p);
  return p;
}

/** 明示的に捨てる（保存直後など、すぐ反映したい時に使う） */
export function invalidate(prefix) {
  for (const k of [...store.keys()]) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}
