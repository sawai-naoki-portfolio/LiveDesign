// public/js/studio/shared/runtime.js
// サーバーから届くスタジオのメッセージを、描いたシーンに反映する
// （オーバーレイが本番、エディタはプレビューとして同じものを使う）。
//
//   state / studioVars  … 差し込み値（{likes} など）・ゴール・ランキング・タイマー
//   studioEvent         … チャット・弾幕・最近のイベント
//   studioAction        … ルールが発火した（アラート・音・動き・パーティクル・読み上げ・ギミックに合図…）
//   studioGimmick       … クリエイターモードでギミックが保存された（置いてあるギミック枠が入れ替わる）
import { safeUrl } from "./model.js";
import { putGimmick, removeGimmick } from "./gimmick/registry.js";
import { renderTemplate, buildContext } from "./template.js";
import { burst } from "./particles.js";

const MAX_CHATS = 60;
const MAX_EVENTS = 40;
const MAX_SOUNDS = 8;

export function createLive() {
  return {
    vars: { stats: {}, counters: {}, timers: {}, top: [] },
    varsAt: Date.now(),
    chats: [],
    events: [],
  };
}

/**
 * @param {object} opts
 * @param {object} opts.live createLive() の戻り値
 * @param {() => object} opts.getRenderer
 * @param {() => object|null} opts.getScene いま描いているシーン
 * @param {() => HTMLElement} opts.getParticleLayer
 * @param {() => {enabled: boolean, volume: number}} [opts.getAudio]
 */
