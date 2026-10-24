// lib/studio/variables.js
// デザインの文字に差し込める値（{likes} や {lastFollower}）と、
// ルールで増減するカウンター・タイマー（サブアソン式の延長タイマー）。
//
// stats は「今回の配信」ぶんで保存しない（ギフトのランキングと同じく、配信が変わると消える）。
// カウンターとタイマーは配信者が意図して積んだものなので保存して、再起動をまたぐ。

// stats の名前はテンプレートの予約語。同じ名前のカウンターは作らせない
// （{likes} がどちらを指すか分からなくなる）。
const STAT_KEYS = [
  "likes", "followers", "shares", "coins", "gifts", "comments", "joins",
  "lastFollower", "lastGifter", "lastGift", "lastComment", "lastCommenter", "lastSharer", "lastJoin",
];

// 演出のテンプレートで使うイベント側の名前も予約しておく
const EVENT_KEYS = [
  "user", "avatar", "gift", "count", "comment", "args", "times", "type", "giftCoins", "likeCount",
];

const NAME_PATTERN = /^[\p{L}_][\p{L}\p{N}_]{0,31}$/u;
const VALUE_LIMIT = 1e12;
const TIMER_LIMIT_MS = 100 * 60 * 60 * 1000; // 100時間

/** カウンター・タイマーに使える名前か */
export function isValidVarName(name) {
  return typeof name === "string" && NAME_PATTERN.test(name) && !name.startsWith("__") &&
    !STAT_KEYS.includes(name) && !EVENT_KEYS.includes(name) && !/^top\d/.test(name);
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function emptyStats() {
  return {
    likes: 0, followers: 0, shares: 0, coins: 0, gifts: 0, comments: 0, joins: 0,
    lastFollower: "", lastGifter: "", lastGift: "", lastComment: "", lastCommenter: "",
    lastSharer: "", lastJoin: "",
  };
}

/**
 * @param {object} [opts]
 * @param {() => number} [opts.now]
 */
export function createStudioVars({ now = () => Date.now() } = {}) {
  let stats = emptyStats();
  /** @type {Map<string, number>} */
  const counters = new Map();
  /** @type {Map<string, {remainingMs: number, running: boolean, updatedAt: number}>} */
  const timers = new Map();

  /** 1件のイベントを stats に反映する */
  function recordEvent(event) {
    const name = event.user?.name || "";
    switch (event.type) {
      case "chat":
        stats.comments++;
        stats.lastComment = String(event.text ?? "").slice(0, 200);
        stats.lastCommenter = name;
        break;
      case "gift":
        stats.gifts += Number(event.count) || 1;
        stats.coins += Number(event.coins) || 0;
        stats.lastGifter = name;
        stats.lastGift = event.gift?.name || "";
        break;
      case "follow":
        stats.followers++;
        stats.lastFollower = name;
        break;
      case "share":
        stats.shares++;
        stats.lastSharer = name;
        break;
      case "like": {
        // 配信の累計が来ていればそれを正とする（取りこぼしても追いつく）
        const total = Number(event.totalLikes);
        if (Number.isFinite(total) && total > 0) stats.likes = Math.max(total, 0);
        else stats.likes += Math.max(0, Number(event.likes) || 0);
        break;
      }
      case "join":
        stats.joins++;
        stats.lastJoin = name;
        break;
      case "envelope":
        stats.coins += Number(event.coins) || 0;
        break;
      default:
        break;
    }
  }

  function resetStats() {
    stats = emptyStats();
  }

  /** 走っているタイマーの残りを今の時刻で確定させる */
  function settle(timer, t) {
    if (timer.running) {
      timer.remainingMs = Math.max(0, timer.remainingMs - (t - timer.updatedAt));
      if (timer.remainingMs === 0) timer.running = false;
    }
    timer.updatedAt = t;
    return timer;
  }

  function getTimer(name) {
    let timer = timers.get(name);
    if (!timer) {
      timer = { remainingMs: 0, running: false, updatedAt: now() };
      timers.set(name, timer);
    }
    return timer;
  }

  /**
   * カウンターを動かす。
   * @param {string} name
   * @param {"add"|"sub"|"set"|"reset"} op
   * @param {number} amount
   * @returns {boolean} 動かしたか（名前が不正なら false）
   */
  function applyCounter(name, op, amount) {
    if (!isValidVarName(name)) return false;
    const current = counters.get(name) ?? 0;
    const n = Number(amount) || 0;
    let next = current;
    switch (op) {
      case "sub": next = current - n; break;
      case "set": next = n; break;
      case "reset": next = 0; break;
      default: next = current + n; break;
    }
    counters.set(name, clamp(Math.round(next * 100) / 100, -VALUE_LIMIT, VALUE_LIMIT));
    return true;
  }

  /**
   * タイマーを動かす。
   * @param {string} name
   * @param {"add"|"sub"|"set"|"start"|"pause"|"toggle"|"reset"} op
   * @param {number} seconds add/sub/set の秒数
   */
  function applyTimer(name, op, seconds = 0) {
    if (!isValidVarName(name)) return false;
    const t = now();
    const timer = settle(getTimer(name), t);
    const ms = (Number(seconds) || 0) * 1000;
    switch (op) {
      case "add": timer.remainingMs += ms; break;
      case "sub": timer.remainingMs -= ms; break;
      case "set": timer.remainingMs = ms; break;
      case "start": timer.running = true; break;
      case "pause": timer.running = false; break;
      case "toggle": timer.running = !timer.running; break;
      case "reset": timer.remainingMs = 0; timer.running = false; break;
      default: return false;
    }
    timer.remainingMs = clamp(timer.remainingMs, 0, TIMER_LIMIT_MS);
    if (timer.remainingMs === 0 && op !== "start") timer.running = false;
    return true;
  }

  function deleteVar(kind, name) {
    return kind === "timer" ? timers.delete(name) : counters.delete(name);
  }

  /** 画面に配る形 */
  function snapshot() {
    const t = now();
    const timerOut = {};
    for (const [name, timer] of timers) {
      settle(timer, t);
      timerOut[name] = { remaining: timer.remainingMs, running: timer.running };
    }
    return {
      stats: { ...stats },
      counters: Object.fromEntries(counters),
      timers: timerOut,
    };
  }

  /** 保存する形（stats は配信ごとなので保存しない） */
  function serialize() {
    const t = now();
    const timerOut = {};
    for (const [name, timer] of timers) {
      settle(timer, t);
      // 落ちている間は時間が進まない扱いにする（再起動したら一時停止で戻る）
      timerOut[name] = { remainingMs: timer.remainingMs, running: false };
    }
    return { counters: Object.fromEntries(counters), timers: timerOut };
  }

  function restore(data) {
    counters.clear();
    timers.clear();
    if (!data || typeof data !== "object") return;
    for (const [name, value] of Object.entries(data.counters || {})) {
      const n = Number(value);
      if (isValidVarName(name) && Number.isFinite(n)) counters.set(name, clamp(n, -VALUE_LIMIT, VALUE_LIMIT));
    }
    for (const [name, value] of Object.entries(data.timers || {})) {
      const ms = Number(value?.remainingMs);
      if (!isValidVarName(name) || !Number.isFinite(ms)) continue;
      timers.set(name, { remainingMs: clamp(ms, 0, TIMER_LIMIT_MS), running: false, updatedAt: now() });
    }
  }

  return {
    recordEvent, resetStats, applyCounter, applyTimer, deleteVar, snapshot, serialize, restore,
    get stats() { return stats; },
  };
}
