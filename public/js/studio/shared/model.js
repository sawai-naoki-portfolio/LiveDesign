// public/js/studio/shared/model.js
// シーン（デザイン）と要素の形・既定値・幾何の計算。エディタとオーバーレイの両方が使う。
//
// 保存されたシーンは「既定値と違うところ」だけを持っていてもよい。描く前に
// normalizeElement() で既定値と重ねるので、あとから項目を足しても古いシーンが壊れない。

// ===============================
// 選べるもの
// ===============================
// Google Fonts。weights は配信元にある太さ（無い太さを頼むと CSS ごと 400 で返ってこない）
export const GOOGLE_FONTS = [
  { family: "Noto Sans JP", weights: "100..900", jp: true },
  { family: "M PLUS Rounded 1c", weights: "400;500;700;800;900", jp: true },
  { family: "Zen Maru Gothic", weights: "400;500;700;900", jp: true },
  { family: "Zen Kaku Gothic New", weights: "400;500;700;900", jp: true },
  { family: "Dela Gothic One", weights: "", jp: true },
  { family: "RocknRoll One", weights: "", jp: true },
  { family: "Mochiy Pop One", weights: "", jp: true },
  { family: "Kosugi Maru", weights: "", jp: true },
  { family: "DotGothic16", weights: "", jp: true },
  { family: "Yusei Magic", weights: "", jp: true },
  { family: "Reggae One", weights: "", jp: true },
  { family: "Rampart One", weights: "", jp: true },
  { family: "Train One", weights: "", jp: true },
  { family: "Hachi Maru Pop", weights: "", jp: true },
  { family: "Kaisei Decol", weights: "400;500;700", jp: true },
  { family: "Shippori Mincho", weights: "400;500;600;700;800", jp: true },
  { family: "Bebas Neue", weights: "" },
  { family: "Anton", weights: "" },
  { family: "Oswald", weights: "200..700" },
  { family: "Montserrat", weights: "100..900" },
  { family: "Poppins", weights: "400;500;600;700;800;900" },
  { family: "Exo 2", weights: "100..900" },
  { family: "Orbitron", weights: "400..900" },
  { family: "Rajdhani", weights: "400;500;600;700" },
  { family: "Russo One", weights: "" },
  { family: "Bungee", weights: "" },
  { family: "Black Ops One", weights: "" },
  { family: "Press Start 2P", weights: "" },
  { family: "Permanent Marker", weights: "" },
  { family: "Pacifico", weights: "" },
];
export const SYSTEM_FONTS = ["sans-serif", "serif", "monospace", "system-ui"];

export const BLEND_MODES = [
  ["normal", "通常"], ["multiply", "乗算"], ["screen", "スクリーン"], ["overlay", "オーバーレイ"],
  ["darken", "比較（暗）"], ["lighten", "比較（明）"], ["color-dodge", "覆い焼きカラー"],
  ["color-burn", "焼き込みカラー"], ["hard-light", "ハードライト"], ["soft-light", "ソフトライト"],
  ["difference", "差の絶対値"], ["exclusion", "除外"], ["hue", "色相"], ["saturation", "彩度"],
  ["color", "カラー"], ["luminosity", "輝度"],
];

export const ENTER_ANIMS = [
  ["none", "なし"], ["fade", "フェード"], ["slideUp", "下から"], ["slideDown", "上から"],
  ["slideLeft", "右から"], ["slideRight", "左から"], ["zoom", "ズーム"], ["pop", "ポップ"],
  ["bounce", "バウンド"], ["flip", "フリップ"], ["blur", "ぼかしイン"], ["spin", "回転イン"],
];
export const LOOP_ANIMS = [
  ["none", "なし"], ["pulse", "鼓動"], ["float", "浮遊"], ["spin", "回転"], ["shake", "震え"],
  ["swing", "揺れ"], ["blink", "点滅"], ["glow", "発光"], ["rainbow", "虹色"], ["wobble", "ぷるぷる"],
  ["breathe", "呼吸"],
];
export const ACTION_ANIMS = [
  ["shake", "揺らす"], ["pulse", "ドクン"], ["bounce", "跳ねる"], ["spin", "回転"],
  ["flash", "フラッシュ"], ["jelly", "ゼリー"], ["tada", "ジャーン"], ["heartbeat", "ハートビート"],
];

export const PARTICLE_PRESETS = [
  ["confetti", "紙吹雪"], ["hearts", "ハート"], ["stars", "スター"], ["snow", "雪"],
  ["emoji", "絵文字の雨"], ["giftRain", "ギフト画像の雨"], ["fireworks", "花火"],
];

