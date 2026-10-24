// lib/studio/rules.js
// 「イベント → アクション」のルール判定（TikFinity の Actions & Events にあたる）。
//
// ルールはシーンごとに持つ。「このデザインに置いたアラート枠に出す」「この図形を揺らす」
// のように、アクションの宛先がそのシーンの要素だからで、同じ OBS に別のシーンを
// 重ねても、それぞれのルールが自分の要素だけを動かす。
//
// ここは判定だけで、画面にも保存にも触らない（server/studio.js が結果を配る）。
// クールダウンといいねの貯まり具合だけは、ルールをまたいで覚えておく必要があるので
// エンジンの中に持つ。

/**
 * サーバーに届いたイベントを、ルールが読む形に揃えたもの。
 * @typedef {object} StudioEvent
 * @property {"chat"|"gift"|"follow"|"share"|"like"|"join"|"envelope"} type
 * @property {{id: string, name: string, handle: string, avatar: string}} user
 * @property {string} [text]      コメント本文
 * @property {{name: string, picture: string, coin: number, count: number}} [gift]
 * @property {number} [coins]     このイベントの合計コイン（ギフト・宝箱）
 * @property {number} [count]     個数（ギフトの連打数）
 * @property {number} [likes]     このいいねの塊の数
 * @property {number} [totalLikes] 配信の累計いいね
 * @property {boolean} [test]     ダッシュボード・スタジオからのテスト
 */

// 全角の英数字・記号（「！ジャンプ」「１」）や半角カナも、ふつうの文字と同じに読む（日本語入力のままコメントされることが多いので）
const nfkc = (s) => String(s ?? "").normalize("NFKC");
const lower = (s) => nfkc(s).trim().toLowerCase();

/** "a, b ,c" → ["a","b","c"] */
function splitList(s) {
  return String(s ?? "").split(/[,、\n]/).map(lower).filter(Boolean);
}

/**
 * コメントがコマンドに当たるか。`!jump` は「!jump」「!jump 3」に当たり、「!jumpman」には当たらない。
 * @returns {string|null} 当たったときはコマンドより後ろの文字列（引数）、外れたら null
 */
export function matchCommand(text, keyword) {
  const t = nfkc(text).trim();
  const k = nfkc(keyword).trim();
  if (!k) return null;
  if (t.toLowerCase() === k.toLowerCase()) return "";
  if (t.toLowerCase().startsWith(k.toLowerCase()) && /\s/.test(t.charAt(k.length))) {
    return t.slice(k.length).trim();
  }
  return null;
}

/** 人で絞るルール（「この人のギフトだけ」）。空なら誰でも */
function matchesUser(trigger, event) {
  const users = splitList(trigger.users);
  if (users.length === 0) return true;
  const u = event.user || {};
  const names = [u.id, u.name, u.handle, u.handle ? `@${u.handle}` : ""].map(lower).filter(Boolean);
  return users.some((x) => names.includes(x));
}

/**
 * いいねの「N 件ごと」以外の条件を見る。
 * @returns {object|null} 当たったら、テンプレートに足す値（{args} など）。外れたら null
 */
export function matchTrigger(trigger, event) {
  if (!trigger || !event) return null;
  if (trigger.type !== "any" && trigger.type !== event.type) return null;
  if (!matchesUser(trigger, event)) return null;

  if (event.type === "gift" && trigger.type === "gift") {
    const names = splitList(trigger.giftName);
    if (names.length && !names.includes(lower(event.gift?.name))) return null;
    const coins = Number(event.coins) || 0;
    if (trigger.minCoins > 0 && coins < trigger.minCoins) return null;
    if (trigger.maxCoins > 0 && coins > trigger.maxCoins) return null;
  }

  if (event.type === "chat" && trigger.type === "chat") {
    const text = String(event.text ?? "");
    switch (trigger.match) {
      case "command": {
        const args = matchCommand(text, trigger.keyword);
        return args === null ? null : { args };
      }
      case "contains":
        if (!trigger.keyword || !lower(text).includes(lower(trigger.keyword))) return null;
        break;
      case "exact":
        if (lower(text) !== lower(trigger.keyword)) return null;
        break;
      default:
        break;
    }
  }

  return {};
}

/**
 * カウンター・タイマーのアクションで動かす量。
 * 「1コインにつき10秒」「ギフト1個につき+1」のように、イベントの値に掛けられる。
 */
