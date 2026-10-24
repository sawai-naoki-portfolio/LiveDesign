// public/js/studio/shared/particles.js
// パーティクルの演出（紙吹雪・ハート・スター・雪・絵文字の雨・ギフト画像の雨・花火）。
// 1回の演出で作る数と、同時に画面にある数の両方に上限を付ける
// （ギフトの連打で数千個たまると、OBS ごと重くなる）。
import { safeUrl } from "./model.js";
import { play } from "./animations.js";

const MAX_PER_BURST = 200;
const MAX_ALIVE = 600;
const CONFETTI_COLORS = ["#ff5c8a", "#ffc93c", "#7c5cff", "#3ce0ff", "#5cff9d", "#ffffff", "#ff8a3c"];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function spawn(layer, node, keyframes, opts) {
  if (layer.childElementCount >= MAX_ALIVE) return;
  node.classList.add("sd-particle");
  layer.appendChild(node);
  const a = play(node, keyframes, { fill: "forwards", ...opts });
  if (a) a.onfinish = () => node.remove();
  else setTimeout(() => node.remove(), (opts.duration || 2000) + (opts.delay || 0));
}

function glyph(text, size) {
  const n = document.createElement("div");
  n.textContent = text;
  n.style.fontSize = `${size}px`;
  return n;
}

function fall(layer, makeNode, count, W, H, { slow = false, spin = true } = {}) {
  for (let i = 0; i < count; i++) {
    const n = makeNode(i);
    const x = rand(0, W);
    const drift = rand(-W * 0.08, W * 0.08);
    const r = spin ? rand(-720, 720) : rand(-30, 30);
    spawn(layer, n, [
      { transform: `translate(${x}px, -80px) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${x + drift}px, ${H + 80}px) rotate(${r}deg)`, opacity: 0.9 },
    ], {
      duration: slow ? rand(5000, 9000) : rand(2200, 4200),
      delay: rand(0, slow ? 2500 : 700),
      easing: slow ? "linear" : "cubic-bezier(.3,.1,.7,1)",
    });
  }
}

function rise(layer, makeNode, count, W, H) {
  for (let i = 0; i < count; i++) {
    const n = makeNode(i);
    const x = rand(W * 0.05, W * 0.95);
    const sway = rand(-80, 80);
    spawn(layer, n, [
      { transform: `translate(${x}px, ${H + 40}px) scale(0.6)`, opacity: 0 },
      { transform: `translate(${x + sway}px, ${H * 0.6}px) scale(1)`, opacity: 1, offset: 0.3 },
      { transform: `translate(${x - sway}px, ${H * 0.1}px) scale(1.1)`, opacity: 0 },
    ], { duration: rand(2600, 4200), delay: rand(0, 900), easing: "ease-out" });
  }
}

function explode(layer, makeNode, count, cx, cy, radius) {
  for (let i = 0; i < count; i++) {
    const n = makeNode(i);
    const a = rand(0, Math.PI * 2);
    const d = rand(radius * 0.3, radius);
    spawn(layer, n, [
      { transform: `translate(${cx}px, ${cy}px) scale(0.2)`, opacity: 1 },
      { transform: `translate(${cx + Math.cos(a) * d}px, ${cy + Math.sin(a) * d}px) scale(1)`, opacity: 1, offset: 0.7 },
      { transform: `translate(${cx + Math.cos(a) * d * 1.1}px, ${cy + Math.sin(a) * d * 1.1 + 40}px) scale(0.8)`, opacity: 0 },
    ], { duration: rand(1100, 1800), easing: "cubic-bezier(.1,.8,.3,1)" });
  }
}

/**
 * @param {HTMLElement} layer シーンの上に重ねた入れ物
 * @param {string} preset
 * @param {{emoji?: string, amount?: number, images?: string[], width: number, height: number}} opts
 */
export function burst(layer, preset, { emoji = "🎉", amount = 60, images = [], width, height }) {
  const count = Math.max(1, Math.min(MAX_PER_BURST, Math.round(Number(amount) || 60)));
  const W = width;
  const H = height;
  const unit = Math.max(16, Math.min(W, H) / 22);

  switch (preset) {
    case "hearts":
      rise(layer, () => glyph(pick(["❤️", "💖", "💗", "💕", "💘"]), rand(unit, unit * 2)), count, W, H);
      break;
    case "stars":
      explode(layer, () => glyph(pick(["⭐", "✨", "🌟"]), rand(unit * 0.8, unit * 1.6)), count, W / 2, H / 2, Math.min(W, H) * 0.45);
      break;
    case "snow":
      fall(layer, () => {
        const n = document.createElement("div");
        const s = rand(4, 12);
        n.style.cssText = `width:${s}px;height:${s}px;border-radius:50%;background:#fff;box-shadow:0 0 6px #fff`;
        return n;
      }, count, W, H, { slow: true, spin: false });
      break;
    case "emoji": {
      const list = String(emoji || "🎉").split(/\s+/).filter(Boolean).slice(0, 10);
      fall(layer, () => glyph(pick(list.length ? list : ["🎉"]), rand(unit, unit * 2)), count, W, H, { spin: false });
      break;
    }
    case "giftRain": {
      const pics = images.map(safeUrl).filter(Boolean);
      fall(layer, () => {
        if (pics.length === 0) return glyph("🎁", rand(unit, unit * 2));
        const img = document.createElement("img");
        img.src = pick(pics);
        img.referrerPolicy = "no-referrer";
        const s = rand(unit * 1.5, unit * 3);
        img.style.width = img.style.height = `${s}px`;
        return img;
      }, count, W, H, { spin: false });
      break;
    }
    case "fireworks": {
      const shots = Math.max(1, Math.min(8, Math.round(count / 40)));
      for (let s = 0; s < shots; s++) {
        const color = pick(CONFETTI_COLORS);
        setTimeout(() => explode(layer, () => {
          const n = document.createElement("div");
          n.style.cssText = `width:8px;height:8px;border-radius:50%;background:${color};box-shadow:0 0 10px ${color}`;
          return n;
        }, Math.ceil(count / shots), rand(W * 0.2, W * 0.8), rand(H * 0.15, H * 0.5), Math.min(W, H) * 0.25), s * 350);
      }
      break;
    }
    default: // confetti
      fall(layer, () => {
        const n = document.createElement("div");
        n.style.cssText = `width:${rand(8, 14)}px;height:${rand(12, 22)}px;background:${pick(CONFETTI_COLORS)};border-radius:2px`;
        return n;
      }, count, W, H);
      break;
  }
}
