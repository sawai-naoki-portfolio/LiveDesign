// server/demo.js
// TikTok に繋がず、画面を開いている利用者それぞれにダミーのコメント・ギフト・フォロー…を流す
// （開発とデザインの見本用。DEMO_MODE=true のときだけ動く）。
// **本番と同じ studioIngest() を通す**のが肝で、別の道を作るとデモで確かめた動きが
// 本番で再現しなくなる。
import { activeUserIds } from "./net.js";
import { studioIngest } from "./studio.js";

const DEMO_USERS = [
  "tanaka_gamer", "sakura_live", "ninja_master", "yuki_stream",
  "kaze_no_tabi", "hoshi_player", "ryu_fighter", "miku_fan",
];

const DEMO_COMMENTS = [
  "こんにちは！", "最高！", "がんばれ！", "ナイス！", "かっこいい！", "GG！",
  "盛り上がってきた！", "楽しい！", "初見です！", "はじめまして〜",
  // ルールの「コマンド」を試すため
  "!jump", "!hello",
];

const DEMO_GIFTS = [
  { name: "ローズ", coin: 1 },
  { name: "GG", coin: 1 },
  { name: "ハート", coin: 5 },
  { name: "ドーナツ", coin: 30 },
  { name: "花火", coin: 1088 },
  { name: "ライオン", coin: 29999 },
];

const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
const between = (min, max) => min + Math.random() * (max - min);

// ライブイベントと同じ形の user を作る（人ごとに固定の ID）
const demoUser = (name) => ({ userId: `demo:${name}`, uniqueId: name, nickName: name });

/** min〜max ミリ秒おきに、画面を開いている全員へ fn(userId) を呼ぶ */
function every(min, max, fn) {
  (function next() {
    setTimeout(() => {
      for (const userId of activeUserIds()) fn(userId);
      next();
    }, between(min, max));
  })();
}

export function startDemoMode() {
  console.log("🎮 デモモード（TikTok には繋がず、画面を開いている人にダミーのイベントを流します）");

  every(3000, 8000, (id) => studioIngest(id, "chat", demoUser(randomItem(DEMO_USERS)), { text: randomItem(DEMO_COMMENTS) }));

  every(8000, 20000, (id) => {
    const gift = randomItem(DEMO_GIFTS);
    studioIngest(id, "gift", demoUser(randomItem(DEMO_USERS)), {
      gift: { name: gift.name, coin: gift.coin, count: Math.floor(between(1, 6)) },
    });
  });

  every(15000, 30000, (id) => studioIngest(id, "follow", demoUser(randomItem(DEMO_USERS))));
  every(20000, 40000, (id) => studioIngest(id, "share", demoUser(randomItem(DEMO_USERS))));
  every(15000, 30000, (id) => studioIngest(id, "join", demoUser(randomItem(DEMO_USERS))));
  every(25000, 50000, (id) => studioIngest(id, "envelope", demoUser(randomItem(DEMO_USERS)), { coins: Math.floor(between(1, 6)) * 100 }));

  // いいねは本番と同じく「塊の数と累計」を渡す（累計は人ごと）
  const totals = new Map();
  every(2000, 4000, (id) => {
    const count = Math.floor(between(3, 16));
    totals.set(id, (totals.get(id) || 0) + count);
    studioIngest(id, "like", demoUser(randomItem(DEMO_USERS)), { likes: count, totalLikes: totals.get(id) });
  });
}