export const TRIGGER_LABELS = {
  gift: "🎁 ギフト", follow: "➕ フォロー", share: "🔁 シェア", like: "❤️ いいね",
  chat: "💬 コメント", join: "🚪 入室", envelope: "🧧 宝箱", any: "✳️ すべて",
};

export const ACTION_LABELS = {
  alert: "🔔 アラートを出す", sound: "🔊 音を鳴らす", animate: "💫 要素を動かす",
  visibility: "👁 表示／非表示", particles: "🎉 パーティクル", tts: "🗣 読み上げ",
  text: "✏️ 文字を差し替え", counter: "🔢 カウンター", timer: "⏱ タイマー",
  gimmick: "🎮 ギミックに合図",
};

// ===============================
// 塗り
// ===============================
export const solid = (color) => ({ type: "solid", color });
export const linear = (angle, ...colors) => ({
  type: "linear", angle,
  stops: colors.map((color, i) => ({ offset: colors.length === 1 ? 0 : i / (colors.length - 1), color })),
});
export const NONE = { type: "none" };

// ===============================
// 既定値
// ===============================
const COMMON_DEFAULTS = {
  name: "",
  x: 0, y: 0, w: 200, h: 200,
  rotation: 0, opacity: 1, visible: true, locked: false, startHidden: false,
  blend: "normal",
  shadow: { enabled: false, x: 0, y: 8, blur: 24, color: "#00000099" },
  filters: { blur: 0, brightness: 100, contrast: 100, saturate: 100, hue: 0, grayscale: 0, invert: 0 },
  anim: { enter: "none", enterDuration: 0.8, enterDelay: 0, loop: "none", loopDuration: 2 },
};

const STROKE = { paint: solid("#ffffff"), width: 0, dash: "solid", cap: "round", join: "round" };

const TYPE_DEFAULTS = {
  rect: { fill: solid("#7c5cff"), stroke: { ...STROKE }, radius: 0 },
  ellipse: { fill: solid("#ff5c8a"), stroke: { ...STROKE } },
  polygon: { fill: solid("#ffc93c"), stroke: { ...STROKE }, sides: 5, star: false, innerRatio: 0.45 },
  path: {
    fill: NONE, stroke: { ...STROKE, width: 6 },
    path: { w: 100, h: 100, nodes: [], closed: false },
  },
  text: {
    text: "テキスト",
    font: { family: "Noto Sans JP", size: 64, weight: 700, italic: false },
    fill: solid("#ffffff"),
    align: "center", vAlign: "middle",
    letterSpacing: 0, lineHeight: 1.25,
    outline: { color: "#000000", width: 0 },
    textTransform: "none",
  },
  image: { src: "", fit: "cover", radius: 0, stroke: { ...STROKE } },
  group: {},
  chat: {
    cfg: {
      limit: 8, showAvatar: true, showName: true, fontFamily: "Noto Sans JP", fontSize: 26,
      nameColor: "#ffd84d", textColor: "#ffffff", bubble: "#0b0b1acc", radius: 18, gap: 8,
      fade: 0, newest: "bottom", outline: 0,
    },
  },
  danmaku: {
    cfg: {
      fontFamily: "Noto Sans JP", fontSize: 42, color: "#ffffff", outlineColor: "#000000",
      outline: 6, speed: 8, showName: false, weight: 800,
    },
  },
  alert: {
    cfg: {
      title: "{user}", message: "フォローありがとう！", image: "avatar",
      fontFamily: "Dela Gothic One", titleSize: 64, messageSize: 34,
      titleColor: "#ffffff", messageColor: "#ffe66d", accent: "#7c5cff",
      bg: "#0b0b1ad9", radius: 28, duration: 5, enter: "pop", outline: 0,
      showBox: true, imageSize: 160,
    },
  },
  goal: {
    cfg: {
      source: "likes", target: 1000, label: "いいね目標", format: "{value} / {target}",
      shape: "bar", fontFamily: "Noto Sans JP", fontSize: 28, textColor: "#ffffff",
      track: "#ffffff26", bar: linear(90, "#ff5c8a", "#ffc93c"), radius: 999, thickness: 0.45,
      doneText: "🎉 達成！",
    },
  },
  leaderboard: {
    cfg: {
      title: "🏆 トップサポーター", limit: 5, showAvatar: true, fontFamily: "Noto Sans JP",
      fontSize: 26, textColor: "#ffffff", accent: "#ffc93c", bg: "#0b0b1acc", radius: 20,
    },
  },
  events: {
    cfg: {
      types: "follow,gift,share,envelope", limit: 5, fontFamily: "Noto Sans JP", fontSize: 24,
      textColor: "#ffffff", bg: "#0b0b1acc", radius: 14,
      followText: "{user} がフォロー", giftText: "{user} {gift}×{count}",
      shareText: "{user} がシェア", envelopeText: "{user} が宝箱", direction: "column",
    },
  },
  timer: {
    cfg: {
      name: "timer", format: "auto", label: "", fontFamily: "Orbitron", fontSize: 96,
      color: "#ffffff", weight: 800, endText: "", outline: 0, outlineColor: "#000000",
    },
  },
  // クリエイターモードで作ったギミックを置く枠。中身はギミックの ID で引く（shared/gimmick/registry.js）
  gimmick: {
    cfg: {
      gimmickId: "",
      /** パラメーター（クリエイターモードで「アーティストモードで変えられる」にした変数）の始めの値 */
      vars: [],
      /** 配信のイベント（ギフト・コメント…）をギミックにそのまま渡す */
      live: true,
    },
  },
};

