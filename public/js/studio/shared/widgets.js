// public/js/studio/shared/widgets.js
// 配信と連動するウィジェット（チャット・弾幕・アラート・ゴール・ランキング・最近のイベント・タイマー）と、
// クリエイターモードで作ったギミックを置く枠。
//
// 視聴者の名前・コメントは必ず textContent で入れる。innerHTML は使わない。
// エディタ（mode: "editor" / "thumb"）では、まだ何も届いていなくても形が分かるよう見本を出す。
import { safeColor, safeUrl, fontStack, cssPaint, isVideoUrl } from "./model.js";
import { renderTemplate, formatDuration, buildContext } from "./template.js";
import { ENTER_KEYFRAMES, EXIT_KEYFRAMES, play } from "./animations.js";
import { createPlayer } from "./gimmick/player.js";
import { getGimmick, onGimmick } from "./gimmick/registry.js";

const SAMPLE_USERS = ["さくら", "ゆうき", "タロウ", "hoshi", "ミク", "ryu_gamer"];
const SAMPLE_CHATS = [
  "こんばんは！", "今日も来たよ〜", "ナイスプレイ！", "GG!", "その武器強いね", "初見です！", "がんばれ〜",
  "かっこいい！",
].map((text, i) => ({ id: `s${i}`, type: "chat", text, user: { name: SAMPLE_USERS[i % SAMPLE_USERS.length], avatar: "" } }));
const SAMPLE_EVENTS = [
  { id: "e1", type: "follow", user: { name: "さくら" } },
  { id: "e2", type: "gift", user: { name: "ゆうき" }, gift: { name: "ローズ" }, count: 5, coins: 5 },
  { id: "e3", type: "share", user: { name: "タロウ" } },
  { id: "e4", type: "gift", user: { name: "hoshi" }, gift: { name: "ドーナツ" }, count: 1, coins: 30 },
  { id: "e5", type: "follow", user: { name: "ミク" } },
];
const SAMPLE_TOP = [
  { name: "さくら", coins: 12000 }, { name: "ゆうき", coins: 5400 }, { name: "タロウ", coins: 1200 },
  { name: "hoshi", coins: 300 }, { name: "ミク", coins: 99 },
];

