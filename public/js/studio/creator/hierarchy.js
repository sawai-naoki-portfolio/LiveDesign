// public/js/studio/creator/hierarchy.js
// 左の「ヒエラルキー」（ステージのオブジェクトとプレハブ）と「アセット」（サウンド・エフェクト・変数）。
import { cstore, onC, change, selectC } from "./state.js";
import { h, openContextMenu, modal, toast } from "../editor/ui.js";
import {
  createObject, SHAPES, normalizeObject, normalizeSound, EFFECT_PRESETS, SOUND_DEFAULTS,
} from "../shared/gimmick/defaults.js";
import { playSynth, SOUND_PRESETS } from "../shared/gimmick/synth.js";
import { clone, uid } from "../shared/model.js";

const SHAPE_ICON = { rect: "▭", ellipse: "●", triangle: "▲", star: "★", text: "T", emoji: "☺", image: "🖼" };

/** オブジェクトを足す（ステージの真ん中に置く） */
function addObject(shape, props = {}) {
  const g = cstore.gimmick;
  const o = createObject(shape, props);
  o.x = Math.round((g.width - o.w) / 2);
  o.y = Math.round((g.height - o.h) / 2);
  change((gm) => { gm.objects.push(o); });
  selectC("object", o.id);
  return o;
}

function addSound(preset) {
  const s = { id: uid("snd"), ...clone(SOUND_DEFAULTS), ...(preset ? clone(preset.sound) : {}), name: preset ? preset.label.replace(/^\S+\s/, "") : "サウンド" };
  change((gm) => { gm.sounds.push(s); });
  selectC("sound", s.id);
  if (preset) playSynth(s, 1);
  return s;
}

function addEffect(preset) {
  const fx = { id: uid("fx"), ...(preset ? clone(preset.effect) : {}), name: preset ? preset.label.replace(/^\S+\s/, "") : "エフェクト" };
  change((gm) => { gm.effects.push(fx); });
  selectC("effect", fx.id);
  return fx;
}

async function addVariable(defaultName = "score") {
  const input = h("input", { type: "text", value: defaultName, placeholder: "score / スコア" });
  const kind = h("select", {}, h("option", { value: "number" }, "数"), h("option", { value: "text" }, "文字"));
  const ok = await modal("変数を作る", h("div", {},
    h("p", { class: "hint" }, "式の中では名前をそのまま（score + 1）、文字の中では {score} と書いて使います。英数字・日本語・_ が使えます。"),
    h("label", { class: "fld wide" }, h("span", { class: "fld-label" }, "名前"), input),
    h("label", { class: "fld wide" }, h("span", { class: "fld-label" }, "種類"), kind)), { okText: "作る" });
  if (!ok) return null;
  const name = input.value.trim();
  if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) || name.startsWith("__") || ["W", "H", "t", "time", "self", "other", "true", "false", "and", "or", "not", "constructor", "prototype"].includes(name)) {
    toast("名前は英数字・日本語・_ で（数字で始めない。W・H・time・self などは使えません）", "error");
    return null;
  }
  if (cstore.gimmick.variables.some((v) => v.name === name)) {
    toast("同じ名前の変数があります", "error");
    return null;
  }
  change((gm) => { gm.variables.push({ name, value: kind.value === "number" ? 0 : "", exposed: false, label: "" }); });
  selectC("variable", name);
  return name;
}

function objectMenu(at) {
  openContextMenu([
    ...SHAPES.map(([shape, label]) => ({ label: `${SHAPE_ICON[shape]}  ${label}`, run: () => addObject(shape) })),
    "-",
    { label: "📦 プレハブ（ボール。出すたびに複製）", run: () => addObject("ellipse", { name: "ボール", tag: "ball", prefab: true, body: { type: "dynamic", edges: "bounce" } }) },
    { label: "🧱 床", run: () => { const g = cstore.gimmick; const o = addObject("rect", { name: "床", tag: "floor", w: g.width, h: 30, look: { fill: "#ffffff33", radius: 0 }, body: { type: "static" } }); change((gm) => { const x = gm.objects.find((y) => y.id === o.id); x.x = 0; x.y = g.height - 30; }); } },
    { label: "🔢 スコア表示", run: () => addObject("text", { name: "スコア", look: { text: "SCORE {score}", font: "Orbitron", fontSize: 40 } }) },
  ], at);
}

function soundMenu(at) {
  openContextMenu([
    ...SOUND_PRESETS.map((p) => ({ label: p.label, run: () => addSound(p) })),
    "-",
    { label: "🎛 空の音から作る", run: () => addSound(null) },
    { label: "📁 素材の音（アップロードした MP3 など）", run: () => { const s = addSound(null); change((gm) => { const x = gm.sounds.find((y) => y.id === s.id); x.type = "file"; x.name = "素材の音"; }); } },
  ], at);
}

function effectMenu(at) {
  openContextMenu([
    ...EFFECT_PRESETS.map((p) => ({ label: p.label, run: () => addEffect(p) })),
    "-",
    { label: "✳ 空のエフェクトから作る", run: () => addEffect(null) },
  ], at);
}

const atBtn = (e) => {
  const b = e.currentTarget.getBoundingClientRect();
  return { x: b.left, y: b.bottom };
};

