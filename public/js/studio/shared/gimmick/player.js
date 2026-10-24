// public/js/studio/shared/gimmick/player.js
// ギミックの世界（world.js）を <canvas> に描いて、毎フレーム進める。
// クリエイターモードのシーンビュー・アーティストモードのギミック枠・OBS のオーバーレイが同じものを使う。
//
//   mode: "play"  … 動かす（オーバーレイ・アーティストモード・クリエイターモードの再生中）
//         "edit"  … 止めて、置いたオブジェクトを並べるだけ（クリエイターモードの編集中。プレハブは半透明）
//         "thumb" … 一覧の見本（1回だけ描く）
import { createWorld, payloadFromEvent } from "./world.js";
import { playSynth } from "./synth.js";
import { safeColor, safeUrl, fontStack } from "../model.js";

const images = new Map();
function image(url, onload) {
  const src = safeUrl(url);
  if (!src) return null;
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.referrerPolicy = "no-referrer";
    img.decoding = "async";
    img.src = src;
    images.set(src, img);
    if (images.size > 300) images.delete(images.keys().next().value);
  }
  if (!img.complete && onload) img.addEventListener("load", onload, { once: true });
  return img.complete && img.naturalWidth ? img : null;
}

function starPath(ctx, w, h, points = 5, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 ? inner : 1;
    const x = (Math.cos(a) * r * w) / 2;
    const y = (Math.sin(a) * r * h) / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, rr);
  else ctx.rect(x, y, w, h);
}

/** ふわふわ・ドクドク…の見た目の動き（位置は変えない） */
function motionOf(e, t) {
  const m = e.motion || {};
  const sp = Math.max(0.05, Number(m.speed) || 1);
  const amt = Number(m.amount) || 10;
  const ph = t * sp * Math.PI * 2 + (e.phase || 0);
  switch (m.type) {
    case "float": return { dy: Math.sin(ph) * amt };
    case "pulse": return { s: 1 + Math.sin(ph) * (amt / 100) };
    case "swing": return { r: Math.sin(ph) * amt };
    case "blink": return { a: Math.sin(ph) > 0 ? 1 : 0.15 };
    case "shake": return { dx: Math.sin(ph * 7.3) * amt * 0.3, dy: Math.cos(ph * 9.1) * amt * 0.3 };
    default: return {};
  }
}