export const TYPE_META = {
  rect: { label: "四角形", group: "shape" },
  ellipse: { label: "円", group: "shape" },
  polygon: { label: "多角形", group: "shape" },
  path: { label: "パス", group: "shape" },
  text: { label: "テキスト", group: "text" },
  image: { label: "画像", group: "media" },
  group: { label: "グループ", group: "group" },
  chat: { label: "チャット", group: "widget" },
  danmaku: { label: "弾幕", group: "widget" },
  alert: { label: "アラート", group: "widget" },
  goal: { label: "ゴール", group: "widget" },
  leaderboard: { label: "ランキング", group: "widget" },
  events: { label: "最近のイベント", group: "widget" },
  timer: { label: "タイマー", group: "widget" },
  gimmick: { label: "ギミック", group: "widget" },
};

const WIDGET_TYPES = ["chat", "danmaku", "alert", "goal", "leaderboard", "events", "timer", "gimmick"];
export const isWidget = (type) => WIDGET_TYPES.includes(type);

// ===============================
// 小道具
// ===============================
export const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/** b を a に重ねる（オブジェクトは中まで、配列は丸ごと置き換え） */
export function deepMerge(a, b) {
  if (!isPlainObject(a) || !isPlainObject(b)) return b === undefined ? clone(a) : clone(b);
  const out = clone(a);
  for (const [k, v] of Object.entries(b)) {
    if (k === "__proto__" || k === "constructor") continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : clone(v);
  }
  return out;
}

// 鍵の道筋に使ってはいけない名前（オブジェクトの仕組みそのものを書き換えてしまう）
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** "stroke.width" のような道筋で読む（途中が無ければ undefined） */
export function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** "stroke.width" のような道筋で書く（途中が無ければ作る）。値は複製して入れる */
export function setPath(obj, path, value) {
  const keys = path.split(".");
  if (keys.some((k) => UNSAFE_KEYS.has(k))) return;
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] === null || typeof o[k] !== "object") o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = clone(value);
}

let uidCounter = 0;
export function uid(prefix = "el") {
  uidCounter = (uidCounter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}${uidCounter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** 描く前に既定値と重ねる（グループの中まで） */
export function normalizeElement(el) {
  const base = deepMerge(COMMON_DEFAULTS, TYPE_DEFAULTS[el.type] || {});
  const out = deepMerge(base, el);
  if (el.type === "group") out.children = (el.children || []).map(normalizeElement);
  return out;
}

/** 新しい要素を作る */
export function createElement(type, props = {}) {
  const el = deepMerge(deepMerge(COMMON_DEFAULTS, TYPE_DEFAULTS[type] || {}), props);
  el.id = uid(type);
  el.type = type;
  if (!el.name) el.name = TYPE_META[type]?.label || type;
  return el;
}

export function createScene({ name = "無題のデザイン", width = 1920, height = 1080 } = {}) {
  return { name, width, height, background: "transparent", elements: [], rules: [], meta: {} };
}

// ===============================
// 値の検査（描くときに使う。シーンは信用できる人が書くが、壊れていても描画を止めない）
// ===============================
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/deg]+\)|transparent)$/i;
export function safeColor(c, fallback = "transparent") {
  return typeof c === "string" && COLOR_RE.test(c.trim()) ? c.trim() : fallback;
}