export function createRuntime({ live, getRenderer, getScene, getParticleLayer, getAudio = () => ({ enabled: true, volume: 1 }) }) {
  let playing = 0;

  function playSound(url, volume = 1) {
    const audio = getAudio();
    const src = safeUrl(url);
    if (!src || !audio.enabled || playing >= MAX_SOUNDS) return;
    try {
      const a = new Audio(src);
      a.volume = Math.max(0, Math.min(1, (Number(volume) || 1) * audio.volume));
      playing++;
      const done = () => { playing = Math.max(0, playing - 1); };
      a.addEventListener("ended", done, { once: true });
      a.addEventListener("error", done, { once: true });
      a.play().catch(done);
    } catch (e) { /* 鳴らせない環境 */ }
  }

  function speak(text, { lang = "ja-JP", rate = 1, pitch = 1, volume = 1 } = {}) {
    const audio = getAudio();
    if (!audio.enabled || typeof speechSynthesis === "undefined" || !text) return;
    // 読み上げ待ちが溜まりすぎたら古いものを捨てる（荒らしの長文連投で数分しゃべり続けないように）
    if (speechSynthesis.pending && speechSynthesis.speaking && live.ttsQueued > 5) {
      speechSynthesis.cancel();
      live.ttsQueued = 0;
    }
    const u = new SpeechSynthesisUtterance(String(text).slice(0, 200));
    u.lang = lang;
    u.rate = Math.max(0.3, Math.min(3, Number(rate) || 1));
    u.pitch = Math.max(0, Math.min(2, Number(pitch) || 1));
    u.volume = Math.max(0, Math.min(1, (Number(volume) || 1) * audio.volume));
    live.ttsQueued = (live.ttsQueued || 0) + 1;
    u.onend = () => { live.ttsQueued = Math.max(0, (live.ttsQueued || 1) - 1); };
    speechSynthesis.speak(u);
  }

  /** テンプレートに差し込む値（全体の値。イベントの値はアクションごとに足す） */
  function globalCtx() {
    return buildContext(live.vars, null, null, Date.now() - live.varsAt);
  }

  function findAlertNode(target) {
    const r = getRenderer();
    if (!r) return null;
    if (target) {
      const n = r.node(target);
      if (n?.widget?.enqueue) return n;
    }
    for (const n of r.nodes.values()) if (n.widget?.enqueue) return n;
    return null;
  }

  function pickImage(choice, cfgImage, event) {
    const v = choice ?? cfgImage;
    if (v === "avatar") return event?.user?.avatar || "";
    if (v === "gift") return event?.gift?.picture || "";
    if (v === "none" || !v) return "";
    return v;
  }

  function runAction(a, event, extra) {
    const r = getRenderer();
    const scene = getScene();
    if (!r || !scene) return;
    const ctx = buildContext(live.vars, event, extra, Date.now() - live.varsAt);
    switch (a.kind) {
      case "alert": {
        const n = findAlertNode(a.target);
        if (!n) return;
        const cfg = n.el.cfg || {};
        n.widget.enqueue({
          title: renderTemplate(a.title ?? cfg.title, ctx),
          message: renderTemplate(a.message ?? cfg.message, ctx),
          image: pickImage(a.image, cfg.image, event),
          sound: a.sound,
          volume: a.volume,
          duration: a.duration || cfg.duration,
          enter: a.enter,
        });
        break;
      }
      case "sound":
        playSound(a.url, a.volume);
        break;
      case "animate":
        r.playAction(a.target, a.animation || "shake", a.duration || 1, a.repeat || 1);
        break;
      case "visibility": {
        if (!a.target) return;
        const before = r.isHidden(a.target);
        const next = a.mode === "hide" ? true : a.mode === "toggle" ? !before : false;
        r.setHidden(a.target, next);
        if (a.duration > 0) setTimeout(() => r.setHidden(a.target, before), a.duration * 1000);
        break;
      }
      case "particles":
        burst(getParticleLayer(), a.preset || "confetti", {
          emoji: a.emoji,
          amount: a.amount,
          images: [event?.gift?.picture].filter(Boolean),
          width: scene.width,
          height: scene.height,
        });
        break;
      case "tts":
        speak(renderTemplate(a.text ?? "{user}さん、{comment}", ctx), a);
        break;
      case "text":
        if (a.target) r.setTextOverride(a.target, renderTemplate(a.text ?? "", ctx), (Number(a.duration) || 0) * 1000);
        break;
      case "gimmick": {
        // 宛先が無ければ、置いてある全部のギミックに送る（合図を受けるイベントが無いものは何もしない）
        const targets = a.target ? [r.node(a.target)] : [...r.nodes.values()].filter((n) => n.type === "gimmick");
        for (const n of targets) n?.widget?.signal?.(a.signal, event, extra);
        break;
      }
      default:
        break;
    }
  }

  function runActions(actions, event, extra) {
    for (const a of actions || []) {
      const delay = Math.max(0, Math.min(60, Number(a.delay) || 0));
      if (delay > 0) setTimeout(() => runAction(a, event, extra), delay * 1000);
      else runAction(a, event, extra);
    }
  }

  function handle(msg) {
    const r = getRenderer();
    switch (msg.type) {
      case "state": {
        const s = msg.studio;
        if (!s) return;
        live.vars = s.vars || live.vars;
        live.varsAt = Date.now();
        live.chats = (s.recentChats || []).slice(-MAX_CHATS);
        live.events = (s.recentEvents || []).slice(-MAX_EVENTS);
        r?.notify("reset");
        break;
      }
      case "studioVars":
        live.vars = msg.vars || live.vars;
        live.varsAt = Date.now();
        r?.notify("vars");
        break;
      case "studioEvent": {
        const ev = msg.event;
        if (!ev) return;
        // ギミックはいいね・入室も含めて全部受け取る（「❤️ いいねされたとき」など）
        r?.notify("live", ev);
        if (ev.type === "chat") {
          live.chats.push(ev);
          if (live.chats.length > MAX_CHATS) live.chats.shift();
          r?.notify("chat", ev);
        } else if (ev.type !== "like" && ev.type !== "join") {
          live.events.push(ev);
          if (live.events.length > MAX_EVENTS) live.events.shift();
          r?.notify("event", ev);
        }
        break;
      }
      case "studioAction":
        if (msg.sceneId !== getScene()?.id) return;
        runActions(msg.actions, msg.event, msg.extra);
        break;
      case "studioGimmick":
        putGimmick(msg.gimmick);
        break;
      case "studioGimmickDeleted":
        removeGimmick(msg.id);
        break;
      default:
        break;
    }
  }

  return { handle, playSound, globalCtx, runActions };
}
