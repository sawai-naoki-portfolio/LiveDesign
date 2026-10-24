// lib/auth/rate-limit.js
// 回数制限（ログインの総当たり・登録の連打を止める）。プロセスの中だけで数える。
// サーバーを何台にも分けるときは、Redis などの共有の入れ物に置き換える。

/**
 * @param {object} opts
 * @param {number} opts.windowMs 数える時間
 * @param {number} opts.max その時間に許す回数
 * @param {() => number} [opts.now]
 */
export function createRateLimiter({ windowMs, max, now = () => Date.now() }) {
  /** @type {Map<string, {count: number, resetAt: number}>} */
  const hits = new Map();
  const MAX_KEYS = 50_000;

  function sweep(t) {
    for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
  }

  return {
    /** 1回数える。上限を超えていれば false */
    hit(key) {
      const t = now();
      if (hits.size > MAX_KEYS) sweep(t);
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= t) {
        entry = { count: 0, resetAt: t + windowMs };
        hits.set(key, entry);
      }
      entry.count++;
      return entry.count <= max;
    },
    /** 次に試せるまでの秒数 */
    retryAfter(key) {
      const entry = hits.get(key);
      return entry ? Math.max(0, Math.ceil((entry.resetAt - now()) / 1000)) : 0;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
