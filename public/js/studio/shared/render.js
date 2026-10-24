// public/js/studio/shared/render.js
// シーンを DOM に描く。エディタ（/studio）とオーバーレイ（/overlay）が同じものを使うので、
// エディタで見た通りに OBS に映る。
//
// 要素1つの入れ子:
//   .sd-el     位置・大きさ・回転・不透明度・描画モード・フィルター
//    .sd-fx    アクションの動き（揺らす・跳ねる…）
//     .sd-enter 登場の動き
//      .sd-loop ループの動き（鼓動・浮遊…）
//       中身    図形の SVG / テキスト / 画像 / ウィジェット / グループの子
// 動きを層ごとに分けてあるのは、同時にかかっても打ち消し合わないため。
//
// 毎回まるごと作り直すと、ドラッグ中にちらついたりウィジェットの中身が消えたりする。
// 要素ごとに「中身の署名」を覚えておき、変わったものだけ中身を作り直す。
import {
  normalizeElement, safeColor, safeUrl, fontStack, cssPaint, pathData, polygonPoints, isWidget, isVideoUrl,
  googleFontsUrl, collectFonts,
} from "./model.js";
import { renderTemplate, hasTemplate } from "./template.js";
import { createWidget } from "./widgets.js";
import { ENTER_KEYFRAMES, ACTION_KEYFRAMES, play } from "./animations.js";

const SVG_NS = "http://www.w3.org/2000/svg";
let gradientSeq = 0;

function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  return n;
}

function div(cls) {
  const n = document.createElement("div");
  n.className = cls;
  return n;
}

/** 塗りを SVG の fill / stroke の値にする（グラデーションは defs に足す） */
function paintRef(defs, paint) {
  if (!paint || paint.type === "none") return "none";
  if (typeof paint === "string") return safeColor(paint, "none");
  if (paint.type === "solid") return safeColor(paint.color, "none");
  const id = `sdg${++gradientSeq}`;
  let g;
  if (paint.type === "radial") {
    g = svgEl("radialGradient", { id, cx: 0.5, cy: 0.5, r: 0.5 });
  } else {
    const a = ((Number(paint.angle) || 0) * Math.PI) / 180;
    const dx = Math.sin(a) / 2;
    const dy = -Math.cos(a) / 2;
    g = svgEl("linearGradient", { id, x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy });
  }
  for (const s of paint.stops || []) {
    g.appendChild(svgEl("stop", {
      offset: Math.min(1, Math.max(0, Number(s.offset) || 0)),
      "stop-color": safeColor(s.color, "#000000"),
    }));
  }
  defs.appendChild(g);
  return `url(#${id})`;
}

function dashArray(stroke) {
  const w = Math.max(1, stroke.width);
  if (stroke.dash === "dashed") return `${w * 3} ${w * 2}`;
  if (stroke.dash === "dotted") return `0.1 ${w * 2}`;
  return null;
}

function strokeAttrs(defs, stroke, extra = {}) {
  if (!stroke || !(stroke.width > 0)) return { stroke: "none" };
  return {
    stroke: paintRef(defs, stroke.paint ?? stroke.color),
    "stroke-width": stroke.width,
    "stroke-dasharray": dashArray(stroke),
    "stroke-linecap": stroke.dash === "dotted" ? "round" : stroke.cap || "round",
    "stroke-linejoin": stroke.join || "round",
    ...extra,
  };
}

function buildShape(el) {
  const svg = svgEl("svg", {
    class: "sd-svg", width: "100%", height: "100%", preserveAspectRatio: "none",
  });
  const defs = svgEl("defs");
  svg.appendChild(defs);
  const sw = el.stroke?.width > 0 ? el.stroke.width : 0;
  const fill = paintRef(defs, el.fill);
  const w = el.w;
  const h = el.h;

  if (el.type === "path") {
    const p = el.path || {};
    svg.setAttribute("viewBox", `0 0 ${Math.max(1, p.w || w)} ${Math.max(1, p.h || h)}`);
    svg.appendChild(svgEl("path", {
      d: pathData(p.nodes || [], p.closed),
      fill: p.closed ? fill : fill === "none" ? "none" : fill,
      "fill-rule": "evenodd",
      "vector-effect": "non-scaling-stroke",
      ...strokeAttrs(defs, el.stroke, { "vector-effect": "non-scaling-stroke" }),
    }));
    return svg;
  }

  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const inset = sw / 2;
  if (el.type === "rect") {
    const r = Math.max(0, Math.min(Number(el.radius) || 0, (w - sw) / 2, (h - sw) / 2));
    svg.appendChild(svgEl("rect", {
      x: inset, y: inset, width: Math.max(0, w - sw), height: Math.max(0, h - sw), rx: r, ry: r,
      fill, ...strokeAttrs(defs, el.stroke),
    }));
  } else if (el.type === "ellipse") {
    svg.appendChild(svgEl("ellipse", {
      cx: w / 2, cy: h / 2, rx: Math.max(0, (w - sw) / 2), ry: Math.max(0, (h - sw) / 2),
      fill, ...strokeAttrs(defs, el.stroke),
    }));
  } else if (el.type === "polygon") {
    const pts = polygonPoints(w, h, el.sides, el.star, el.innerRatio, inset);
    svg.appendChild(svgEl("polygon", {
      points: pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" "),
      fill, ...strokeAttrs(defs, el.stroke),
    }));
  }
  return svg;
}