/** 画像・音の URL。自分のサーバーの素材と http(s) だけ */
export function safeUrl(u) {
  if (typeof u !== "string") return "";
  const s = u.trim();
  if (/^\/studio-assets\/[^\s"'()\\]*$/.test(s)) return s;
  if (/^https?:\/\/[^\s"'()\\]+$/i.test(s)) return s;
  return "";
}

/** 動画の素材か（WebM・MP4）。それ以外は画像として描く */
export const isVideoUrl = (url) => /\.(webm|mp4)(\?|#|$)/i.test(String(url ?? ""));

export function safeFont(family) {
  if (typeof family !== "string") return "sans-serif";
  const f = family.replace(/[^\p{L}\p{N} _-]/gu, "").trim();
  return f || "sans-serif";
}

export function fontStack(family) {
  const f = safeFont(family);
  if (SYSTEM_FONTS.includes(f)) return f;
  return `"${f}", "Noto Sans JP", sans-serif`;
}

/** 塗りを CSS の背景にする */
export function cssPaint(paint, fallback = "transparent") {
  if (!paint || paint.type === "none") return "transparent";
  if (typeof paint === "string") return safeColor(paint, fallback);
  if (paint.type === "solid") return safeColor(paint.color, fallback);
  const stops = (paint.stops || [])
    .map((s) => `${safeColor(s.color, "#000")} ${Math.round(Math.min(1, Math.max(0, Number(s.offset) || 0)) * 100)}%`)
    .join(", ");
  if (!stops) return fallback;
  if (paint.type === "radial") return `radial-gradient(circle at center, ${stops})`;
  return `linear-gradient(${Number(paint.angle) || 0}deg, ${stops})`;
}

// ===============================
// 幾何
// ===============================
export function rotatePoint(px, py, cx, cy, deg) {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** 回転を含めた4隅（シーン座標） */
export function corners(el) {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  return [
    [el.x, el.y], [el.x + el.w, el.y], [el.x + el.w, el.y + el.h], [el.x, el.y + el.h],
  ].map(([x, y]) => rotatePoint(x, y, cx, cy, el.rotation || 0));
}

/** 回転を含めた外接矩形 */
export function aabb(el) {
  const pts = corners(el);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function unionBox(boxes) {
  if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const btm = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: btm - y };
}

/** グループの枠を中身に合わせ直す（グループ自身は回転を持たない） */
export function refreshGroup(group) {
  if (group.type !== "group" || !group.children?.length) return group;
  group.children.forEach(refreshGroup);
  const box = unionBox(group.children.map(aabb));
  group.x = box.x;
  group.y = box.y;
  group.w = Math.max(1, box.w);
  group.h = Math.max(1, box.h);
  group.rotation = 0;
  return group;
}

/** 要素とその中身を dx, dy だけ動かす */
export function translate(el, dx, dy) {
  el.x += dx;
  el.y += dy;
  if (el.type === "group") el.children.forEach((c) => translate(c, dx, dy));
}

/**
 * 要素を、基準点 (ax, ay) から sx, sy 倍する（グループは中身ごと）。
 * 回転している子は中心の位置だけ動かし、大きさは回転を無視して掛ける（近似）。
 */
export function scaleAbout(el, ax, ay, sx, sy) {
  if (el.type === "group") {
    el.children.forEach((c) => scaleAbout(c, ax, ay, sx, sy));
    refreshGroup(el);
    return;
  }
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const ncx = ax + (cx - ax) * sx;
  const ncy = ay + (cy - ay) * sy;
  const rot = ((el.rotation || 0) % 180 + 180) % 180;
  // 90°近く回っているものは幅と高さが入れ替わって見えるので、掛ける向きも入れ替える
  const swap = rot > 45 && rot < 135;
  const nw = Math.max(1, el.w * Math.abs(swap ? sy : sx));
  const nh = Math.max(1, el.h * Math.abs(swap ? sx : sy));
  el.x = ncx - nw / 2;
  el.y = ncy - nh / 2;
  el.w = nw;
  el.h = nh;
  if (el.type === "text" && el.font && Math.abs(sx - sy) < 1e-6) {
    el.font.size = Math.max(4, Math.round(el.font.size * Math.abs(sx) * 10) / 10);
  }
}

/** 要素を (cx, cy) を中心に deg だけ回す（グループは中身ごと） */
export function rotateAbout(el, cx, cy, deg) {
  if (el.type === "group") {
    el.children.forEach((c) => rotateAbout(c, cx, cy, deg));
    refreshGroup(el);
    return;
  }
  const c = rotatePoint(el.x + el.w / 2, el.y + el.h / 2, cx, cy, deg);
  el.x = c.x - el.w / 2;
  el.y = c.y - el.h / 2;
  el.rotation = normalizeAngle((el.rotation || 0) + deg);
}

export function normalizeAngle(deg) {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Math.round(d * 100) / 100;
}

// ===============================
// パス
// ===============================
/** ノード列を SVG の d 属性にする。ノードは {x, y, ix, iy, ox, oy}（ix/ox は制御点） */
export function pathData(nodes, closed) {
  if (!nodes?.length) return "";
  const n = (v) => Math.round(v * 100) / 100;
  let d = `M${n(nodes[0].x)} ${n(nodes[0].y)}`;
  const seg = (a, b) => {
    const ox = a.ox ?? a.x; const oy = a.oy ?? a.y;
    const ix = b.ix ?? b.x; const iy = b.iy ?? b.y;
    if (ox === a.x && oy === a.y && ix === b.x && iy === b.y) return ` L${n(b.x)} ${n(b.y)}`;
    return ` C${n(ox)} ${n(oy)} ${n(ix)} ${n(iy)} ${n(b.x)} ${n(b.y)}`;
  };
  for (let i = 1; i < nodes.length; i++) d += seg(nodes[i - 1], nodes[i]);
  if (closed && nodes.length > 2) d += `${seg(nodes[nodes.length - 1], nodes[0])} Z`;
  return d;
}

/** ノード（制御点込み）の外接矩形 */
export function nodesBounds(nodes) {
  const xs = [];
  const ys = [];
  for (const p of nodes) {
    xs.push(p.x, p.ix ?? p.x, p.ox ?? p.x);
    ys.push(p.y, p.iy ?? p.y, p.oy ?? p.y);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) };
}

/**
 * シーン座標のノードから path 要素を作る（ペン・鉛筆・直線ツールの仕上げ）。
 * ノードは枠の左上を原点に詰め直し、viewBox はその時の大きさにする。
 */
export function pathElementFromNodes(nodes, closed, props = {}) {
  const b = nodesBounds(nodes);
  const local = nodes.map((p) => ({
    x: p.x - b.x, y: p.y - b.y,
    ix: (p.ix ?? p.x) - b.x, iy: (p.iy ?? p.y) - b.y,
    ox: (p.ox ?? p.x) - b.x, oy: (p.oy ?? p.y) - b.y,
  }));
  return createElement("path", deepMerge({
    x: b.x, y: b.y, w: b.w, h: b.h,
    path: { w: b.w, h: b.h, nodes: local, closed },
  }, props));
}

/** 正多角形・星の頂点（枠 w×h に収める。0..1 ではなく実寸） */
export function polygonPoints(w, h, sides, star, innerRatio, inset = 0) {
  const n = Math.max(3, Math.min(60, Math.round(sides) || 3));
  const count = star ? n * 2 : n;
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    const r = star && i % 2 === 1 ? Math.min(0.95, Math.max(0.05, innerRatio)) : 1;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  // 単位円の上での実際の外接矩形を枠いっぱいに広げる（三角形が下に寄らないように）
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const iw = Math.max(1, w - inset * 2);
  const ih = Math.max(1, h - inset * 2);
  return pts.map(([x, y]) => [
    inset + ((x - minX) / (maxX - minX || 1)) * iw,
    inset + ((y - minY) / (maxY - minY || 1)) * ih,
  ]);
}

/** シーン内の要素を id で探す（グループの中まで）。親も返す */
export function findElement(elements, id, parent = null) {
  for (const el of elements) {
    if (el.id === id) return { el, parent, list: elements };
    if (el.type === "group") {
      const hit = findElement(el.children, id, el);
      if (hit) return hit;
    }
  }
  return null;
}

export function flatten(elements, out = []) {
  for (const el of elements) {
    out.push(el);
    if (el.type === "group") flatten(el.children, out);
  }
  return out;
}

/** 使っている Google Fonts を読み込む URL（無ければ null） */
export function googleFontsUrl(families) {
  const wanted = GOOGLE_FONTS.filter((f) => families.has(f.family));
  if (wanted.length === 0) return null;
  const parts = wanted.map((f) => {
    const name = f.family.replace(/ /g, "+");
    return f.weights ? `family=${name}:wght@${f.weights}` : `family=${name}`;
  });
  return `https://fonts.googleapis.com/css2?${parts.join("&")}&display=swap`;
}

/** シーンで使っているフォント名を集める */
export function collectFonts(scene) {
  const fonts = new Set();
  for (const el of flatten(scene.elements || [])) {
    if (el.font?.family) fonts.add(el.font.family);
    if (el.cfg?.fontFamily) fonts.add(el.cfg.fontFamily);
  }
  return fonts;
}