function div(cls, text) {
  const n = document.createElement("div");
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** アイコン。読めない URL は頭文字の丸にする */
function avatarNode(url, name, size) {
  const safe = safeUrl(url);
  if (safe) {
    const img = document.createElement("img");
    img.className = "sd-avatar";
    img.src = safe;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.style.width = img.style.height = `${size}px`;
    img.addEventListener("error", () => img.replaceWith(avatarNode("", name, size)));
    return img;
  }
  const n = div("sd-avatar sd-avatar-letter", String(name || "?").slice(0, 1));
  n.style.width = n.style.height = `${size}px`;
  n.style.fontSize = `${Math.round(size * 0.5)}px`;
  return n;
}

function applyText(node, { family, size, color, weight, outline, outlineColor }) {
  if (family) node.style.fontFamily = fontStack(family);
  if (size) node.style.fontSize = `${size}px`;
  if (color) node.style.color = safeColor(color, "#ffffff");
  if (weight) node.style.fontWeight = weight;
  if (outline > 0) {
    node.style.webkitTextStroke = `${outline}px ${safeColor(outlineColor, "#000")}`;
    node.style.paintOrder = "stroke fill";
  }
}

const isPreview = (host) => host.mode !== "overlay";

// ===============================
// チャット
// ===============================
function chatWidget(el, host) {
  const cfg = el.cfg;
  const root = div("sd-w sd-chat");
  root.classList.toggle("newest-top", cfg.newest === "top");
  root.style.gap = `${cfg.gap}px`;
  applyText(root, { family: cfg.fontFamily, size: cfg.fontSize, color: cfg.textColor, outline: cfg.outline, outlineColor: "#000" });

  function messageNode(ev) {
    const msg = div("sd-chat-msg");
    msg.style.background = safeColor(cfg.bubble, "transparent");
    msg.style.borderRadius = `${cfg.radius}px`;
    if (cfg.showAvatar) msg.appendChild(avatarNode(ev.user?.avatar, ev.user?.name, Math.round(cfg.fontSize * 1.5)));
    const body = div("sd-chat-body");
    if (cfg.showName) {
      const name = div("sd-chat-name", ev.user?.name ?? "");
      name.style.color = safeColor(cfg.nameColor, "#ffd84d");
      body.appendChild(name);
    }
    body.appendChild(div("sd-chat-text", ev.text ?? ""));
    msg.appendChild(body);
    return msg;
  }

  function insert(node) {
    if (cfg.newest === "top") root.prepend(node);
    else root.appendChild(node);
    while (root.children.length > Math.max(1, cfg.limit)) {
      (cfg.newest === "top" ? root.lastChild : root.firstChild).remove();
    }
  }

  function rebuild() {
    root.textContent = "";
    let list = host.getLive().chats.slice(-cfg.limit);
    if (list.length === 0 && isPreview(host)) list = SAMPLE_CHATS.slice(0, cfg.limit);
    for (const ev of list) insert(messageNode(ev));
  }
  rebuild();

  return {
    root,
    notify(kind, ev) {
      if (kind === "reset") return rebuild();
      if (kind !== "chat") return;
      // エディタで見本を出していたところへ最初のコメントが来たら、見本を片付ける
      if (isPreview(host) && host.getLive().chats.length === 1) return rebuild();
      const node = messageNode(ev);
      insert(node);
      play(node, ENTER_KEYFRAMES.slideRight, { duration: 320, easing: "cubic-bezier(.2,.9,.3,1.2)" });
      if (cfg.fade > 0 && host.mode === "overlay") {
        setTimeout(() => {
          const a = play(node, EXIT_KEYFRAMES.fade, { duration: 400, fill: "forwards" });
          if (a) a.onfinish = () => node.remove(); else node.remove();
        }, cfg.fade * 1000);
      }
    },
  };
}

// ===============================
// 弾幕（ニコ生風に右から左へ流れる）
// ===============================
function danmakuWidget(el, host) {
  const cfg = el.cfg;
  const root = div("sd-w sd-danmaku");
  const lineH = cfg.fontSize * 1.3;
  const lanes = () => Math.max(1, Math.floor(el.h / lineH));
  const laneFree = [];

  function item(ev) {
    const n = div("sd-dm-item", cfg.showName ? `${ev.user?.name ?? ""}: ${ev.text ?? ""}` : ev.text ?? "");
    applyText(n, {
      family: cfg.fontFamily, size: cfg.fontSize, color: cfg.color, weight: cfg.weight,
      outline: cfg.outline, outlineColor: cfg.outlineColor,
    });
    return n;
  }

  function spawn(ev) {
    const now = performance.now();
    const count = lanes();
    let lane = 0;
    for (let i = 0; i < count; i++) {
      if ((laneFree[i] ?? 0) <= now) { lane = i; break; }
      if ((laneFree[i] ?? 0) < (laneFree[lane] ?? 0)) lane = i;
    }
    const n = item(ev);
    n.style.top = `${lane * lineH}px`;
    root.appendChild(n);
    const w = n.offsetWidth || cfg.fontSize * String(n.textContent).length;
    const duration = Math.max(2, cfg.speed) * 1000;
    // 後ろの弾幕に追いつかれないよう、自分の長さぶん流れ切るまでその段は空けない
    laneFree[lane] = now + duration * (w / (el.w + w)) + 150;
    const a = play(n, [
      { transform: `translateX(${el.w}px)` }, { transform: `translateX(${-w - 20}px)` },
    ], { duration, easing: "linear" });
    if (a) a.onfinish = () => n.remove();
    else setTimeout(() => n.remove(), duration);
    while (root.children.length > 80) root.firstChild.remove();
  }

  if (isPreview(host)) {
    SAMPLE_CHATS.slice(0, lanes()).forEach((ev, i) => {
      const n = item(ev);
      n.style.top = `${i * lineH}px`;
      n.style.left = `${((i * 37) % 60) + 5}%`;
      root.appendChild(n);
    });
  }

  return {
    root,
    notify(kind, ev) {
      if (kind !== "chat") return;
      if (isPreview(host) && !root.dataset.live) {
        root.dataset.live = "1";
        root.textContent = "";
      }
      spawn(ev);
    },
  };
}

// ===============================
// アラート
// ===============================
function mediaNode(url, size) {
  const safe = safeUrl(url);
  if (!safe) return null;
  let n;
  if (isVideoUrl(safe)) {
    n = document.createElement("video");
    n.src = safe;
    n.autoplay = true;
    n.playsInline = true;
    n.loop = false;
    n.play?.().catch(() => { n.muted = true; n.play?.().catch(() => { }); });
  } else {
    n = document.createElement("img");
    n.src = safe;
    n.alt = "";
    n.referrerPolicy = "no-referrer";
  }
  n.className = "sd-alert-media";
  n.style.maxHeight = `${size}px`;
  n.style.maxWidth = "100%";
  return n;
}

function alertWidget(el, host) {
  const cfg = el.cfg;
  const root = div("sd-w sd-alert");
  const queue = [];
  let busy = false;

  function build({ title, message, image }) {
    root.textContent = "";
    const box = div("sd-alert-box");
    if (cfg.showBox) {
      box.style.background = safeColor(cfg.bg, "transparent");
      box.style.borderRadius = `${cfg.radius}px`;
      box.style.borderColor = safeColor(cfg.accent, "transparent");
      box.classList.add("boxed");
    }
    const media = image ? mediaNode(image, cfg.imageSize) : null;
    if (media) box.appendChild(media);
    const t = div("sd-alert-title", title);
    applyText(t, { family: cfg.fontFamily, size: cfg.titleSize, color: cfg.titleColor, outline: cfg.outline, outlineColor: "#000" });
    const m = div("sd-alert-message", message);
    applyText(m, { family: cfg.fontFamily, size: cfg.messageSize, color: cfg.messageColor, outline: cfg.outline, outlineColor: "#000" });
    if (title) box.appendChild(t);
    if (message) box.appendChild(m);
    root.appendChild(box);
    return box;
  }

  function next() {
    const item = queue.shift();
    if (!item) {
      busy = false;
      // エディタでは見本に戻す（デザインを続けられるように）。配信画面では何も出さない
      if (isPreview(host)) return showSample();
      root.classList.add("sd-alert-idle");
      root.textContent = "";
      return;
    }
    busy = true;
    root.classList.remove("sd-alert-idle");
    const box = build(item);
    if (item.sound) host.playSound(item.sound, item.volume);
    play(box, ENTER_KEYFRAMES[item.enter || cfg.enter] || ENTER_KEYFRAMES.pop, {
      duration: 700, easing: "cubic-bezier(.2,.9,.3,1.1)", fill: "both",
    });
    const hold = Math.max(1, Math.min(60, Number(item.duration) || cfg.duration)) * 1000;
    setTimeout(() => {
      const a = play(box, EXIT_KEYFRAMES.fade, { duration: 450, fill: "forwards" });
      const done = () => setTimeout(next, 250);
      if (a) a.onfinish = done; else done();
    }, hold);
  }

  // エディタでは見本を出しておく（デザインを決めるため）
  function showSample() {
    const ctx = buildContext(host.getLive().vars, {
      type: "follow", user: { name: "サンプル視聴者" }, gift: { name: "ローズ" }, count: 1, coins: 1,
    });
    const img = cfg.image === "avatar" || cfg.image === "gift" ? "" : cfg.image;
    build({ title: renderTemplate(cfg.title, ctx), message: renderTemplate(cfg.message, ctx), image: img });
  }

  if (isPreview(host)) showSample();
  else root.classList.add("sd-alert-idle");

  return {
    root,
    /**
     * @param {{title: string, message: string, image?: string, sound?: string, volume?: number, duration?: number, enter?: string}} item
     *   title / message はテンプレートを差し込み済みの文字列
     */
    enqueue(item) {
      if (queue.length >= 30) queue.shift();
      queue.push(item);
      if (!busy) next();
    },
    notify() { },
  };
}

// ===============================
// ゴール
// ===============================
function sourceValue(vars, source) {
  const key = String(source || "likes");
  if (vars?.stats && Object.prototype.hasOwnProperty.call(vars.stats, key)) return Number(vars.stats[key]) || 0;
  if (vars?.counters && Object.prototype.hasOwnProperty.call(vars.counters, key)) return Number(vars.counters[key]) || 0;
  return 0;
}

function goalWidget(el, host) {
  const cfg = el.cfg;
  const root = div(`sd-w sd-goal shape-${cfg.shape === "ring" ? "ring" : "bar"}`);
  applyText(root, { family: cfg.fontFamily, size: cfg.fontSize, color: cfg.textColor });
  const label = div("sd-goal-label");
  const value = div("sd-goal-value");

  let fill;
  let arc;
  const R = 45;
  const C = 2 * Math.PI * R;
  if (cfg.shape === "ring") {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.classList.add("sd-goal-ring");
    const track = document.createElementNS(NS, "circle");
    const sw = Math.max(2, Math.min(30, cfg.thickness * 20));
    for (const [k, v] of Object.entries({ cx: 50, cy: 50, r: R, fill: "none", "stroke-width": sw })) track.setAttribute(k, v);
    track.setAttribute("stroke", safeColor(cfg.track, "#ffffff33"));
    arc = track.cloneNode();
    arc.setAttribute("stroke", safeColor(cfg.bar?.stops?.[0]?.color ?? cfg.bar?.color, "#ff5c8a"));
    arc.setAttribute("stroke-linecap", "round");
    arc.setAttribute("stroke-dasharray", `0 ${C}`);
    arc.setAttribute("transform", "rotate(-90 50 50)");
    svg.append(track, arc);
    const center = div("sd-goal-center");
    center.append(label, value);
    root.append(svg, center);
  } else {
    const head = div("sd-goal-head");
    head.append(label, value);
    const track = div("sd-goal-track");
    track.style.background = safeColor(cfg.track, "#ffffff26");
    track.style.borderRadius = `${cfg.radius}px`;
    track.style.height = `${Math.round(Math.max(0.1, Math.min(1, cfg.thickness)) * 100)}%`;
    fill = div("sd-goal-fill");
    fill.style.background = cssPaint(cfg.bar, "#ff5c8a");
    fill.style.borderRadius = `${cfg.radius}px`;
    track.appendChild(fill);
    root.append(head, track);
  }

  function update() {
    const vars = host.getLive().vars;
    const v = sourceValue(vars, cfg.source);
    const target = Math.max(1, Number(cfg.target) || 1);
    const pct = Math.min(1, v / target);
    const ctx = buildContext(vars);
    ctx.value = v;
    ctx.target = target;
    ctx.percent = `${Math.floor(pct * 100)}%`;
    const done = v >= target;
    label.textContent = done && cfg.doneText ? renderTemplate(cfg.doneText, ctx) : renderTemplate(cfg.label, ctx);
    value.textContent = renderTemplate(cfg.format, ctx);
    root.classList.toggle("done", done);
    if (fill) fill.style.width = `${pct * 100}%`;
    if (arc) arc.setAttribute("stroke-dasharray", `${pct * C} ${C}`);
  }
  update();
  return { root, notify(kind) { if (kind === "vars" || kind === "reset") update(); } };
}

// ===============================
// ランキング
// ===============================
function leaderboardWidget(el, host) {
  const cfg = el.cfg;
  const root = div("sd-w sd-board");
  root.style.background = safeColor(cfg.bg, "transparent");
  root.style.borderRadius = `${cfg.radius}px`;
  applyText(root, { family: cfg.fontFamily, size: cfg.fontSize, color: cfg.textColor });

  function update() {
    root.textContent = "";
    if (cfg.title) {
      const t = div("sd-board-title", cfg.title);
      t.style.color = safeColor(cfg.accent, "#ffc93c");
      root.appendChild(t);
    }
    let top = host.getLive().vars?.top || [];
    if (top.length === 0 && isPreview(host)) top = SAMPLE_TOP;
    top.slice(0, cfg.limit).forEach((s, i) => {
      const row = div(`sd-board-row rank-${i + 1}`);
      const rank = div("sd-board-rank", String(i + 1));
      rank.style.color = i === 0 ? safeColor(cfg.accent, "#ffc93c") : "";
      row.appendChild(rank);
      if (cfg.showAvatar) row.appendChild(avatarNode(s.avatar, s.name, Math.round(cfg.fontSize * 1.4)));
      row.appendChild(div("sd-board-name", s.name));
      row.appendChild(div("sd-board-coins", `${Number(s.coins).toLocaleString("ja-JP")}🪙`));
      root.appendChild(row);
    });
    if (top.length === 0) root.appendChild(div("sd-board-empty", "まだギフトはありません"));
  }
  update();
  return { root, notify(kind) { if (kind === "vars" || kind === "reset") update(); } };
}

// ===============================
// 最近のイベント
// ===============================
const EVENT_ICONS = { follow: "➕", gift: "🎁", share: "🔁", envelope: "🧧", join: "🚪" };

function eventsWidget(el, host) {
  const cfg = el.cfg;
  const types = String(cfg.types || "").split(",").map((s) => s.trim()).filter(Boolean);
  const root = div("sd-w sd-events");
  root.style.flexDirection = cfg.direction === "row" ? "row" : "column";
  applyText(root, { family: cfg.fontFamily, size: cfg.fontSize, color: cfg.textColor });

  function line(ev) {
    const tpl = cfg[`${ev.type}Text`] || "{user}";
    const ctx = buildContext(host.getLive().vars, ev);
    const row = div("sd-events-row");
    row.style.background = safeColor(cfg.bg, "transparent");
    row.style.borderRadius = `${cfg.radius}px`;
    row.appendChild(div("sd-events-icon", EVENT_ICONS[ev.type] || "✳️"));
    row.appendChild(div("sd-events-text", renderTemplate(tpl, ctx)));
    return row;
  }

  function rebuild() {
    root.textContent = "";
    let list = host.getLive().events.filter((e) => types.includes(e.type));
    if (list.length === 0 && isPreview(host)) list = SAMPLE_EVENTS.filter((e) => types.includes(e.type));
    list.slice(-cfg.limit).reverse().forEach((ev) => root.appendChild(line(ev)));
  }
  rebuild();

  return {
    root,
    notify(kind, ev) {
      if (kind === "reset") return rebuild();
      if (kind !== "event" || !types.includes(ev.type)) return;
      rebuild();
      const first = root.firstChild;
      if (first) play(first, ENTER_KEYFRAMES.slideRight, { duration: 400, easing: "ease-out" });
    },
  };
}

// ===============================
// タイマー
// ===============================
function timerWidget(el, host) {
  const cfg = el.cfg;
  const root = div("sd-w sd-timer");
  const label = div("sd-timer-label", cfg.label);
  const clock = div("sd-timer-clock");
  applyText(root, {
    family: cfg.fontFamily, size: cfg.fontSize, color: cfg.color, weight: cfg.weight,
    outline: cfg.outline, outlineColor: cfg.outlineColor,
  });
  if (cfg.label) {
    label.style.fontSize = `${Math.round(cfg.fontSize * 0.35)}px`;
    root.appendChild(label);
  }
  root.appendChild(clock);

  let ticker = null;
  function remaining() {
    const live = host.getLive();
    const t = live.vars?.timers?.[cfg.name];
    if (!t) return { ms: 0, running: false, known: false };
    const ms = t.running ? Math.max(0, t.remaining - (Date.now() - live.varsAt)) : t.remaining;
    return { ms, running: t.running && ms > 0, known: true };
  }
  function update() {
    const r = remaining();
    clock.textContent = r.known && r.ms === 0 && cfg.endText ? cfg.endText : formatDuration(r.ms, cfg.format);
    root.classList.toggle("running", r.running);
    if (r.running && !ticker && host.mode !== "thumb") ticker = setInterval(update, 250);
    if (!r.running && ticker) { clearInterval(ticker); ticker = null; }
  }
  update();
  return {
    root,
    notify(kind) { if (kind === "vars" || kind === "reset") update(); },
    destroy() { if (ticker) clearInterval(ticker); },
  };
}

// ===============================
// ギミック（クリエイターモードで作ったゲーム・エフェクト・サウンド）
// ===============================
function gimmickWidget(el, host) {
  const cfg = el.cfg;
  const root = div("sd-w sd-gimmick");
  let player = null;

  function start() {
    player?.destroy();
    player = null;
    root.textContent = "";
    const def = getGimmick(cfg.gimmickId);
    if (!def) {
      // 配信画面には何も出さない（エディタでだけ、置き場所が分かるようにする）
      if (isPreview(host)) root.appendChild(div("sd-gimmick-empty", cfg.gimmickId ? "ギミックが見つかりません（消されたかもしれません）" : "🎮 ギミックを選んでください"));
      return;
    }
    player = createPlayer(root, def, {
      mode: host.mode === "thumb" ? "thumb" : "play",
      overrides: Array.isArray(cfg.vars) ? cfg.vars : [],
      getAudio: host.getAudio,
      playUrl: (url, volume) => host.playSound(url, volume),
      // 配信画面（OBS）はクリックできないので、エディタの中でだけ試せるようにする
      clickable: host.mode === "editor",
    });
  }
  start();

  // クリエイターモードで保存されたら、その場で入れ替える（OBS を触らなくてよい）
  const off = onGimmick((id) => { if (id === cfg.gimmickId) start(); });

  return {
    root,
    notify(kind, ev) {
      if (kind === "live" && cfg.live !== false) player?.liveEvent(ev);
    },
    /** ルールの「🎮 ギミックに合図」 */
    signal(name, event, extra) {
      return player ? player.signal(String(name ?? ""), event, extra) : 0;
    },
    restart() { player?.restart(); },
    get player() { return player; },
    destroy() {
      off();
      player?.destroy();
    },
  };
}

const FACTORIES = {
  chat: chatWidget, danmaku: danmakuWidget, alert: alertWidget, goal: goalWidget,
  leaderboard: leaderboardWidget, events: eventsWidget, timer: timerWidget, gimmick: gimmickWidget,
};

/**
 * @param {object} el 既定値と重ねた要素
 * @param {{mode: string, getLive: () => object, playSound: (url: string, volume?: number) => void}} host
 */
export function createWidget(el, host) {
  const factory = FACTORIES[el.type];
  if (!factory) return null;
  return factory(el, host);
}