const JUSTIFY = { left: "flex-start", center: "center", right: "flex-end", justify: "stretch" };
const ALIGN = { top: "flex-start", middle: "center", bottom: "flex-end" };

function buildText(el) {
  const box = div("sd-text");
  box.style.justifyContent = JUSTIFY[el.align] || "center";
  box.style.alignItems = ALIGN[el.vAlign] || "center";
  const inner = document.createElement("span");
  inner.className = "sd-text-inner";
  const f = el.font || {};
  inner.style.fontFamily = fontStack(f.family);
  inner.style.fontSize = `${Number(f.size) || 32}px`;
  inner.style.fontWeight = Number(f.weight) || 400;
  inner.style.fontStyle = f.italic ? "italic" : "normal";
  inner.style.letterSpacing = `${Number(el.letterSpacing) || 0}px`;
  inner.style.lineHeight = String(Number(el.lineHeight) || 1.2);
  inner.style.textAlign = el.align || "center";
  inner.style.textTransform = ["uppercase", "lowercase", "capitalize"].includes(el.textTransform) ? el.textTransform : "none";
  if (!el.fill || el.fill.type === "solid" || el.fill.type === "none") {
    inner.style.color = el.fill?.type === "none" ? "transparent" : safeColor(el.fill?.color, "#ffffff");
  } else {
    inner.style.backgroundImage = cssPaint(el.fill);
    inner.style.webkitBackgroundClip = "text";
    inner.style.backgroundClip = "text";
    inner.style.color = "transparent";
  }
  if (el.outline?.width > 0) {
    inner.style.webkitTextStroke = `${el.outline.width}px ${safeColor(el.outline.color, "#000000")}`;
    inner.style.paintOrder = "stroke fill";
  }
  box.appendChild(inner);
  return { box, inner };
}

function buildImage(el, mode) {
  const src = safeUrl(el.src);
  let n;
  if (!src) {
    n = div("sd-image-empty");
    if (mode !== "overlay") n.textContent = "画像を選択";
  } else if (isVideoUrl(src)) {
    n = document.createElement("video");
    n.src = src;
    n.autoplay = true;
    n.loop = true;
    n.muted = true;
    n.playsInline = true;
  } else {
    n = document.createElement("img");
    n.src = src;
    n.alt = "";
    n.draggable = false;
    n.referrerPolicy = "no-referrer";
  }
  n.classList.add("sd-image");
  n.style.objectFit = ["cover", "contain", "fill"].includes(el.fit) ? el.fit : "cover";
  n.style.borderRadius = `${Number(el.radius) || 0}px`;
  if (el.stroke?.width > 0) {
    n.style.border = `${el.stroke.width}px ${el.stroke.dash === "solid" ? "solid" : el.stroke.dash || "solid"} ${safeColor(el.stroke.paint?.color ?? el.stroke.color, "#ffffff")}`;
  }
  return n;
}

function filterCss(el) {
  const f = el.filters || {};
  const parts = [];
  if (f.blur > 0) parts.push(`blur(${f.blur}px)`);
  if (f.brightness !== undefined && f.brightness !== 100) parts.push(`brightness(${f.brightness}%)`);
  if (f.contrast !== undefined && f.contrast !== 100) parts.push(`contrast(${f.contrast}%)`);
  if (f.saturate !== undefined && f.saturate !== 100) parts.push(`saturate(${f.saturate}%)`);
  if (f.hue) parts.push(`hue-rotate(${f.hue}deg)`);
  if (f.grayscale > 0) parts.push(`grayscale(${f.grayscale}%)`);
  if (f.invert > 0) parts.push(`invert(${f.invert}%)`);
  const s = el.shadow;
  if (s?.enabled) parts.push(`drop-shadow(${Number(s.x) || 0}px ${Number(s.y) || 0}px ${Math.max(0, Number(s.blur) || 0)}px ${safeColor(s.color, "#00000099")})`);
  return parts.join(" ");
}

