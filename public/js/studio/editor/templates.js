// public/js/studio/editor/templates.js
// 左の「素材」パネルに並べる部品と、新規作成で選べるテンプレート。
import { createElement, solid, linear, NONE, uid } from "../shared/model.js";

const radial = (...colors) => ({ ...linear(0, ...colors), type: "radial" });

// ===============================
// パスの形（100×100 の中で描いたもの）
// ===============================
const n = (x, y, ix = x, iy = y, ox = x, oy = y, s = false) => ({ x, y, ix, iy, ox, oy, s });
const SHAPE_PATHS = {
  heart: {
    w: 100, h: 90, closed: true, nodes: [
      n(50, 88, 78, 66, 22, 66), n(2, 28, 2, 50, 2, 12, true), n(28, 2, 14, 2, 38, 2, true),
      n(50, 16, 46, 8, 54, 8), n(72, 2, 62, 2, 86, 2, true), n(98, 28, 98, 12, 98, 50, true),
    ],
  },
  bubble: {
    w: 100, h: 90, closed: true, nodes: [
      n(0, 0), n(100, 0), n(100, 62), n(46, 62), n(22, 90), n(28, 62), n(0, 62),
    ],
  },
  arrow: {
    w: 100, h: 60, closed: true, nodes: [n(0, 18), n(64, 18), n(64, 0), n(100, 30), n(64, 60), n(64, 42), n(0, 42)],
  },
  lightning: {
    w: 60, h: 100, closed: true, nodes: [n(38, 0), n(4, 58), n(28, 58), n(18, 100), n(56, 38), n(32, 38), n(46, 0)],
  },
  badge: {
    w: 100, h: 100, closed: true, nodes: Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 42 : 50;
      return n(50 + Math.cos(a) * r, 50 + Math.sin(a) * r);
    }),
  },
};

function pathShape(key, props = {}) {
  const p = SHAPE_PATHS[key];
  return createElement("path", {
    w: p.w * 2, h: p.h * 2,
    path: { w: p.w, h: p.h, closed: p.closed, nodes: p.nodes.map((x) => ({ ...x })) },
    fill: solid("#ff5c8a"), stroke: { paint: solid("#ffffff"), width: 0 },
    ...props,
  });
}

const text = (props) => createElement("text", props);