export function actionAmount(action, event) {
  const base = Number(action?.amount ?? action?.seconds);
  const n = Number.isFinite(base) ? base : 0;
  switch (action?.per) {
    case "coins": return n * (Number(event?.coins) || 0);
    case "count": return n * (Number(event?.count) || 1);
    case "likes": return n * (Number(event?.likes) || 0);
    default: return n;
  }
}

/**
 * @param {object} [opts]
 * @param {() => number} [opts.now]
 */
export function createRuleEngine({ now = () => Date.now() } = {}) {
  const lastFired = new Map();      // `${sceneId}:${ruleId}` → ms
  const lastFiredUser = new Map();  // `${sceneId}:${ruleId}:${userId}` → ms
  const likeBank = new Map();       // `${sceneId}:${ruleId}` → 貯まったいいね

  // ユーザーごとのクールダウンは人数ぶん増えるので、古いものから捨てる
  const MAX_USER_COOLDOWNS = 5000;

  function inCooldown(key, userKey, rule, t) {
    if (rule.cooldown > 0 && t - (lastFired.get(key) ?? -Infinity) < rule.cooldown * 1000) return true;
    if (rule.userCooldown > 0 && userKey &&
      t - (lastFiredUser.get(userKey) ?? -Infinity) < rule.userCooldown * 1000) return true;
    return false;
  }

  function markFired(key, userKey, rule, t) {
    lastFired.set(key, t);
    if (rule.userCooldown > 0 && userKey) {
      if (lastFiredUser.size >= MAX_USER_COOLDOWNS) {
        lastFiredUser.delete(lastFiredUser.keys().next().value);
      }
      lastFiredUser.set(userKey, t);
    }
  }

  /**
   * 1件のイベントで発火するルールを集める。
   * @param {Iterable<object>} scenes 保存済みのシーン
   * @param {StudioEvent} event
   * @returns {{sceneId: string, rule: object, extra: object}[]}
   */
  function evaluate(scenes, event) {
    const fired = [];
    const t = now();
    for (const scene of scenes) {
      for (const rule of scene.rules || []) {
        if (!rule.enabled || !rule.actions?.length) continue;
        const extra = matchTrigger(rule.trigger, event);
        if (!extra) continue;

        const key = `${scene.id}:${rule.id}`;

        // いいねは「N件ごと」。塊で届くので貯めておき、跨いだときだけ発火する
        if (event.type === "like" && rule.trigger.type === "like" && rule.trigger.likeEvery > 0) {
          const bank = (likeBank.get(key) || 0) + (Number(event.likes) || 0);
          const times = Math.floor(bank / rule.trigger.likeEvery);
          likeBank.set(key, bank - times * rule.trigger.likeEvery);
          if (times === 0) continue;
          extra.times = times;
        }

        const userKey = event.user?.id ? `${key}:${event.user.id}` : null;
        if (inCooldown(key, userKey, rule, t)) continue;
        markFired(key, userKey, rule, t);
        fired.push({ sceneId: scene.id, rule, extra });
      }
    }
    return fired;
  }

  /** 配信が変わったとき・テストのあと */
  function reset() {
    lastFired.clear();
    lastFiredUser.clear();
    likeBank.clear();
  }

  return { evaluate, reset };
}

/**
 * ルールのテストボタン用に、そのルールに当たるイベントを作る。
 * @param {object} trigger
 * @param {string} [userName]
 */
export function sampleEventFor(trigger, userName = "テスト視聴者") {
  const type = trigger?.type === "any" || !trigger?.type ? "gift" : trigger.type;
  const firstUser = splitList(trigger?.users)[0];
  const name = firstUser || userName;
  const event = {
    type,
    user: { id: `test:${name}`, name, handle: name, avatar: "" },
    test: true,
  };
  if (type === "gift") {
    const giftName = String(trigger?.giftName ?? "").split(/[,、]/)[0].trim() || "ローズ";
    const coins = Math.max(1, trigger?.minCoins || 1);
    event.gift = { name: giftName, picture: "", coin: coins, count: 1 };
    event.coins = coins;
    event.count = 1;
  }
  if (type === "chat") {
    const kw = String(trigger?.keyword ?? "").trim();
    event.text = trigger?.match === "command" ? `${kw} テスト` : kw || "テストコメント";
  }
  if (type === "like") {
    event.likes = Math.max(1, trigger?.likeEvery || 10);
  }
  if (type === "envelope") {
    event.coins = 100;
  }
  return event;
}