// 中身の作り直しが要るかを決める署名。位置だけの変更では作り直さない。
// 図形は viewBox が大きさに依存するので、大きさも署名に入れる。
const SIZE_DEPENDENT = new Set(["rect", "ellipse", "polygon", "danmaku"]);
const FRAME_KEYS = new Set([
  "x", "y", "rotation", "opacity", "visible", "locked", "name", "blend", "filters", "shadow", "children",
  "startHidden",
]);
function contentSignature(el) {
  const out = {};
  for (const [k, v] of Object.entries(el)) {
    if (FRAME_KEYS.has(k)) continue;
    if ((k === "w" || k === "h") && !SIZE_DEPENDENT.has(el.type)) continue;
    out[k] = v;
  }
  return JSON.stringify(out);
}

/**
 * シーンで使っている Google Fonts を読む。読み込みの link は1つだけ持ち、使うフォントが変わったら差し替える
 * （エディタとオーバーレイ。見本を並べる一覧は、全部のシーンのフォントをまとめて読む）。
 * @returns {(scene: object) => void}
 */
export function createFontLoader() {
  let link = null;
  return (scene) => {
    const url = googleFontsUrl(collectFonts(scene));
    if (!url) return;
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    if (link.getAttribute("href") !== url) link.setAttribute("href", url);
  };
}

/**
 * @param {HTMLElement} root シーンを描く入れ物（大きさはシーンに合わせて設定する）
 * @param {object} opts
 * @param {"editor"|"overlay"|"thumb"} opts.mode
 * @param {() => object} opts.getLive  ライブの値（runtime.js の live）
 * @param {() => object} opts.getCtx   テンプレートに差し込む値
 * @param {(url: string, volume?: number) => void} [opts.playSound]
 * @param {() => {enabled: boolean, volume: number}} [opts.getAudio] ギミックの効果音を鳴らしてよいか
 */