// ===============================
// 素材パネル
// ===============================
export const LIBRARY = [
  {
    title: "テキスト",
    items: [
      { label: "見出し", make: () => text({ name: "見出し", text: "見出しを入力", w: 980, h: 170, font: { family: "Dela Gothic One", size: 110, weight: 400 } }) },
      { label: "小見出し", make: () => text({ name: "小見出し", text: "小見出し", w: 640, h: 100, font: { family: "Noto Sans JP", size: 60, weight: 800 } }) },
      { label: "本文", make: () => text({ name: "本文", text: "ここに文章を入力します", w: 720, h: 80, font: { family: "Noto Sans JP", size: 36, weight: 500 } }) },
      {
        label: "グラデーション", make: () => text({
          name: "グラデーション文字", text: "LIVE", w: 600, h: 240,
          font: { family: "Anton", size: 220, weight: 400 }, fill: linear(90, "#ff5c8a", "#ffc93c", "#3ce0ff"),
        }),
      },
      {
        label: "縁取り", make: () => text({
          name: "縁取り文字", text: "ゲーム実況", w: 820, h: 170,
          font: { family: "Dela Gothic One", size: 120, weight: 400 }, fill: solid("#ffe66d"),
          outline: { color: "#1a0b3d", width: 14 }, shadow: { enabled: true, x: 0, y: 10, blur: 0, color: "#1a0b3d" },
        }),
      },
      {
        label: "ネオン", make: () => text({
          name: "ネオン文字", text: "ON AIR", w: 700, h: 200,
          font: { family: "Orbitron", size: 140, weight: 900 }, fill: solid("#e8fdff"),
          shadow: { enabled: true, x: 0, y: 0, blur: 18, color: "#00e5ff" }, anim: { loop: "glow", loopDuration: 2.4 },
        }),
      },
    ],
  },
  {
    title: "配信の数字",
    items: [
      { label: "❤ いいね数", make: () => text({ name: "いいね数", text: "❤ {likes}", w: 420, h: 90, font: { family: "M PLUS Rounded 1c", size: 60, weight: 900 }, outline: { color: "#000000", width: 8 } }) },
      { label: "フォロー数", make: () => text({ name: "フォロー数", text: "フォロー +{followers}", w: 520, h: 80, font: { family: "M PLUS Rounded 1c", size: 50, weight: 900 }, outline: { color: "#000000", width: 8 } }) },
      { label: "最新フォロワー", make: () => text({ name: "最新フォロワー", text: "最新フォロー：{lastFollower}", w: 760, h: 70, align: "left", font: { family: "Noto Sans JP", size: 40, weight: 800 }, outline: { color: "#000000", width: 7 } }) },
      { label: "最新ギフト", make: () => text({ name: "最新ギフト", text: "🎁 {lastGifter}（{lastGift}）", w: 760, h: 70, align: "left", font: { family: "Noto Sans JP", size: 40, weight: 800 }, outline: { color: "#000000", width: 7 } }) },
      { label: "ギフト1位", make: () => text({ name: "ギフト1位", text: "👑 {top1Name}  {top1Coins}", w: 760, h: 70, align: "left", font: { family: "Noto Sans JP", size: 40, weight: 800 }, outline: { color: "#000000", width: 7 } }) },
      { label: "コメント数", make: () => text({ name: "コメント数", text: "💬 {comments}", w: 380, h: 80, font: { family: "M PLUS Rounded 1c", size: 52, weight: 900 }, outline: { color: "#000000", width: 8 } }) },
      { label: "カウンター", make: () => text({ name: "カウンター", text: "デス数：{deaths}", w: 520, h: 90, font: { family: "Dela Gothic One", size: 60, weight: 400 }, outline: { color: "#000000", width: 8 } }) },
    ],
  },
  {
    title: "図形",
    items: [
      { label: "四角", make: () => createElement("rect", { name: "四角形", w: 400, h: 260 }) },
      { label: "角丸", make: () => createElement("rect", { name: "角丸四角形", w: 400, h: 260, radius: 40, fill: linear(135, "#7c5cff", "#ff5c8a") }) },
      { label: "円", make: () => createElement("ellipse", { name: "円", w: 280, h: 280 }) },
      { label: "三角", make: () => createElement("polygon", { name: "三角形", w: 300, h: 260, sides: 3 }) },
      { label: "星", make: () => createElement("polygon", { name: "星", w: 300, h: 290, sides: 5, star: true }) },
      { label: "六角形", make: () => createElement("polygon", { name: "六角形", w: 300, h: 260, sides: 6, fill: solid("#3ce0ff") }) },
      { label: "ハート", make: () => pathShape("heart", { name: "ハート" }) },
      { label: "吹き出し", make: () => pathShape("bubble", { name: "吹き出し", fill: solid("#ffffff") }) },
      { label: "矢印", make: () => pathShape("arrow", { name: "矢印", fill: solid("#ffc93c") }) },
      { label: "稲妻", make: () => pathShape("lightning", { name: "稲妻", fill: linear(180, "#fff36d", "#ff8a3c") }) },
      { label: "バッジ", make: () => pathShape("badge", { name: "バッジ", fill: solid("#ff5c8a"), w: 220, h: 220 }) },
      {
        label: "線", make: () => createElement("path", {
          name: "線", w: 400, h: 1, path: { w: 400, h: 1, closed: false, nodes: [n(0, 0.5), n(400, 0.5)] },
          stroke: { paint: solid("#ffffff"), width: 8 },
        }),
      },
    ],
  },
  {
    title: "フレーム",
    items: [
      {
        label: "カメラ枠", make: () => createElement("rect", {
          name: "カメラ枠", w: 640, h: 360, radius: 28, fill: NONE,
          stroke: { paint: linear(135, "#7c5cff", "#ff5c8a", "#ffc93c"), width: 12 },
          shadow: { enabled: true, x: 0, y: 0, blur: 24, color: "#ff5c8a99" },
        }),
      },
      {
        label: "丸カメラ枠", make: () => createElement("ellipse", {
          name: "丸カメラ枠", w: 380, h: 380, fill: NONE,
          stroke: { paint: linear(135, "#3ce0ff", "#7c5cff"), width: 14 }, anim: { loop: "rainbow", loopDuration: 6 },
        }),
      },
      {
        label: "ゲーム枠", make: () => createElement("rect", {
          name: "ゲーム画面枠", w: 1440, h: 810, radius: 16, fill: NONE,
          stroke: { paint: solid("#ffffff"), width: 6, dash: "dashed" },
        }),
      },
      {
        label: "帯（下）", make: () => createElement("rect", {
          name: "帯", w: 1200, h: 90, radius: 45, fill: linear(90, "#7c5cffee", "#ff5c8aee"),
          shadow: { enabled: true, x: 0, y: 8, blur: 24, color: "#00000080" },
        }),
      },
      {
        label: "ガラス板", make: () => createElement("rect", {
          name: "ガラス板", w: 560, h: 360, radius: 28, fill: solid("#ffffff1f"),
          stroke: { paint: solid("#ffffff55"), width: 2 },
          shadow: { enabled: true, x: 0, y: 16, blur: 40, color: "#00000066" },
        }),
      },
    ],
  },
  {
    title: "配信ウィジェット",
    widgets: true,
    items: [
      { label: "💬 チャット", make: () => createElement("chat", { name: "チャット", w: 520, h: 620 }) },
      { label: "≋ 弾幕", make: () => createElement("danmaku", { name: "弾幕", w: 1920, h: 420 }) },
      { label: "🔔 アラート", make: () => createElement("alert", { name: "アラート", w: 900, h: 380 }) },
      { label: "▰ いいね目標", make: () => createElement("goal", { name: "いいね目標", w: 760, h: 90 }) },
      {
        label: "◎ フォロー目標", make: () => createElement("goal", {
          name: "フォロー目標", w: 260, h: 260,
          cfg: { source: "followers", target: 50, label: "フォロー", format: "{value}/{target}", shape: "ring", thickness: 0.5, bar: linear(90, "#3ce0ff") },
        }),
      },
      { label: "🏆 ランキング", make: () => createElement("leaderboard", { name: "ランキング", w: 460, h: 360 }) },
      { label: "☰ 最近のイベント", make: () => createElement("events", { name: "最近のイベント", w: 460, h: 280 }) },
      { label: "⏱ タイマー", make: () => createElement("timer", { name: "タイマー", w: 560, h: 160 }) },
    ],
  },
];

