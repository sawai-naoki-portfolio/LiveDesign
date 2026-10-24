// public/js/studio/shared/gimmick/world.js
// ギミックの「世界」：オブジェクト・物理・当たり判定・変数・パーティクルの計算。
// 何をするかはブループリント（graph.js がノードのつながりを実行する）が決め、世界はそのための手段を持つ。
//
// 画面には触らない（描くのは player.js）。だから Node のテストでもそのまま動かせる。
// 1フレームごとに step(dt) を呼ぶと、物理を進め、ぶつかり・画面の端などを調べてブループリントを動かす。
//
// 配信中に止まらないことを一番に考える：
//   ・オブジェクト・パーティクルの数に上限を付ける（ギフトの連打で増え続けないように）
//   ・見つからないサウンドやエフェクトは飛ばすだけ（コンソールに理由を出す）
import { evalExpr, interpolate } from "./expr.js";
import { normalizeObject, normalizeEffect, normalizeSound } from "./defaults.js";
import { createGraphRuntime } from "./graph.js";
import { clone } from "../model.js";

const MAX_ENTITIES = 400;
const MAX_PARTICLES = 2500;
const MAX_EMITTERS = 80;
const MAX_SPAWN_PER_NODE = 60;

const lower = (s) => String(s ?? "").normalize("NFKC").trim().toLowerCase();
const tagsOf = (s) => String(s ?? "").split(/[\s,、]+/).map(lower).filter(Boolean);
const finite = (v) => v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v));

/** タグの絞り込み。空ならどれでも。「ball, coin」のように複数書ける */
function hasTag(e, want) {
  const ws = tagsOf(want);
  if (!ws.length) return true;
  const mine = tagsOf(e.tag);
  return ws.some((w) => mine.includes(w));
}

/** 配信のイベント（サーバーの studioEvent）から、ノードや式で読める値を取り出す */
export function payloadFromEvent(ev, extra = {}) {
  if (!ev) return { ...extra };
  return {
    user: String(ev.user?.name ?? ""),
    avatar: String(ev.user?.avatar ?? ""),
    gift: String(ev.gift?.name ?? ""),
    giftImage: String(ev.gift?.picture ?? ""),
    count: Number(ev.count ?? ev.likes ?? 1) || 1,
    coins: Number(ev.coins) || 0,
    comment: String(ev.text ?? ""),
    likes: Number(ev.likes) || 0,
    args: String(extra?.args ?? ""),
    type: String(ev.type ?? ""),
  };
}

/** コメントがコマンドに当たるか（lib/studio/rules.js の matchCommand と同じ決まり） */
export function matchCommand(text, keyword) {
  // 全角の「！」「１」も半角と同じに読む
  const t = String(text ?? "").normalize("NFKC").trim();
  const k = String(keyword ?? "").normalize("NFKC").trim();
  if (!k) return null;
  if (t.toLowerCase() === k.toLowerCase()) return "";
  if (t.toLowerCase().startsWith(k.toLowerCase()) && /\s/.test(t.charAt(k.length))) return t.slice(k.length).trim();
  return null;
}

/**
 * @param {object} def ギミック（保存されている形）
 * @param {object} [opts]
 * @param {{name: string, value: any}[]} [opts.overrides] アーティストモードで変えた変数の初めの値
 * @param {() => number} [opts.random]
 * @param {(sound: object, volume: number) => void} [opts.onSound]
 * @param {(text: string, level?: "info"|"warn"|"error") => void} [opts.onLog]
 * @param {(nodeId: string) => void} [opts.onTrace] ノードが動いた（エディタで光らせる）
 */
