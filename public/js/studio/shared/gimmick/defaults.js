// public/js/studio/shared/gimmick/defaults.js
// ギミックの部品（オブジェクト・エフェクト・サウンド・イベント）の既定値と、画面に出す名前。
// エンジン（world.js / player.js）とクリエイターモードのエディタの両方が使う。
//
// 保存されたギミックは「既定値と違うところ」だけでもよい。動かす前に normalize*() で重ねるので、
// あとから項目を足しても古いギミックが壊れない（アーティストモードの model.js と同じ考え方）。
import { deepMerge, uid } from "../model.js";
import { graphSignals } from "./nodes.js";

export const GIMMICK_KIND_LABELS = {
  game: "🎮 ゲーム",
  effect: "✨ エフェクト",
  sound: "🔊 サウンド",
  other: "🧩 その他",
};

// ===============================
// オブジェクト（Unity の GameObject にあたる）
// ===============================
export const SHAPES = [
  ["rect", "四角形"], ["ellipse", "円"], ["triangle", "三角形"], ["star", "星"],
  ["text", "文字"], ["emoji", "絵文字"], ["image", "画像"],
];

export const EDGE_MODES = [
  ["bounce", "跳ね返る"], ["stop", "止まる"], ["wrap", "反対側から出る"], ["destroy", "出たら消える"], ["none", "そのまま"],
];

export const BODY_TYPES = [
  ["none", "動かない（物理なし）"], ["dynamic", "物理で動く（重力・跳ね返り）"], ["static", "壁・床（ぶつかられる側）"],
];

export const MOTIONS = [
  ["none", "なし"], ["float", "ふわふわ"], ["pulse", "ドクドク"], ["swing", "ゆらゆら"], ["blink", "点滅"], ["shake", "ぶるぶる"],
];

const OBJECT_DEFAULTS = {
  name: "オブジェクト",
  tag: "",
  x: 0, y: 0, w: 80, h: 80, rotation: 0, opacity: 1,
  prefab: false,
  hidden: false,
  look: {
    shape: "rect",
    fill: "#7c5cff",
    stroke: "#ffffff",
    strokeWidth: 0,
    radius: 12,
    text: "テキスト",
    font: "Noto Sans JP",
    fontSize: 40,
    fontWeight: 800,
    textColor: "#ffffff",
    outline: 0,
    outlineColor: "#000000",
    emoji: "⭐",
    src: "",
    glow: 0,
    glowColor: "#ffffff",
  },
  body: {
    type: "none",
    vx: 0, vy: 0,
    gravity: 1,
    bounce: 0.6,
    friction: 0.5,
    drag: 0,
    spin: 0,
    edges: "none",
    solid: true,
  },
  motion: { type: "none", speed: 1, amount: 10 },
  life: 0,
  trail: "",
};

export function normalizeObject(o) {
  return deepMerge(OBJECT_DEFAULTS, o || {});
}

/** よく使う形からオブジェクトを作る */
export function createObject(shape = "rect", props = {}) {
  const base = {
    rect: { name: "四角形", w: 120, h: 80 },
    ellipse: { name: "ボール", w: 80, h: 80, look: { shape: "ellipse", fill: "#ff5c8a" } },
    triangle: { name: "三角形", w: 90, h: 80, look: { shape: "triangle", fill: "#ffc93c" } },
    star: { name: "星", w: 90, h: 90, look: { shape: "star", fill: "#ffd84d" } },
    text: { name: "文字", w: 360, h: 70, look: { shape: "text", text: "テキスト", fontSize: 44 } },
    emoji: { name: "絵文字", w: 90, h: 90, look: { shape: "emoji", emoji: "⭐" } },
    image: { name: "画像", w: 120, h: 120, look: { shape: "image", radius: 0 } },
  }[shape] || {};
  return deepMerge(deepMerge({ look: { shape } }, base), { ...props, id: uid("obj") });
}

// ===============================
// エフェクト（パーティクル。Unity の Particle System にあたる）
// ===============================
export const PARTICLE_SHAPES = [
  ["circle", "まる"], ["square", "しかく"], ["star", "星"], ["spark", "光の筋"], ["ring", "輪っか"],
  ["emoji", "絵文字"], ["image", "画像"],
];

const EFFECT_DEFAULTS = {
  name: "エフェクト",
  shape: "circle",
  emoji: "✨",
  src: "",
  colors: ["#ffffff", "#ffd84d", "#ff5c8a"],
  count: 40,
  duration: 0,
  rate: 60,
  speed: 420,
  speedVar: 0.6,
  angle: -90,
  spread: 360,
  gravity: 500,
  drag: 1,
  life: 1,
  lifeVar: 0.4,
  size: 14,
  sizeEnd: 0,
  spin: 0,
  fade: true,
  glow: 0,
  blend: "normal",
  areaW: 0,
  areaH: 0,
};

export function normalizeEffect(e) {
  return deepMerge(EFFECT_DEFAULTS, e || {});
}