// ===============================
// ルールのひな形
// ===============================
export function rule(name, trigger, actions, extra = {}) {
  return {
    id: uid("rule"),
    name,
    enabled: true,
    trigger: {
      type: "gift", giftName: "", minCoins: 0, maxCoins: 0, match: "any", keyword: "", likeEvery: 0, users: "",
      ...trigger,
    },
    cooldown: 0,
    userCooldown: 0,
    actions,
    ...extra,
  };
}

function alertRules(alertId, framed) {
  return [
    rule("フォローのお礼", { type: "follow" }, [
      { kind: "alert", target: alertId, title: "{user}", message: "フォローありがとう！", image: "avatar" },
      { kind: "particles", preset: "hearts", amount: 40 },
    ]),
    rule("ギフトのお礼", { type: "gift" }, [
      { kind: "alert", target: alertId, title: "{user}", message: "{gift} ×{count} ありがとう！", image: "gift" },
    ]),
    rule("大きなギフト（100コイン〜）", { type: "gift", minCoins: 100 }, [
      { kind: "particles", preset: "confetti", amount: 120 },
      ...(framed ? [{ kind: "animate", target: framed, animation: "tada", duration: 1 }] : []),
    ]),
    rule("シェアのお礼", { type: "share" }, [
      { kind: "alert", target: alertId, title: "{user}", message: "シェアありがとう！", image: "avatar" },
    ], { userCooldown: 600 }),
    rule("いいね 500 ごと", { type: "like", likeEvery: 500 }, [
      { kind: "particles", preset: "hearts", amount: 60 },
    ]),
  ];
}