function drawEntity(ctx, world, e, { ghost = false, editing = false, redraw } = {}) {
  if (e.hidden && !editing) return;
  const L = e.look || {};
  const m = motionOf(e, world.time);
  const w = e.w;
  const h = e.h;
  ctx.save();
  ctx.translate(e.x + w / 2 + (m.dx || 0), e.y + h / 2 + (m.dy || 0));
  ctx.rotate((((e.rotation || 0) + (m.r || 0)) * Math.PI) / 180);
  const s = (e.scale ?? 1) * (m.s ?? 1);
  if (s !== 1) ctx.scale(s, s);
  ctx.globalAlpha = Math.max(0, Math.min(1, (e.opacity ?? 1) * (m.a ?? 1) * (ghost ? 0.4 : 1) * (e.hidden ? 0.5 : 1)));
  if (Number(L.glow) > 0) {
    ctx.shadowBlur = Number(L.glow);
    ctx.shadowColor = safeColor(world.colorOf(e, L.glowColor), "#ffffff");
  }
  const fill = safeColor(world.colorOf(e, L.fill), "transparent");
  const stroke = Number(L.strokeWidth) > 0 ? safeColor(world.colorOf(e, L.stroke), "#ffffff") : null;
  const paint = () => {
    if (fill !== "transparent") { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) {
      ctx.shadowBlur = 0;
      ctx.lineWidth = Number(L.strokeWidth);
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  };

  switch (L.shape) {
    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      paint();
      break;
    case "triangle":
      ctx.beginPath();
      ctx.moveTo(0, -h / 2);
      ctx.lineTo(w / 2, h / 2);
      ctx.lineTo(-w / 2, h / 2);
      ctx.closePath();
      paint();
      break;
    case "star":
      starPath(ctx, w, h);
      paint();
      break;
    case "text":
    case "emoji": {
      const isEmoji = L.shape === "emoji";
      const text = isEmoji ? String(world.colorOf(e, L.emoji) || "⭐") : world.textOf(e);
      const size = isEmoji ? Math.min(w, h) * 0.86 : Math.max(4, Number(L.fontSize) || 32);
      ctx.font = `${isEmoji ? 400 : Number(L.fontWeight) || 700} ${size}px ${isEmoji ? "system-ui, \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Noto Color Emoji\", sans-serif" : fontStack(L.font)}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = String(text).split("\n").slice(0, 20);
      const lh = size * 1.2;
      lines.forEach((line, i) => {
        const y = (i - (lines.length - 1) / 2) * lh;
        if (!isEmoji && Number(L.outline) > 0) {
          ctx.lineWidth = Number(L.outline) * 2;
          ctx.lineJoin = "round";
          ctx.strokeStyle = safeColor(L.outlineColor, "#000000");
          ctx.strokeText(line, 0, y, w * 1.5);
        }
        ctx.fillStyle = isEmoji ? "#000000" : safeColor(world.colorOf(e, L.textColor), "#ffffff");
        ctx.fillText(line, 0, y, isEmoji ? undefined : w * 1.5);
      });
      break;
    }
    case "image": {
      const img = image(L.src, redraw);
      const r = Number(L.radius) || 0;
      if (r > 0) {
        roundRect(ctx, -w / 2, -h / 2, w, h, r);
        ctx.clip();
      }
      if (img) {
        // 縦横比を保って枠に収める
        const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
        const iw = img.naturalWidth * k;
        const ih = img.naturalHeight * k;
        ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
      } else {
        ctx.fillStyle = "#ffffff22";
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = "#ffffff99";
        ctx.font = `${Math.min(w, h) * 0.4}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("🖼", 0, 0);
      }
      if (stroke) {
        roundRect(ctx, -w / 2, -h / 2, w, h, r);
        ctx.lineWidth = Number(L.strokeWidth);
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
      break;
    }
    default:
      roundRect(ctx, -w / 2, -h / 2, w, h, Number(L.radius) || 0);
      paint();
      break;
  }
  ctx.restore();
}

/**
 * 光（glow）の絵。色ごとに1回だけ放射グラデーションを描いて使い回す。
 * パーティクルに shadowBlur を使うと、数百個で OBS ごと重くなるため。
 */
const glowSprites = new Map();
function glowSprite(color) {
  let c = glowSprites.get(color);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(0.35, color);
  grad.addColorStop(1, "transparent");
  g.globalAlpha = 0.55;
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  if (glowSprites.size > 64) glowSprites.delete(glowSprites.keys().next().value);
  glowSprites.set(color, c);
  return c;
}

function drawParticle(ctx, p, redraw) {
  const k = Math.min(1, p.age / p.life);
  const size = Math.max(0.5, p.size0 + (p.size1 - p.size0) * k);
  ctx.save();
  ctx.globalCompositeOperation = p.blend;
  ctx.globalAlpha = p.fade ? 1 - k : 1;
  ctx.translate(p.x, p.y);
  const color = safeColor(p.color, "#ffffff");
  if (p.glow > 0 && p.shape !== "emoji" && p.shape !== "image") {
    const r = size / 2 + p.glow;
    ctx.drawImage(glowSprite(color), -r, -r, r * 2, r * 2);
  }
  ctx.rotate((p.rot * Math.PI) / 180);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  switch (p.shape) {
    case "square": ctx.fillRect(-size / 2, -size / 2, size, size * 0.6); break;
    case "star": starPath(ctx, size, size); ctx.fill(); break;
    case "spark": {
      const len = Math.max(size * 3, Math.hypot(p.vx, p.vy) * 0.05);
      ctx.rotate(Math.atan2(p.vy, p.vx) - (p.rot * Math.PI) / 180);
      ctx.fillRect(-len, -size / 2, len, size);
      break;
    }
    case "ring":
      ctx.lineWidth = Math.max(1, 6 * (1 - k));
      ctx.beginPath();
      ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "emoji":
      ctx.font = `${size}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#000";
      ctx.fillText(p.emoji, 0, 0);
      break;
    case "image": {
      const img = image(p.src, redraw);
      if (img) ctx.drawImage(img, -size / 2, -size / 2, size, size);
      break;
    }
    default:
      ctx.beginPath();
      ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
  ctx.restore();
}

/**
 * @param {HTMLElement} container 描く場所（中に canvas を1枚作る）
 * @param {object} def ギミック
 * @param {object} [opts]
 * @param {"play"|"edit"|"thumb"} [opts.mode]
 * @param {{name: string, value: any}[]} [opts.overrides]
 * @param {() => {enabled: boolean, volume: number}} [opts.getAudio]
 * @param {(url: string, volume: number) => void} [opts.playUrl] 素材の音（アーティストモードと同じ鳴らし方）
 * @param {(text: string, level: string) => void} [opts.onLog]
 * @param {(world: object) => void} [opts.onFrame] 描いたあと（エディタが選択枠を合わせる）
 * @param {(nodeId: string) => void} [opts.onTrace] ブループリントのノードが動いた（エディタで光らせる）
 * @param {boolean} [opts.clickable] 画面をクリックすると「クリックしたとき」が動く
 */
export function createPlayer(container, def, opts = {}) {
  const mode = opts.mode || "play";
  const getAudio = opts.getAudio || (() => ({ enabled: true, volume: 1 }));
  const canvas = document.createElement("canvas");
  canvas.className = "gm-canvas";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const world = createWorld(def, {
    overrides: opts.overrides,
    onLog: opts.onLog,
    onTrace: opts.onTrace,
    onSound(sound, volume) {
      const a = getAudio();
      if (!a.enabled) return;
      if (sound.type === "file") opts.playUrl?.(sound.url, (Number(sound.volume) || 1) * volume);
      else playSynth(sound, volume * (a.volume ?? 1));
    },
  });

  let raf = 0;
  let last = 0;
  let paused = false;
  let destroyed = false;
  let current = def;

  function size() {
    const W = world.W;
    const H = world.H;
    // 高精細の画面でも、描く画素数は 400 万まで（4K の大きさを2倍で描くと重すぎる）
    const dpr = Math.max(0.25, Math.min(2, globalThis.devicePixelRatio || 1, Math.sqrt(4e6 / (W * H))));
    const pw = Math.round(W * dpr);
    const ph = Math.round(H * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    return dpr;
  }

  const redraw = () => { if (!raf && !destroyed) draw(); };

  function draw() {
    const dpr = size();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, world.W, world.H);
    const bg = safeColor(current?.background, "transparent");
    if (bg !== "transparent") {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, world.W, world.H);
    }
    ctx.save();
    if (world.shake) {
      const k = Math.max(0, (world.shake.until - world.time) / world.shake.dur);
      const s = world.shake.strength * k;
      ctx.translate((Math.random() - 0.5) * 2 * s, (Math.random() - 0.5) * 2 * s);
    }
    const editing = mode === "edit";
    for (const e of world.entities) drawEntity(ctx, world, e, { ghost: editing && e.prefab, editing, redraw });
    for (const p of world.particles) drawParticle(ctx, p, redraw);
    ctx.restore();
    if (world.flash) {
      const k = 1 - (world.time - world.flash.t0) / world.flash.dur;
      ctx.globalAlpha = Math.max(0, Math.min(1, k)) * 0.85;
      ctx.fillStyle = safeColor(world.flash.color, "#ffffff");
      ctx.fillRect(0, 0, world.W, world.H);
      ctx.globalAlpha = 1;
    }
    opts.onFrame?.(world);
  }

  let detachedSince = 0;
  function frame(now) {
    raf = 0;
    if (destroyed) return;
    // 画面から外された（プロパティを作り直した・要素を消した）まま 2 秒経ったら止める。
    // 止め忘れたプレビューが裏で回り続けて重くならないように
    if (!canvas.isConnected) {
      detachedSince ||= now;
      if (now - detachedSince > 2000) { destroyed = true; return; }
    } else detachedSince = 0;
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    if (!paused) world.step(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function loop() {
    if (raf || destroyed) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function halt() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function begin() {
    if (mode === "play") {
      world.start();
      loop();
    } else if (mode === "edit") {
      world.preview(); // プレハブも半透明で並べる
      draw();
    } else {
      world.reset(); // 見本は、始めにステージにあるものだけ
      draw();
    }
  }

  if (opts.clickable !== false && mode === "play") {
    canvas.addEventListener("pointerdown", (ev) => {
      const r = canvas.getBoundingClientRect();
      // object-fit: contain で縦横比を保って描いているので、余白を引いて座標を戻す
      const k = Math.min(r.width / world.W, r.height / world.H) || 1;
      const ox = (r.width - world.W * k) / 2;
      const oy = (r.height - world.H * k) / 2;
      world.click((ev.clientX - r.left - ox) / k, (ev.clientY - r.top - oy) / k);
    });
  }

  begin();

  return {
    canvas,
    world,
    get mode() { return mode; },
    get paused() { return paused; },
    /** 合図を送る（アーティストモードのルールの「ギミックに合図」） */
    signal(name, event, extra) {
      if (mode !== "play") return 0;
      return world.signal(name, event ? payloadFromEvent(event, extra) : {});
    },
    /** 配信のイベント（ギフト・コメント・いいね…）をそのまま渡す */
    liveEvent(ev) {
      if (mode === "play") world.liveEvent(ev);
    },
    restart() { begin(); },
    setPaused(v) { paused = !!v; },
    /** 1フレームだけ進める（一時停止中のコマ送り） */
    stepOnce(dt = 1 / 60) {
      world.step(dt);
      draw();
    },
    /** 中身が変わった（再生中ならやり直す。編集中はそのまま描き直す） */
    setDef(next, { restart = true } = {}) {
      current = next;
      world.load(next);
      if (mode === "play") { if (restart) begin(); } else begin();
    },
    draw,
    destroy() {
      destroyed = true;
      halt();
      canvas.remove();
    },
  };
}