export function createRenderer(root, {
  mode = "overlay", getLive, getCtx, playSound = () => { }, getAudio = () => ({ enabled: mode !== "thumb", volume: 1 }),
}) {
  /** @type {Map<string, any>} */
  const nodes = new Map();
  const host = { mode, getLive, getCtx, playSound, getAudio };
  root.classList.add("sd-scene", `sd-mode-${mode}`);

  function destroyNode(n) {
    n.widget?.destroy?.();
    n.wrap.remove();
    nodes.delete(n.id);
  }

  function buildContent(n, el) {
    n.widget?.destroy?.();
    n.widget = null;
    n.textInner = null;
    n.template = null;
    // グループの子は中身の入れ物に入っているので、作り直しでは消さない
    if (el.type !== "group") n.loop.textContent = "";
    n.loop.className = "sd-loop";

    if (el.type === "text") {
      const { box, inner } = buildText(el);
      n.textInner = inner;
      n.template = String(el.text ?? "");
      n.loop.appendChild(box);
      setTextContent(n);
    } else if (el.type === "image") {
      n.loop.appendChild(buildImage(el, mode));
    } else if (isWidget(el.type)) {
      n.widget = createWidget(el, host);
      if (n.widget) n.loop.appendChild(n.widget.root);
    } else if (el.type !== "group") {
      n.loop.appendChild(buildShape(el));
    }

    const loop = el.anim?.loop;
    // 名前に空白などがあると classList.add が例外を投げて描画ごと止まるので、形を確かめる
    if (typeof loop === "string" && /^[a-z]+$/i.test(loop) && loop !== "none" && mode !== "thumb") {
      n.loop.classList.add(`sd-loop-${loop}`);
      n.loop.style.setProperty("--sd-loop-dur", `${Math.max(0.2, Number(el.anim.loopDuration) || 2)}s`);
    }
  }

  function setTextContent(n) {
    // エディタで直接編集している最中は書き換えない（打っている文字が消える）
    if (!n.textInner || n.textInner.isContentEditable) return;
    const text = n.override ?? n.template;
    n.textInner.textContent = hasTemplate(text) ? renderTemplate(text, getCtx()) : text;
  }

  function applyFrame(n, el, ox, oy) {
    const s = n.wrap.style;
    s.left = `${el.x - ox}px`;
    s.top = `${el.y - oy}px`;
    s.width = `${el.w}px`;
    s.height = `${el.h}px`;
    s.transform = el.rotation ? `rotate(${el.rotation}deg)` : "";
    s.opacity = String(el.opacity ?? 1);
    s.mixBlendMode = el.blend && el.blend !== "normal" ? el.blend : "";
    s.filter = filterCss(el);
    n.wrap.classList.toggle("sd-invisible", el.visible === false);
    n.wrap.classList.toggle("sd-off", !!n.hidden);
  }

  function ensureNode(raw, ox, oy, seen) {
    const el = normalizeElement(raw);
    seen.add(el.id);
    let n = nodes.get(el.id);
    if (n && n.type !== el.type) {
      destroyNode(n);
      n = null;
    }
    const isNew = !n;
    if (!n) {
      const wrap = div("sd-el");
      wrap.dataset.id = el.id;
      wrap.dataset.type = el.type;
      const fx = div("sd-fx");
      const enter = div("sd-enter");
      const loop = div("sd-loop");
      enter.appendChild(loop);
      fx.appendChild(enter);
      wrap.appendChild(fx);
      n = { id: el.id, type: el.type, wrap, fx, enter, loop, sig: null, hidden: false };
      // オーバーレイでは「最初は隠す」要素を、表示アクションが来るまで出さない
      if (mode === "overlay" && el.startHidden) n.hidden = true;
      nodes.set(el.id, n);
    }
    n.el = el;
    const sig = contentSignature(el);
    if (sig !== n.sig) {
      buildContent(n, el);
      n.sig = sig;
    }
    applyFrame(n, el, ox, oy);

    if (el.type === "group") syncList(n.loop, el.children || [], el.x, el.y, seen);

    if (isNew && mode === "overlay" && !n.hidden) playEnterNode(n);
    return n;
  }

  function syncList(container, elements, ox, oy, seen) {
    const wanted = elements.map((el) => ensureNode(el, ox, oy, seen).wrap);
    wanted.forEach((w, i) => {
      if (container.children[i] !== w) container.insertBefore(w, container.children[i] || null);
    });
    // この入れ物に残っている知らない要素（消された・別のグループに移った）を外す
    [...container.children].forEach((c) => {
      if (c.classList.contains("sd-el") && !wanted.includes(c)) c.remove();
    });
  }

  let currentScene = null;

  /** シーン全体を描く（変わったところだけ作り直す） */
  function render(scene) {
    currentScene = scene;
    root.style.width = `${scene.width}px`;
    root.style.height = `${scene.height}px`;
    const bg = safeColor(scene.background, "transparent");
    root.style.background = bg === "transparent" ? "" : bg;
    const seen = new Set();
    syncList(root, scene.elements || [], 0, 0, seen);
    for (const n of [...nodes.values()]) if (!seen.has(n.id)) destroyNode(n);
  }

  function playEnterNode(n) {
    const a = n.el?.anim;
    if (!a || !a.enter || a.enter === "none") return;
    play(n.enter, ENTER_KEYFRAMES[a.enter], {
      duration: Math.max(0.1, Number(a.enterDuration) || 0.8) * 1000,
      delay: Math.max(0, Number(a.enterDelay) || 0) * 1000,
      easing: "cubic-bezier(.2,.8,.2,1)",
      fill: "both",
    });
  }

  return {
    render,
    get scene() { return currentScene; },
    node: (id) => nodes.get(id),
    nodes,

    /** ライブの値が変わった・コメントが来た（ウィジェットとテンプレート入りの文字へ） */
    notify(kind, payload) {
      for (const n of nodes.values()) {
        if (n.widget) n.widget.notify?.(kind, payload);
        if ((kind === "vars" || kind === "reset") && n.textInner && hasTemplate(n.override ?? n.template)) setTextContent(n);
      }
    },

    playEnter(id) {
      const n = nodes.get(id);
      if (n) playEnterNode(n);
    },

    /** アクションの「要素を動かす」 */
    playAction(id, anim, seconds = 1, repeat = 1) {
      const n = nodes.get(id);
      if (!n || !ACTION_KEYFRAMES[anim]) return;
      play(n.fx, ACTION_KEYFRAMES[anim], {
        duration: Math.max(0.1, Number(seconds) || 1) * 1000,
        iterations: Math.max(1, Math.min(20, Number(repeat) || 1)),
        easing: "ease-in-out",
      });
    },

    /** アクションの「表示／非表示」 */
    setHidden(id, hidden) {
      const n = nodes.get(id);
      if (!n) return;
      const was = n.hidden;
      n.hidden = !!hidden;
      n.wrap.classList.toggle("sd-off", n.hidden);
      if (was && !n.hidden) playEnterNode(n);
    },

    isHidden: (id) => !!nodes.get(id)?.hidden,

    /** アクションの「文字を差し替え」（ms 後に戻す。0 なら戻さない） */
    setTextOverride(id, text, ms) {
      const n = nodes.get(id);
      if (!n?.textInner) return;
      n.override = text;
      setTextContent(n);
      clearTimeout(n.overrideTimer);
      if (ms > 0) {
        n.overrideTimer = setTimeout(() => {
          n.override = undefined;
          setTextContent(n);
        }, ms);
      }
    },

    destroy() {
      for (const n of [...nodes.values()]) destroyNode(n);
    },
  };
}