// ===============================
// テンプレート
// ===============================
export const TEMPLATES = [
  {
    id: "blank", name: "白紙", desc: "何も無いところから", width: 1920, height: 1080,
    build: () => ({ elements: [], rules: [] }),
  },
  {
    id: "gaming", name: "ゲーム実況（横）", desc: "カメラ枠・チャット・ゴール・アラート・最近のイベント", width: 1920, height: 1080,
    build() {
      const cam = createElement("rect", {
        name: "カメラ枠", x: 1400, y: 680, w: 480, h: 360, radius: 28, fill: NONE,
        stroke: { paint: linear(135, "#7c5cff", "#ff5c8a", "#ffc93c"), width: 10 },
        shadow: { enabled: true, x: 0, y: 0, blur: 24, color: "#ff5c8a88" },
      });
      const camLabel = text({
        name: "最新フォロワー", text: "最新フォロー：{lastFollower}", x: 1400, y: 630, w: 480, h: 50, align: "left",
        font: { family: "Noto Sans JP", size: 28, weight: 800 }, outline: { color: "#000000", width: 6 },
      });
      const chat = createElement("chat", { name: "チャット", x: 40, y: 400, w: 480, h: 640 });
      const goal = createElement("goal", { name: "いいね目標", x: 40, y: 40, w: 720, h: 90 });
      const alert = createElement("alert", { name: "アラート", x: 510, y: 70, w: 900, h: 380 });
      const events = createElement("events", { name: "最近のイベント", x: 1420, y: 40, w: 460, h: 260 });
      const band = createElement("rect", {
        name: "帯", x: 610, y: 980, w: 700, h: 64, radius: 32, fill: linear(90, "#7c5cffdd", "#ff5c8add"),
      });
      const bandText = text({
        name: "帯の文字", text: "❤ {likes}   💬 {comments}   🎁 {coins}", x: 610, y: 980, w: 700, h: 64,
        font: { family: "M PLUS Rounded 1c", size: 32, weight: 900 },
      });
      return { elements: [cam, camLabel, chat, goal, alert, events, band, bandText], rules: alertRules(alert.id, cam.id) };
    },
  },
  {
    id: "vertical", name: "TikTok 縦配信", desc: "縦 1080×1920。ゴール・いいね数・チャット・アラート", width: 1080, height: 1920,
    build() {
      const likes = createElement("goal", { name: "いいね目標", x: 60, y: 260, w: 960, h: 100, cfg: { target: 5000 } });
      const follow = createElement("goal", {
        name: "フォロー目標", x: 60, y: 380, w: 960, h: 100,
        cfg: { source: "followers", target: 30, label: "フォロー目標", bar: linear(90, "#3ce0ff", "#7c5cff") },
      });
      const counter = text({
        name: "いいね数", text: "❤ {likes}", x: 290, y: 120, w: 500, h: 120,
        font: { family: "M PLUS Rounded 1c", size: 90, weight: 900 }, outline: { color: "#000000", width: 10 },
        anim: { loop: "pulse", loopDuration: 1.6 },
      });
      const alert = createElement("alert", { name: "アラート", x: 90, y: 620, w: 900, h: 420 });
      const chat = createElement("chat", { name: "チャット", x: 40, y: 1180, w: 700, h: 520, cfg: { fontSize: 30 } });
      const board = createElement("leaderboard", { name: "ランキング", x: 700, y: 520, w: 340, h: 300, cfg: { limit: 3, fontSize: 24 } });
      return { elements: [counter, likes, follow, board, alert, chat], rules: alertRules(alert.id, counter.id) };
    },
  },
  {
    id: "starting", name: "配信開始前（Starting Soon）", desc: "背景つき。カウントダウンとチャット", width: 1920, height: 1080,
    build() {
      const bg = createElement("rect", { name: "背景", x: 0, y: 0, w: 1920, h: 1080, fill: linear(135, "#1a0b3d", "#4a1a7a", "#0b1a4a"), locked: true });
      const orb1 = createElement("ellipse", { name: "光の玉", x: 120, y: 90, w: 420, h: 420, fill: radial("#ff5c8a88", "#ff5c8a00"), anim: { loop: "float", loopDuration: 6 } });
      const orb2 = createElement("ellipse", { name: "光の玉", x: 1380, y: 560, w: 520, h: 520, fill: radial("#3ce0ff77", "#3ce0ff00"), anim: { loop: "float", loopDuration: 8 } });
      const title = text({
        name: "タイトル", text: "まもなく配信開始", x: 260, y: 300, w: 1400, h: 200,
        font: { family: "Dela Gothic One", size: 140, weight: 400 }, fill: linear(90, "#ffffff", "#ffe66d"),
        shadow: { enabled: true, x: 0, y: 12, blur: 30, color: "#00000088" }, anim: { enter: "pop", loop: "breathe", loopDuration: 3 },
      });
      const sub = text({ name: "サブタイトル", text: "STARTING SOON", x: 560, y: 220, w: 800, h: 80, font: { family: "Orbitron", size: 48, weight: 800 }, letterSpacing: 12, fill: solid("#ffffffcc") });
      const timer = createElement("timer", { name: "カウントダウン", x: 660, y: 540, w: 600, h: 180, cfg: { name: "start", fontSize: 130, endText: "START!" } });
      const chat = createElement("chat", { name: "チャット", x: 1440, y: 640, w: 440, h: 400, cfg: { limit: 5, fontSize: 24 } });
      const hint = text({ name: "案内", text: "タイマーは「テスト」タブか、タイマーのプロパティで開始できます", x: 460, y: 960, w: 1000, h: 60, font: { family: "Noto Sans JP", size: 26, weight: 500 }, fill: solid("#ffffff99") });
      return { background: "#1a0b3d", elements: [bg, orb1, orb2, sub, title, timer, chat, hint], rules: [] };
    },
  },
  {
    id: "alerts", name: "アラートパック", desc: "フォロー・ギフト・シェア・いいねのアラートだけ", width: 1920, height: 1080,
    build() {
      const alert = createElement("alert", { name: "アラート", x: 510, y: 120, w: 900, h: 420 });
      return { elements: [alert], rules: alertRules(alert.id, null) };
    },
  },
  {
    id: "subathon", name: "延長タイマー（サブアソン）", desc: "ギフト・フォローで配信時間が延びる", width: 1920, height: 1080,
    build() {
      const panel = createElement("rect", { name: "パネル", x: 560, y: 40, w: 800, h: 260, radius: 36, fill: solid("#0b0b1acc"), stroke: { paint: linear(90, "#ffc93c", "#ff5c8a"), width: 6 } });
      const timer = createElement("timer", { name: "延長タイマー", x: 580, y: 70, w: 760, h: 170, cfg: { name: "subathon", label: "延長タイマー", fontSize: 120 } });
      const rate = text({ name: "ルール", text: "1コイン = +10秒　フォロー = +1分　シェア = +30秒", x: 560, y: 240, w: 800, h: 50, font: { family: "Noto Sans JP", size: 28, weight: 700 }, fill: solid("#ffe66d") });
      const alert = createElement("alert", { name: "アラート", x: 610, y: 340, w: 700, h: 300, cfg: { titleSize: 52, messageSize: 30 } });
      const rules = [
        rule("ギフトで延長", { type: "gift" }, [
          { kind: "timer", name: "subathon", op: "add", seconds: 10, per: "coins" },
          { kind: "alert", target: alert.id, title: "{user}", message: "{gift}×{count} で延長！ありがとう！", image: "gift" },
          { kind: "animate", target: timer.id, animation: "pulse", duration: 0.6 },
        ]),
        rule("フォローで延長", { type: "follow" }, [
          { kind: "timer", name: "subathon", op: "add", seconds: 60 },
          { kind: "alert", target: alert.id, title: "{user}", message: "フォローで +1分！", image: "avatar" },
        ]),
        rule("シェアで延長", { type: "share" }, [
          { kind: "timer", name: "subathon", op: "add", seconds: 30 },
        ], { userCooldown: 300 }),
      ];
      return { elements: [panel, timer, rate, alert], rules };
    },
  },
];