export function initHierarchy(panel, assetsPanel) {
  function row(type, id, icon, name, extra = [], { dim = false } = {}) {
    const selectedNow = cstore.selection?.type === type && cstore.selection.id === id;
    return h("div", {
      class: `cr-row${selectedNow ? " selected" : ""}${dim ? " dim" : ""}`,
      onclick: () => selectC(type, id),
      dataset: { type, id },
    }, h("span", { class: "cr-row-icon" }, icon), h("span", { class: "cr-row-name" }, name), ...extra);
  }

  function renderObjects() {
    const g = cstore.gimmick;
    panel.textContent = "";
    panel.appendChild(h("button", { type: "button", class: "btn primary block", onclick: (e) => objectMenu(atBtn(e)) }, "＋ オブジェクト"));
    const stageList = g.objects.filter((o) => !o.prefab).slice().reverse();
    const prefabs = g.objects.filter((o) => o.prefab);
    const objRow = (o) => {
      const n = normalizeObject(o);
      return row("object", o.id, SHAPE_ICON[n.look.shape] || "▭", n.name, [
        n.tag ? h("span", { class: "cr-tag" }, `#${n.tag}`) : null,
        n.body.type !== "none" ? h("span", { class: "cr-badge", title: "物理で動く" }, n.body.type === "static" ? "壁" : "物理") : null,
        h("button", {
          type: "button", class: "icon-btn cr-eye", title: n.hidden ? "最初は隠す（クリックで表示）" : "表示中（クリックで最初は隠す）",
          onclick: (e) => { e.stopPropagation(); change((gm) => { const x = gm.objects.find((y) => y.id === o.id); x.hidden = !n.hidden; }); },
        }, n.hidden ? "◌" : "👁"),
      ].filter(Boolean), { dim: n.hidden });
    };
    panel.appendChild(h("h3", { class: "cr-h3" }, "🎬 ステージ", h("span", { class: "cr-count" }, String(stageList.length))));
    if (!stageList.length) panel.appendChild(h("p", { class: "hint pad" }, "始めからステージにあるものを置きます"));
    stageList.forEach((o) => panel.appendChild(objRow(o)));
    panel.appendChild(h("h3", { class: "cr-h3", title: "最初は出さず、イベントの「オブジェクトを出す」で複製するもの" }, "📦 プレハブ", h("span", { class: "cr-count" }, String(prefabs.length))));
    if (!prefabs.length) panel.appendChild(h("p", { class: "hint pad" }, "ギフトで降らせるボールなど、イベントで何個も出すものはプレハブにします（インスペクターの「プレハブにする」）"));
    prefabs.forEach((o) => panel.appendChild(objRow(o)));
  }

  function renderAssets() {
    const g = cstore.gimmick;
    assetsPanel.textContent = "";
    const head = (title, onAdd, count) => h("div", { class: "cr-asset-head" },
      h("h3", { class: "cr-h3" }, title, h("span", { class: "cr-count" }, String(count))),
      h("button", { type: "button", class: "small-btn", onclick: onAdd }, "＋ 追加"));

    assetsPanel.appendChild(head("🔊 サウンド", (e) => soundMenu(atBtn(e)), g.sounds.length));
    if (!g.sounds.length) assetsPanel.appendChild(h("p", { class: "hint pad" }, "コイン・ジャンプ・爆発…の音を、ファイル無しでその場で作れます"));
    for (const s of g.sounds) {
      assetsPanel.appendChild(row("sound", s.id, s.type === "file" ? "📁" : "🎛", s.name, [
        h("button", {
          type: "button", class: "icon-btn", title: "試聴",
          onclick: (e) => {
            e.stopPropagation();
            const n = normalizeSound(s);
            if (n.type === "file") { try { new Audio(n.url).play().catch(() => { }); } catch (err) { /* 鳴らせない */ } } else playSynth(n, 1);
          },
        }, "▶"),
      ]));
    }

    assetsPanel.appendChild(head("✨ エフェクト", (e) => effectMenu(atBtn(e)), g.effects.length));
    if (!g.effects.length) assetsPanel.appendChild(h("p", { class: "hint pad" }, "爆発・キラキラ・花火などのパーティクルを作ります"));
    for (const fx of g.effects) assetsPanel.appendChild(row("effect", fx.id, "✨", fx.name));

    assetsPanel.appendChild(head("🔢 変数", () => addVariable(g.variables.some((v) => v.name === "score") ? "" : "score"), g.variables.length));
    if (!g.variables.length) assetsPanel.appendChild(h("p", { class: "hint pad" }, "スコア・残り時間・HP など、ゲームの中で覚えておく値"));
    for (const v of g.variables) {
      assetsPanel.appendChild(row("variable", v.name, typeof v.value === "number" ? "#" : "Aa", v.name, [
        h("span", { class: "cr-var-val" }, `= ${String(v.value).slice(0, 12)}`),
        v.exposed ? h("span", { class: "cr-badge", title: "アーティストモードで変えられる" }, "パラメーター") : null,
      ].filter(Boolean)));
    }
  }

  function render() {
    if (!cstore.gimmick) return;
    renderObjects();
    renderAssets();
  }

  onC((kind, detail) => {
    if (kind === "gimmick" && detail?.live) return; // ドラッグ中は作り直さない
    if (kind === "gimmick" || kind === "selection") render();
  });
  render();
  return { render };
}