export function createWorld(def, opts = {}) {
  const random = opts.random || Math.random;
  const onSound = opts.onSound || (() => { });
  const onLog = opts.onLog || (() => { });

  let g = def;
  let sounds = new Map();
  let effects = new Map();

  const world = {
    get def() { return g; },
    W: 800,
    H: 600,
    time: 0,
    vars: Object.create(null),
    /** @type {object[]} */
    entities: [],
    particles: [],
    emitters: [],
    shake: null,
    flash: null,
    running: false,
    seq: 0,
  };

  let contacts = new Set();
  let edgeContacts = new Set();
  let restartRequested = false;
  let warned = new Set();

  function warnOnce(key, text) {
    if (warned.has(key)) return;
    warned.add(key);
    onLog(text, "warn");
  }

  // ===============================
  // 式・文字の差し込みで読める名前
  // ===============================
  function view(e) {
    if (!e) return null;
    return {
      x: e.x, y: e.y, w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2,
      vx: e.vx, vy: e.vy, rotation: e.rotation, opacity: e.opacity, scale: e.scale,
      tag: e.tag, name: e.name, text: e.look.text, age: world.time - e.bornAt,
      user: e.data?.user ?? "", count: e.data?.count ?? 0, coins: e.data?.coins ?? 0,
    };
  }

  /** @param {object} ctx {payload, self, other}  @param {Record<string, () => any>} [extra] 式ノードの a・b・c */
  function scopeFor(ctx = {}, extra = null) {
    const p = ctx.payload || {};
    return {
      random,
      count: (tag) => world.entities.reduce((n, e) => n + (!e.dead && hasTag(e, tag) ? 1 : 0), 0),
      get(name) {
        if (extra && Object.prototype.hasOwnProperty.call(extra, name)) return extra[name]();
        if (name === "self") return view(ctx.self);
        if (name === "other") return view(ctx.other);
        if (name === "W") return world.W;
        if (name === "H") return world.H;
        if (name === "time" || name === "t") return world.time;
        if (Object.prototype.hasOwnProperty.call(world.vars, name)) return world.vars[name];
        if (Object.prototype.hasOwnProperty.call(p, name)) return p[name];
        // オブジェクトの持っている値（出したときのイベントの人など）
        const own = ctx.self?.data;
        if (own && Object.prototype.hasOwnProperty.call(own, name)) return own[name];
        return undefined;
      },
    };
  }

  // ===============================
  // オブジェクト
  // ===============================
  function makeEntity(src, props = {}) {
    const o = normalizeObject(src);
    return {
      uid: ++world.seq,
      srcId: src.id,
      name: o.name,
      tag: o.tag,
      x: o.x, y: o.y, w: o.w, h: o.h,
      rotation: o.rotation,
      opacity: o.opacity,
      scale: 1,
      hidden: !!o.hidden,
      look: clone(o.look),
      body: clone(o.body),
      motion: clone(o.motion),
      vx: Number(o.body.vx) || 0,
      vy: Number(o.body.vy) || 0,
      life: Number(o.life) || 0,
      trail: o.trail || "",
      trailAcc: 0,
      bornAt: world.time,
      data: {},
      dead: false,
      tween: null,
      phase: random() * Math.PI * 2,
      prefab: !!o.prefab,
      ...props,
    };
  }

  const alive = () => world.entities.filter((e) => !e.dead);

  function addEntity(e) {
    if (world.entities.length >= MAX_ENTITIES) {
      // 古いものから消して場所を空ける（ずっと貯まっていくゲームでも止まらない）
      const victim = world.entities.find((x) => !x.dead);
      if (victim) victim.dead = true;
      world.entities = world.entities.filter((x) => !x.dead);
      warnOnce("max-entities", `オブジェクトが ${MAX_ENTITIES} 個を超えたので、古いものから消しています`);
    }
    world.entities.push(e);
    return e;
  }

  function spawnPosition(at, x, y, o) {
    const W = world.W;
    const H = world.H;
    switch (at) {
      case "randomTop": return { x: random() * Math.max(0, W - o.w), y: -o.h };
      case "randomBottom": return { x: random() * Math.max(0, W - o.w), y: H };
      case "randomLeft": return { x: -o.w, y: random() * Math.max(0, H - o.h) };
      case "randomRight": return { x: W, y: random() * Math.max(0, H - o.h) };
      case "random": return { x: random() * Math.max(0, W - o.w), y: random() * Math.max(0, H - o.h) };
      case "center": return { x: (W - o.w) / 2, y: (H - o.h) / 2 };
      case "xy": return { x: (Number(x) || 0) - o.w / 2, y: (Number(y) || 0) - o.h / 2 };
      default: return { x: o.x, y: o.y };
    }
  }

  /** プレハブを出す（graph.js の「オブジェクトを出す」から） */
  function spawn(prefabId, o, X) {
    const src = (g.objects || []).find((x) => x.id === prefabId);
    if (!src) {
      warnOnce(`spawn:${prefabId}`, "「オブジェクトを出す」の出すものが選ばれていません（消されたかもしれません）");
      return [];
    }
    const base = normalizeObject(src);
    const n = Math.max(0, Math.min(MAX_SPAWN_PER_NODE, Math.round(Number(o.count) || 0)));
    const made = [];
    for (let i = 0; i < n; i++) {
      const pos = spawnPosition(o.at, o.x, o.y, base);
      const e = makeEntity(src, { x: pos.x, y: pos.y, prefab: false, hidden: false });
      // 出したときのイベントの値を覚えておく（文字の {user} がその人の名前になる）
      e.data = { ...(X?.payload || {}), index: i };
      if (finite(o.vx)) e.vx = Number(o.vx);
      if (finite(o.vy)) e.vy = Number(o.vy);
      if (o.text) e.look.text = String(o.text);
      if (o.image) { e.look.shape = "image"; e.look.src = String(o.image); }
      addEntity(e);
      made.push(e);
    }
    // 「オブジェクトが出てきたとき」
    for (const node of graph.ofType("event.spawned")) {
      if (node.values?.object !== prefabId) continue;
      made.forEach((e, i) => graph.fire(node, { self: e, index: i }, { payload: e.data, self: e, depth: X?.depth || 0 }));
    }
    return made;
  }

  function kill(e, effectId) {
    if (!e || e.dead) return;
    if (effectId) playEffect(effectId, e.x + e.w / 2, e.y + e.h / 2);
    e.dead = true;
  }

  // ===============================
  // パーティクル
  // ===============================
  function emitParticles(fx, x, y, n, follow) {
    const colors = Array.isArray(fx.colors) && fx.colors.length ? fx.colors : ["#ffffff"];
    const emojis = String(fx.emoji || "✨").split(/\s+/).filter(Boolean);
    for (let i = 0; i < n; i++) {
      if (world.particles.length >= MAX_PARTICLES) {
        warnOnce("max-particles", `パーティクルが ${MAX_PARTICLES} 個を超えたので、出すのを控えています`);
        return;
      }
      const ang = ((Number(fx.angle) || 0) + (random() - 0.5) * (Number(fx.spread) || 0)) * (Math.PI / 180);
      const sp = (Number(fx.speed) || 0) * (1 - (Number(fx.speedVar) || 0) * random());
      const life = Math.max(0.05, (Number(fx.life) || 1) * (1 - (Number(fx.lifeVar) || 0) * random()));
      const ax = (Number(fx.areaW) || 0) * (random() - 0.5);
      const ay = (Number(fx.areaH) || 0) * (random() - 0.5);
      world.particles.push({
        x: x + ax, y: y + ay,
        vx: Math.cos(ang) * sp + (follow ? (follow.vx || 0) * 0.2 : 0),
        vy: Math.sin(ang) * sp + (follow ? (follow.vy || 0) * 0.2 : 0),
        age: 0, life,
        size0: Number(fx.size) || 10,
        size1: fx.sizeEnd === undefined ? Number(fx.size) || 10 : Number(fx.sizeEnd) || 0,
        color: colors[Math.floor(random() * colors.length)],
        rot: random() * 360,
        spin: (Number(fx.spin) || 0) * (random() < 0.5 ? -1 : 1) * (0.5 + random() * 0.5),
        gravity: Number(fx.gravity) || 0,
        drag: Math.max(0, Number(fx.drag) || 0),
        fade: fx.fade !== false,
        shape: fx.shape,
        emoji: emojis[Math.floor(random() * emojis.length)] || "✨",
        src: fx.src || "",
        glow: Number(fx.glow) || 0,
        blend: fx.blend === "lighter" ? "lighter" : "source-over",
      });
    }
  }

  /** エフェクトを出す。duration が 0 なら一度に count 個、あれば duration 秒のあいだ rate 個/秒 */
  function playEffect(id, x, y, follow = null) {
    const fx = effects.get(id);
    if (!fx) {
      if (id) warnOnce(`fx:${id}`, "エフェクトが見つかりません（消されたかもしれません）");
      else warnOnce("fx:none", "「エフェクトを出す」のエフェクトが選ばれていません");
      return;
    }
    if (Number(fx.duration) > 0) {
      if (world.emitters.length >= MAX_EMITTERS) world.emitters.shift();
      world.emitters.push({ fx, x, y, follow, until: world.time + Number(fx.duration), acc: 0 });
      if (Number(fx.count) > 0) emitParticles(fx, x, y, Math.min(500, Number(fx.count)), follow);
    } else {
      emitParticles(fx, x, y, Math.max(1, Math.min(500, Math.round(Number(fx.count) || 1))), follow);
    }
  }

  // ===============================
  // 変数
  // ===============================
  function initialVars() {
    const out = Object.create(null); // 変数の名前で、オブジェクトの仕組み（__proto__ など）に触れないように
    for (const v of g.variables || []) out[v.name] = v.value;
    for (const o of opts.overrides || []) {
      const known = (g.variables || []).find((v) => v.name === o.name && v.exposed);
      if (known) out[o.name] = typeof known.value === "number" ? Number(o.value) || 0 : String(o.value ?? "");
    }
    return out;
  }

  function getVar(name) {
    const k = String(name ?? "");
    return Object.prototype.hasOwnProperty.call(world.vars, k) ? world.vars[k] : 0;
  }

  function setVar(name, v) {
    const k = String(name ?? "").trim();
    if (!k) {
      warnOnce("var:none", "変数のノードで、変数が選ばれていません");
      return v;
    }
    const known = (g.variables || []).find((x) => x.name === k);
    // 数の変数には数を、文字の変数には文字を入れる（種類が混ざって計算が壊れないように）
    const value = known && typeof known.value === "number" ? Number(v) || 0 : known ? String(v ?? "") : v;
    world.vars[k] = value;
    return value;
  }

  // ===============================
  // ブループリント
  // ===============================
  // graph.js から世界を動かす手段（ノードはこれだけを使う）
  const core = {
    random,
    get time() { return world.time; },
    get W() { return world.W; },
    get H() { return world.H; },
    warnOnce,
    spawn,
    kill,
    withTag: (tag) => alive().filter((e) => hasTag(e, tag)),
    instanceOf: (objectId) => alive().find((e) => e.srcId === objectId) || null,
    tween(e, x, y, seconds) {
      e.tween = { fx: e.x, fy: e.y, tx: x, ty: y, t0: world.time, dur: Math.max(0.01, Number(seconds) || 0.5) };
      e.vx = 0;
      e.vy = 0;
    },
    playSound(id, volume) {
      const s = sounds.get(id);
      if (s) onSound(s, volume);
      else warnOnce(`snd:${id}`, id ? "サウンドが見つかりません（消されたかもしれません）" : "「音を鳴らす」のサウンドが選ばれていません");
    },
    playEffect: (id, x, y) => playEffect(id, x, y),
    shake(strength, seconds) {
      const d = Math.max(0.05, Number(seconds) || 0.3);
      world.shake = { strength: Math.max(0, Math.min(200, Number(strength) || 10)), until: world.time + d, dur: d };
    },
    flash(color, seconds) {
      world.flash = { color: String(color || "#ffffff"), t0: world.time, dur: Math.max(0.05, Number(seconds) || 0.3) };
    },
    restart() { restartRequested = true; },
    getVar,
    setVar,
    scope: (X, extra) => scopeFor(X, extra),
    format: (text, X) => interpolate(text, scopeFor(X)),
    matchCommand,
  };
  const graph = createGraphRuntime(core, { onLog, onTrace: opts.onTrace });

  function load(next) {
    g = next || {};
    world.W = Math.max(16, Number(g.width) || 800);
    world.H = Math.max(16, Number(g.height) || 600);
    sounds = new Map((g.sounds || []).map((s) => [s.id, normalizeSound(s)]));
    effects = new Map((g.effects || []).map((e) => [e.id, normalizeEffect(e)]));
    graph.load(g);
  }
  load(def);

  // ===============================
  // 外からのきっかけ
  // ===============================
  /** 合図（アーティストモードのルール・コンソールのボタン）。動いたイベントの数を返す */
  function signal(name, payload = {}) {
    if (!world.running) return 0;
    return graph.signal(name, payload, 0);
  }

  /** 配信のイベント（ギフト・コメント・いいね…） */
  function liveEvent(ev, extra) {
    if (!world.running || !ev?.type) return;
    graph.live(ev, payloadFromEvent(ev, extra));
  }

  /** クリック（エディタの再生中・タップできる画面） */
  function click(x, y) {
    if (!world.running) return;
    const hits = alive().filter((e) => !e.hidden && x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h);
    const top = hits[hits.length - 1] || null;
    for (const node of graph.ofType("event.click")) {
      const tag = node.values?.tag;
      const hit = tag ? [...hits].reverse().find((e) => hasTag(e, tag)) : top;
      if (tag && !hit) continue;
      graph.fire(node, { self: hit || null, x, y }, { payload: { ...(hit?.data || {}), x, y }, self: hit || null });
    }
  }

  // ===============================
  // 進める
  // ===============================
  function reset() {
    load(g);
    graph.reset();
    world.time = 0;
    world.vars = initialVars();
    world.entities = [];
    world.particles = [];
    world.emitters = [];
    world.shake = null;
    world.flash = null;
    contacts = new Set();
    edgeContacts = new Set();
    restartRequested = false;
    warned = new Set();
    for (const o of g.objects || []) {
      if (!o.prefab) addEntity(makeEntity(o));
    }
  }

  /** 最初から始める（「ゲームが始まったとき」を動かす） */
  function start({ fireStart = true } = {}) {
    reset();
    world.running = true;
    if (fireStart) graph.start();
  }

  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /** ぶつかったら押し戻して跳ね返す（四角どうしの簡単な物理） */
  function resolve(a, b) {
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox <= 0 || oy <= 0) return;
    const aDyn = a.body.type === "dynamic";
    const bDyn = b.body.type === "dynamic";
    const share = aDyn && bDyn ? 0.5 : 1;
    const bounce = Math.max(Number(a.body.bounce) || 0, Number(b.body.bounce) || 0);
    if (ox < oy) {
      const dir = a.x + a.w / 2 < b.x + b.w / 2 ? -1 : 1;
      if (aDyn) a.x += dir * ox * share;
      if (bDyn) b.x -= dir * ox * share;
      if (aDyn && bDyn) {
        const va = a.vx;
        a.vx = b.vx * bounce;
        b.vx = va * bounce;
      } else if (aDyn) {
        if (a.vx * dir < 0) a.vx = -a.vx * bounce;
      } else if (bDyn && b.vx * -dir < 0) b.vx = -b.vx * bounce;
    } else {
      const dir = a.y + a.h / 2 < b.y + b.h / 2 ? -1 : 1;
      if (aDyn) a.y += dir * oy * share;
      if (bDyn) b.y -= dir * oy * share;
      if (aDyn && bDyn) {
        const va = a.vy;
        a.vy = b.vy * bounce;
        b.vy = va * bounce;
      } else if (aDyn) {
        if (a.vy * dir < 0) a.vy = Math.abs(a.vy) < 60 ? 0 : -a.vy * bounce;
        if (dir < 0) a.vx *= 1 - Math.min(1, (Number(a.body.friction) || 0) * 0.15);
      } else if (bDyn) {
        if (b.vy * -dir < 0) b.vy = Math.abs(b.vy) < 60 ? 0 : -b.vy * bounce;
        if (dir > 0) b.vx *= 1 - Math.min(1, (Number(b.body.friction) || 0) * 0.15);
      }
    }
  }

  function edges(e, dt) {
    const mode = e.body.edges;
    const W = world.W;
    const H = world.H;
    const bounce = Number(e.body.bounce) || 0;
    const touch = { left: e.x <= 0, right: e.x + e.w >= W, top: e.y <= 0, bottom: e.y + e.h >= H };
    if (mode === "bounce" || mode === "stop") {
      const k = mode === "bounce" ? bounce : 0;
      // 画面の外から入ってくるもの（上から落ちてくる・横から出てくる）は通す
      if (e.x < 0 && e.vx < 0) { e.x = 0; e.vx = -e.vx * k; }
      if (e.x + e.w > W && e.vx > 0) { e.x = W - e.w; e.vx = -e.vx * k; }
      if (e.y < 0 && e.vy < 0) { e.y = 0; e.vy = -e.vy * k; }
      if (e.y + e.h > H && e.vy >= 0) {
        e.y = H - e.h;
        e.vy = Math.abs(e.vy) < 60 ? 0 : -e.vy * k;
        e.vx *= 1 - Math.min(1, (Number(e.body.friction) || 0) * dt * 3);
      }
    } else if (mode === "wrap") {
      if (e.x > W) e.x = -e.w;
      else if (e.x + e.w < 0) e.x = W;
      if (e.y > H) e.y = -e.h;
      else if (e.y + e.h < 0) e.y = H;
    } else if (mode === "destroy") {
      const out = e.x > W || e.x + e.w < 0 || e.y > H || e.y + e.h < 0;
      // 出てきた直後（外から入ってくる途中）は消さない
      if (out && world.time - e.bornAt > 0.3 && !(e.vy > 0 && e.y < 0) && !(e.vy < 0 && e.y > H) && !(e.vx > 0 && e.x < 0) && !(e.vx < 0 && e.x > W)) kill(e);
    } else if (Math.abs(e.x) > W * 4 + 2000 || Math.abs(e.y) > H * 4 + 2000) {
      kill(e); // 遠くへ行ってしまったものは片付ける
    }
    return touch;
  }

  function step(dtRaw) {
    if (!world.running) return;
    const dt = Math.max(0, Math.min(0.1, Number(dtRaw) || 0));
    world.time += dt;

    // 待っていた続き・タイマー・毎フレーム・条件
    graph.tick(dt);

    // 動き
    const grav = Number(g.gravity ?? 1200);
    for (const e of world.entities) {
      if (e.dead) continue;
      if (e.tween) {
        const tw = e.tween;
        const k = Math.min(1, (world.time - tw.t0) / tw.dur);
        const ease = 1 - (1 - k) ** 3;
        e.x = tw.fx + (tw.tx - tw.fx) * ease;
        e.y = tw.fy + (tw.ty - tw.fy) * ease;
        if (k >= 1) e.tween = null;
      } else {
        if (e.body.type === "dynamic") e.vy += grav * (Number(e.body.gravity) || 0) * dt;
        const drag = Number(e.body.drag) || 0;
        if (drag > 0) {
          const f = Math.max(0, 1 - drag * dt);
          e.vx *= f;
          e.vy *= f;
        }
        e.x += e.vx * dt;
        e.y += e.vy * dt;
      }
      e.rotation += (Number(e.body.spin) || 0) * dt;
      if (e.life > 0 && world.time - e.bornAt >= e.life) kill(e);
    }

    // ぶつかり（物理）
    const list = alive();
    const solids = list.filter((e) => e.body.solid !== false && e.body.type !== "none" && !e.hidden);
    for (let i = 0; i < solids.length; i++) {
      for (let j = i + 1; j < solids.length; j++) {
        const a = solids[i];
        const b = solids[j];
        if (a.body.type !== "dynamic" && b.body.type !== "dynamic") continue;
        if (overlaps(a, b)) resolve(a, b);
      }
    }

    // 画面の端（触れた瞬間に1回だけ）
    const edgeNodes = graph.ofType("event.edge");
    const nextEdge = new Set();
    for (const e of list) {
      const touch = edges(e, dt);
      for (const node of edgeNodes) {
        if (e.dead || !hasTag(e, node.values?.tag)) continue;
        const side = node.values?.side || "any";
        const hit = side === "any" ? touch.left || touch.right || touch.top || touch.bottom : touch[side];
        if (!hit) continue;
        const key = `${node.id}:${e.uid}`;
        nextEdge.add(key);
        if (!edgeContacts.has(key)) graph.fire(node, { self: e }, { payload: { ...e.data }, self: e });
      }
    }
    edgeContacts = nextEdge;

    // ぶつかったとき（触れた瞬間に1回だけ）
    const collideNodes = graph.ofType("event.collide");
    if (collideNodes.length) {
      const nextContacts = new Set();
      const shown = alive().filter((e) => !e.hidden);
      for (const node of collideNodes) {
        const as = shown.filter((e) => hasTag(e, node.values?.a));
        const bs = shown.filter((e) => hasTag(e, node.values?.b));
        for (const a of as) {
          for (const b of bs) {
            if (a === b || a.dead || b.dead) continue;
            // 少しだけ広げて調べる（押し戻したあとでも「触れている」と分かるように）
            const grow = 1;
            const touching = a.x - grow < b.x + b.w && a.x + a.w + grow > b.x && a.y - grow < b.y + b.h && a.y + a.h + grow > b.y;
            if (!touching) continue;
            const key = `${node.id}:${a.uid}:${b.uid}`;
            nextContacts.add(key);
            if (!contacts.has(key)) graph.fire(node, { self: a, other: b }, { payload: { ...a.data }, self: a, other: b });
          }
        }
      }
      contacts = nextContacts;
    }

    // オブジェクトの尾（ずっと出し続けるエフェクト）
    for (const e of alive()) {
      if (!e.trail || e.hidden) continue;
      const fx = effects.get(e.trail);
      if (!fx) continue;
      e.trailAcc += dt * Math.max(1, Number(fx.rate) || 30);
      const n = Math.floor(e.trailAcc);
      e.trailAcc -= n;
      if (n > 0) emitParticles(fx, e.x + e.w / 2, e.y + e.h / 2, Math.min(50, n), e);
    }

    // エミッター
    world.emitters = world.emitters.filter((m) => {
      if (world.time > m.until) return false;
      const x = m.follow && !m.follow.dead ? m.follow.x + m.follow.w / 2 : m.x;
      const y = m.follow && !m.follow.dead ? m.follow.y + m.follow.h / 2 : m.y;
      m.acc += dt * Math.max(1, Number(m.fx.rate) || 30);
      const n = Math.floor(m.acc);
      m.acc -= n;
      if (n > 0) emitParticles(m.fx, x, y, Math.min(100, n), null);
      return true;
    });

    // パーティクル
    for (const p of world.particles) {
      p.age += dt;
      p.vy += p.gravity * dt;
      if (p.drag > 0) {
        const f = Math.max(0, 1 - p.drag * dt);
        p.vx *= f;
        p.vy *= f;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
    world.particles = world.particles.filter((p) => p.age < p.life);

    if (world.shake && world.time > world.shake.until) world.shake = null;
    if (world.flash && world.time > world.flash.t0 + world.flash.dur) world.flash = null;

    world.entities = world.entities.filter((e) => !e.dead);

    if (restartRequested) start();
  }

  /** エディタで止めているときの表示用（プレハブも半透明で並べる） */
  function preview() {
    reset();
    world.running = false;
    world.entities = (g.objects || []).map((o) => makeEntity(o));
  }

  Object.assign(world, {
    load(next) { load(next); },
    start,
    step,
    stop() { world.running = false; },
    reset,
    preview,
    signal,
    liveEvent,
    click,
    playEffect,
    scopeFor,
    /** ブループリントの「今すぐ動かす」（再生中だけ） */
    fireNode(id, payload = {}) {
      if (!world.running) return false;
      return graph.fireById(id, payload);
    },
    /** 描くときの文字（{user} などをその場で計算） */
    textOf: (e) => interpolate(e.look.text, scopeFor({ self: e, payload: e.data })),
    colorOf: (e, c) => (String(c ?? "").includes("{") ? interpolate(c, scopeFor({ self: e, payload: e.data })) : c),
    evaluate: (src) => evalExpr(src, scopeFor({})),
  });
  // Object.assign は getter を値として写してしまうので、別に定義する
  Object.defineProperty(world, "pendingCount", { get: () => graph.pendingCount });
  return world;
}