export const EFFECT_PRESETS = [
  { key: "burst", label: "💥 爆発", effect: { shape: "circle", colors: ["#fff6c2", "#ffc93c", "#ff7a3c", "#ff3c3c"], count: 70, speed: 650, speedVar: 0.7, gravity: 300, drag: 2, life: 0.8, size: 16, sizeEnd: 2, glow: 12, blend: "lighter" } },
  { key: "sparkle", label: "✨ キラキラ", effect: { shape: "star", colors: ["#ffffff", "#fff2a8", "#a8f0ff"], count: 30, speed: 220, gravity: -40, drag: 1.5, life: 1.2, size: 18, sizeEnd: 0, spin: 360, glow: 10, blend: "lighter" } },
  { key: "fireworks", label: "🎆 花火", effect: { shape: "spark", colors: ["#ff5c8a", "#ffd84d", "#5cf2ff", "#9b6bff", "#5cff9d"], count: 120, speed: 520, speedVar: 0.25, gravity: 260, drag: 1.2, life: 1.6, lifeVar: 0.3, size: 5, sizeEnd: 1, glow: 14, blend: "lighter" } },
  { key: "confetti", label: "🎊 紙吹雪", effect: { shape: "square", colors: ["#ff5c8a", "#ffc93c", "#7c5cff", "#3ce0ff", "#5cff9d"], count: 90, speed: 700, speedVar: 0.5, angle: -90, spread: 70, gravity: 900, drag: 1.4, life: 2.4, size: 14, sizeEnd: 12, spin: 720, fade: true } },
  { key: "hearts", label: "💖 ハート", effect: { shape: "emoji", emoji: "💖 💗 💕", count: 24, speed: 260, angle: -90, spread: 60, gravity: -160, drag: 0.8, life: 2.2, size: 44, sizeEnd: 30 } },
  { key: "smoke", label: "💨 けむり", effect: { shape: "circle", colors: ["#ffffff55", "#cccccc44", "#99999933"], count: 0, duration: 1.5, rate: 50, speed: 80, angle: -90, spread: 50, gravity: -120, drag: 0.5, life: 1.8, size: 26, sizeEnd: 90 } },
  { key: "fire", label: "🔥 ほのお", effect: { shape: "circle", colors: ["#fff2a8", "#ffc93c", "#ff7a3c", "#ff3c3c00"], count: 0, duration: 2, rate: 120, speed: 160, angle: -90, spread: 30, gravity: -380, drag: 1, life: 0.7, size: 26, sizeEnd: 2, glow: 16, blend: "lighter", areaW: 30 } },
  { key: "shockwave", label: "◎ 衝撃波", effect: { shape: "ring", colors: ["#ffffff"], count: 3, speed: 0, speedVar: 0, gravity: 0, life: 0.6, lifeVar: 0.2, size: 10, sizeEnd: 320, glow: 10, blend: "lighter" } },
  { key: "snow", label: "❄ 雪", effect: { shape: "circle", colors: ["#ffffff"], count: 0, duration: 5, rate: 40, speed: 90, angle: 90, spread: 30, gravity: 30, drag: 0, life: 6, size: 8, sizeEnd: 8, glow: 6, areaW: 2000, areaH: 0 } },
  { key: "coins", label: "🪙 コインの噴水", effect: { shape: "emoji", emoji: "🪙", count: 30, speed: 900, speedVar: 0.4, angle: -90, spread: 50, gravity: 1800, drag: 0.2, life: 1.6, size: 48, sizeEnd: 48, spin: 540 } },
];

// ===============================
// サウンド
// ===============================
export const WAVES = [
  ["square", "ピコピコ（矩形波）"], ["triangle", "やわらか（三角波）"], ["sine", "まるい（正弦波）"],
  ["sawtooth", "ギザギザ（のこぎり波）"], ["noise", "ザー（ノイズ）"],
];

export const SOUND_DEFAULTS = {
  name: "サウンド",
  type: "synth",
  url: "",
  wave: "square",
  freq: 440,
  freqEnd: 880,
  duration: 0.3,
  attack: 0.005,
  sustain: 0.2,
  volume: 0.5,
  vibrato: 0,
  vibratoRate: 8,
  notes: "",
  noteLength: 0.12,
  filter: 0,
  repeat: 1,
};

export function normalizeSound(s) {
  return deepMerge(SOUND_DEFAULTS, s || {});
}

// ===============================
// ギミック
// ===============================
export function createBlankGimmick(kind = "other", name = "無題のギミック") {
  return {
    name, kind, description: "",
    width: 800, height: 600, background: "transparent", gravity: 1200,
    variables: [], objects: [], sounds: [], effects: [],
    graph: { nodes: [], links: [], comments: [] },
    functions: [],
  };
}

/** ギミックの中で、アーティストモードから送れる合図の名前（ブループリントの「合図を受けたとき」） */
export function signalNames(g) {
  return graphSignals(g?.graph);
}
