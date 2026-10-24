// public/js/studio/creator/graph.js
// 真ん中の「🧩 ブループリント」：ノードをつないでプログラミングする画面（Unreal Engine の Blueprint エディタにならう）。
//
//   右クリック・ダブルクリック … ノードを探して置く（パレット）
//   ピンをドラッグ           … つなぐ（何も無い所で離すと、つなげるノードだけのパレットが出る）
//   Alt+クリック（ピン・線） … 線を外す
//   ドラッグ（何も無い所）   … 範囲選択   右ドラッグ・中ドラッグ・スペース＋ドラッグ … 画面を動かす
//   ホイール                 … 拡大縮小
//   Delete 削除・Ctrl+C / Ctrl+V / Ctrl+D コピー・貼り付け・複製・F 全体を表示
//
// 左の「マイブループリント」で、イベントグラフと自作の関数・マクロのグラフを切り替える（UE と同じ）。
//   ＋ で作る・クリックで開く・グラフへドラッグすると呼ぶノードを置く・呼ぶノードをダブルクリックでも開く
//   ノードを選んで右クリック →「関数にまとめる」「マクロにまとめる」
//
// ノードの種類と実行のしかたは shared/gimmick/nodes.js・graph.js にあり、OBS でも同じものが動く。
import { cstore, onC, change, live, endLive, selectC, emitC } from "./state.js";
import { h, openContextMenu, positionMenu, closeMenus, toast, modal, isTyping, prefs } from "../editor/ui.js";
import {
  NODE_TYPES, CATEGORIES, PIN_COLORS, PIN_TYPE_LABELS, pinsOf, canConnect, newNode,
  nodeKind, nodeTitle, allowedIn, fnOf,
} from "../shared/gimmick/nodes.js";
import {
  functionsOf, allGraphs, createFunction, deleteFunction, duplicateFunction, callSites, isEntryNode,
  ensureFunctionGraph, collapseToFunction, FN_KIND_LABELS,
} from "./functions.js";
import { checkExpr } from "../shared/gimmick/expr.js";
import { normalizeObject } from "../shared/gimmick/defaults.js";
import { clone, uid } from "../shared/model.js";

const GRID = 16;
const COMMENT_COLORS = ["#ffffff", "#ffc93c", "#5cff9d", "#4ec3ff", "#ff5c8a", "#9b6bff"];
const KIND_ICON = { event: "◆", action: "ƒ", flow: "⇉", pure: "ƒ", var: "●", entry: "⇥" };
const CLIP_KEY = "ld-graph-clipboard";

/** 開いている関数・マクロ（イベントグラフなら null） */
const currentFn = (g = cstore.gimmick) => (cstore.graphId ? fnOf(g, cstore.graphId) : null);
/** 開いているグラフ（イベントグラフか、関数・マクロの中身） */
const graphOf = (g = cstore.gimmick) => {
  let holder = g;
  if (cstore.graphId) {
    const f = fnOf(g, cstore.graphId);
    if (f) holder = f;
    else cstore.graphId = null; // 元に戻すなどで消えた
  }
  if (!holder.graph) holder.graph = { nodes: [], links: [], comments: [] };
  holder.graph.nodes ||= [];
  holder.graph.links ||= [];
  holder.graph.comments ||= [];
  return holder.graph;
};
const isCall = (n) => n?.type === "call.function" || n?.type === "call.macro";
const findNode = (id, g) => graphOf(g).nodes.find((n) => n.id === id);
const snap = (v) => Math.round(v / GRID) * GRID;

// ===============================
// 選択肢（ノードの設定に出す一覧）
// ===============================
function fieldOptions(kind, g) {
  switch (kind) {
    case "prefab": return [["", "（選ぶ）"], ...g.objects.filter((o) => o.prefab).map((o) => [o.id, `📦 ${o.name}`]), ...g.objects.filter((o) => !o.prefab).map((o) => [o.id, o.name])];
    case "object": return [["", "（選ぶ）"], ...g.objects.map((o) => [o.id, `${o.prefab ? "📦 " : ""}${o.name}`])];
    case "sound": return [["", "（選ぶ）"], ...g.sounds.map((s) => [s.id, s.name])];
    case "effect": return [["", "なし"], ...g.effects.map((e) => [e.id, e.name])];
    case "var": return [["", "（選ぶ）"], ...g.variables.map((v) => [v.name, `${v.name}（${typeof v.value === "number" ? "数" : "文字"}）`])];
    case "function": case "macro": return [["", "（選ぶ）"], ...functionsOf(g).filter((f) => f.kind === kind).map((f) => [f.id, f.name])];
    default: return [];
  }
}

/** ノードの見出しの下に出す一言（何を設定しているか） */
function nodeSubtitle(n, g) {
  const v = n.values || {};
  const name = (list, id) => list.find((x) => x.id === id)?.name;
  switch (n.type) {
    case "event.signal": case "action.emit": return v.name ? `「${v.name}」` : "";
    case "event.every": return `${v.seconds ?? 1} 秒ごと`;
    case "event.collide": return `${v.a || "どれか"} × ${v.b || "どれか"}`;
    case "event.edge": case "event.click": return v.tag ? `#${v.tag}` : "";
    case "event.gift": return [v.giftName, Number(v.minCoins) > 0 ? `${v.minCoins}コイン〜` : ""].filter(Boolean).join(" ");
    case "event.chat": return v.match && v.match !== "any" ? `「${v.keyword || ""}」` : "";
    case "event.like": return Number(v.every) > 0 ? `${v.every} 件ごと` : "";
    case "event.spawned": case "get.object": return name(g.objects, v.object) || "";
    case "action.spawn": return name(g.objects, v.prefab) || "（出すものを選ぶ）";
    case "action.playSound": return name(g.sounds, v.sound) || "（サウンドを選ぶ）";
    case "action.playEffect": case "action.playEffectOn": return name(g.effects, v.effect) || "（エフェクトを選ぶ）";
    case "var.get": case "var.set": case "var.add": return v.var || "（変数を選ぶ）";
    case "expr": return v.expr || "";
    case "call.function": { const f = fnOf(g, v.fn); return f ? (f.pure ? "ピュア関数" : "関数") : "（消された関数）"; }
    case "call.macro": return fnOf(g, v.fn) ? "マクロ" : "（消されたマクロ）";
    case "fn.entry": return "関数の入口";
    case "macro.in": return "マクロの入口";
    default: return "";
  }
}

/** 欄（ノードの設定）を1つ作る。{el, sync} */
export function fieldControl(f, n, g, onSet, { large = false } = {}) {
  const get = () => findNode(n.id)?.values?.[f.name] ?? f.default;
  let ctl;
  const stop = (e) => e.stopPropagation();
  if (f.kind === "select" || ["prefab", "object", "sound", "effect", "var", "function", "macro"].includes(f.kind)) {
    ctl = h("select", { class: "gn-ctl" });
    const fill = () => {
      ctl.textContent = "";
      for (const [value, label] of f.kind === "select" ? f.options : fieldOptions(f.kind, cstore.gimmick)) ctl.appendChild(h("option", { value }, label));
    };
    fill();
    ctl.addEventListener("change", () => onSet(ctl.value));
    return { el: ctl, sync() { fill(); ctl.value = get() ?? ""; } };
  }
  if (f.kind === "bool") {
    ctl = h("input", { type: "checkbox", class: "gn-check" });
    ctl.addEventListener("change", () => onSet(ctl.checked));
    ctl.addEventListener("pointerdown", stop);
    return { el: h("label", { class: "gn-bool" }, ctl, h("span", {}, f.label)), sync() { ctl.checked = !!get(); }, inline: true };
  }
  const isNum = f.kind === "number";
  ctl = h(large && f.kind === "expr" ? "textarea" : "input", {
    class: `gn-ctl${f.kind === "expr" ? " gn-expr" : ""}`,
    type: large && f.kind === "expr" ? null : isNum ? "number" : "text",
    min: f.min, max: f.max, step: f.step ?? (isNum ? "any" : null),
    list: f.kind === "tag" ? "gn-tags" : f.kind === "signal" ? "gn-signals" : null,
    placeholder: f.kind === "tag" ? "空ならどれでも" : f.kind === "expr" ? "a + b" : "",
    rows: large ? 3 : null,
    spellcheck: "false",
  });
  const commit = () => onSet(isNum ? (ctl.value === "" ? f.default : Number(ctl.value)) : ctl.value);
  ctl.addEventListener("change", commit);
  ctl.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" && ctl.tagName === "INPUT") ctl.blur(); });
  const err = f.kind === "expr" ? h("span", { class: "gn-err" }) : null;
  const wrap = err ? h("span", { class: "gn-expr-wrap" }, ctl, err) : ctl;
  return {
    el: wrap,
    sync() {
      if (document.activeElement !== ctl) ctl.value = get() ?? "";
      if (err) {
        const msg = String(get() ?? "").trim() ? checkExpr(get()) : null;
        err.textContent = msg ? `⚠ ${msg}` : "";
        ctl.classList.toggle("bad", !!msg);
      }
    },
  };
}

// ===============================
// エディタ本体
// ===============================
/**
 * @param {HTMLElement} shell
 * @param {{fire: (nodeId: string) => boolean, isPlaying: () => boolean}} opts
 */
export function initGraphEditor(shell, opts) {
  const root = h("div", { class: "gn-root" });
  const view = { x: 40, y: 40, z: 1 };
  const views = new Map(); // グラフごとの見ている位置
  let selected = new Set();
  let selectedComment = null;
  let selectedLink = null;
  let nodeEls = new Map();
  let pinOffsets = new Map(); // nodeId → {"in:name": {x, y}, "out:name": {x, y}}
  let syncs = [];
  let builtKey = null;
  let lastPointer = { x: 0, y: 0 };
  let spaceDown = false;
  let framedFor = null;
  const traceAt = new Map();

  const world = h("div", { class: "gn-world" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "gn-links");
  const commentsLayer = h("div", { class: "gn-comments" });
  const nodesLayer = h("div", { class: "gn-nodes" });
  world.append(commentsLayer, svg, nodesLayer);
  const marquee = h("div", { class: "gn-marquee", hidden: true });
  const zoomLabel = h("span", { class: "gn-zoom" }, "100%");
  const empty = h("div", { class: "gn-empty", hidden: true },
    h("strong", {}, "右クリック（またはダブルクリック）でノードを置きます"),
    h("span", {}, "まずは赤い「イベント」ノード（ゲームが始まったとき・ギフトが来たとき…）を置き、白い実行ピンから線を引いて、青い「アクション」ノードへつなぎます。"));
  const crumbs = h("div", { class: "gn-crumbs" });
  const sideToggle = h("button", { type: "button", class: "small-btn gn-side-toggle", title: "マイブループリント（関数・マクロの一覧）を出す／しまう", onclick: () => toggleSide() }, "☰");
  const toolbar = h("div", { class: "gn-toolbar" },
    sideToggle,
    crumbs,
    h("button", { type: "button", class: "small-btn primary", onclick: () => openPalette(centerScreen(), toWorld(centerScreen())) }, "＋ ノード"),
    h("button", { type: "button", class: "small-btn", title: "選んだノードをコメントで囲む", onclick: () => addComment() }, "▭ コメント"),
    h("button", { type: "button", class: "small-btn", title: "全部が見えるようにする（F）", onclick: () => frameAll() }, "⤢ 全体"),
    zoomLabel,
    h("span", { class: "gn-help" }, "右クリック：ノードを追加　ピンをドラッグ：つなぐ　Alt+クリック：線を外す　右ドラッグ：移動　ホイール：拡大"));
  const tags = h("datalist", { id: "gn-tags" });
  const signals = h("datalist", { id: "gn-signals" });
  root.append(world, marquee, toolbar, empty, tags, signals);
  const side = h("div", { class: "gn-side" });
  shell.classList.add("gn-shell");
  shell.append(side, root);
  if (prefs.get("ld-gn-side") === "0") shell.classList.add("side-off");

  // ===============================
  // 座標
  // ===============================
  const rootRect = () => root.getBoundingClientRect();
  function toWorld(p) {
    const r = rootRect();
    return { x: (p.x - r.left - view.x) / view.z, y: (p.y - r.top - view.y) / view.z };
  }
  function centerScreen() {
    const r = rootRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    const s = GRID * 4 * view.z;
    root.style.backgroundSize = `${s}px ${s}px, ${s}px ${s}px, ${s / 4}px ${s / 4}px, ${s / 4}px ${s / 4}px`;
    root.style.backgroundPosition = `${view.x}px ${view.y}px`;
    zoomLabel.textContent = `${Math.round(view.z * 100)}%`;
  }

  // ===============================
  // 描く
  // ===============================
  const linksOf = (g) => graphOf(g).links;
  const isConnected = (nodeId, pinName, dir) => linksOf().some((l) => (dir === "in" ? l.to === nodeId && l.toPin === pinName : l.from === nodeId && l.fromPin === pinName));

  function structKey() {
    const g = cstore.gimmick;
    const gr = graphOf(g);
    return JSON.stringify([
      cstore.graphId,
      functionsOf(g).map((f) => [f.id, f.name, f.kind, f.pure, f.inputs, f.outputs]),
      gr.nodes.map((n) => [n.id, n.type, n.x, n.y, n.values?.at, n.values?.outs, n.values?.var, n.values?.fn]),
      gr.links, gr.comments,
      g.variables.map((v) => [v.name, typeof v.value]),
      g.objects.map((o) => [o.id, o.name, o.prefab]), g.sounds.map((s) => [s.id, s.name]), g.effects.map((e) => [e.id, e.name]),
      [...selected], selectedComment, selectedLink,
    ]);
  }

  function setValue(nodeId, key, value) {
    change((g) => {
      const n = findNode(nodeId, g);
      if (n) n.values = { ...(n.values || {}), [key]: value };
    }, { coalesce: `gn:${nodeId}:${key}` });
  }

  function literalControl(n, p) {
    const stop = (e) => e.stopPropagation();
    const get = () => findNode(n.id)?.values?.[p.name] ?? p.default;
    if (p.type === "entity") {
      return { el: h("span", { class: "gn-lit-hint" }, p.self ? "（自分）" : "（なし）"), sync() { } };
    }
    if (p.type === "bool") {
      const c = h("input", { type: "checkbox", class: "gn-check", onpointerdown: stop });
      c.addEventListener("change", () => setValue(n.id, p.name, c.checked));
      return { el: c, sync() { c.checked = !!get(); } };
    }
    const isNum = p.type === "number";
    const input = h("input", {
      type: isNum ? "number" : "text", step: "any", min: p.min, max: p.max,
      class: `gn-lit ${isNum ? "num" : "str"}`, placeholder: p.optional ? "そのまま" : "", spellcheck: "false",
    });
    input.addEventListener("change", () => {
      const v = input.value;
      setValue(n.id, p.name, isNum ? (v === "" ? (p.optional ? "" : 0) : Number(v)) : v);
    });
    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") input.blur(); });
    return { el: input, sync() { if (document.activeElement !== input) input.value = get() ?? ""; } };
  }

  function pinEl(n, p, dir) {
    const dot = h("span", {
      class: `gn-pin ${p.type === "exec" ? "exec" : "data"}${isConnected(n.id, p.name, dir) ? " on" : ""}`,
      dataset: { node: n.id, pin: p.name, dir, type: p.type },
      title: `${p.label || p.name}（${PIN_TYPE_LABELS[p.type] || p.type}）${p.hint ? `\n${p.hint}` : ""}`,
    });
    dot.style.setProperty("--pin", PIN_COLORS[p.type] || "#ccc");
    return dot;
  }

  function nodeEl(n) {
    const g = cstore.gimmick;
    const d = NODE_TYPES[n.type];
    const kind = d ? nodeKind(n, g) : "unknown";
    const missing = isCall(n) && !fnOf(g, n.values?.fn);
    const el = h("div", { class: `gn-node k-${kind}${d?.compact ? " compact" : ""}${isCall(n) ? " call" : ""}${missing ? " missing" : ""}${selected.has(n.id) ? " selected" : ""}`, dataset: { id: n.id } });
    el.style.left = `${n.x}px`;
    el.style.top = `${n.y}px`;
    if (!d) {
      el.append(h("div", { class: "gn-head" }, h("span", { class: "gn-title" }, `不明なノード（${n.type}）`)));
      return el;
    }
    const { inputs, outputs } = pinsOf(n, g);
    if (!d.compact) {
      const sub = h("span", { class: "gn-sub" });
      syncs.push(() => { sub.textContent = nodeSubtitle(findNode(n.id) || n, cstore.gimmick); });
      el.appendChild(h("div", { class: "gn-head", title: isCall(n) ? "ダブルクリックで中身を開く" : null },
        h("span", { class: "gn-icon" }, KIND_ICON[kind] || "•"),
        h("span", { class: "gn-title-wrap" }, h("span", { class: "gn-title" }, nodeTitle(n, g)), sub)));
    }
    const body = h("div", { class: "gn-body" });
    const onNode = d.fields.filter((f) => f.onNode !== false);
    if (onNode.length && !d.compact) {
      const fields = h("div", { class: "gn-fields" });
      for (const f of onNode) {
        const c = fieldControl(f, n, g, (v) => setValue(n.id, f.name, v));
        syncs.push(c.sync);
        fields.appendChild(c.inline ? c.el : h("label", { class: "gn-field" }, h("span", {}, f.label), c.el));
      }
      body.appendChild(fields);
    }
    const cols = h("div", { class: "gn-pins" });
    const left = h("div", { class: "gn-col in" });
    const right = h("div", { class: "gn-col out" });
    for (const p of inputs) {
      const row = h("div", { class: "gn-row" }, pinEl(n, p, "in"));
      if (p.type !== "exec" || p.label) row.appendChild(h("span", { class: "gn-label" }, p.label));
      if (p.type !== "exec" && !isConnected(n.id, p.name, "in")) {
        const lit = literalControl(n, p);
        syncs.push(lit.sync);
        row.appendChild(lit.el);
      }
      left.appendChild(row);
    }
    for (const p of outputs) {
      const row = h("div", { class: "gn-row" });
      if (p.label) row.appendChild(h("span", { class: "gn-label" }, p.label));
      row.appendChild(pinEl(n, p, "out"));
      right.appendChild(row);
    }
    if (d.compact) cols.append(left, h("div", { class: "gn-symbol", title: d.title }, d.compact), right);
    else cols.append(left, right);
    body.appendChild(cols);
    el.appendChild(body);
    return el;
  }

  function commentEl(c) {
    const head = h("div", { class: "gn-comment-head", dataset: { comment: c.id } }, c.text || "コメント");
    const el = h("div", { class: `gn-comment${selectedComment === c.id ? " selected" : ""}`, dataset: { comment: c.id } },
      head, h("span", { class: "gn-comment-resize", dataset: { resize: c.id } }));
    Object.assign(el.style, { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` });
    el.style.setProperty("--c", c.color || "#ffffff");
    head.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const input = h("input", { type: "text", class: "gn-comment-input", value: c.text || "" });
      head.textContent = "";
      head.appendChild(input);
      input.focus();
      input.select();
      const done = () => change((g) => { const x = graphOf(g).comments.find((y) => y.id === c.id); if (x) x.text = input.value.slice(0, 200); });
      input.addEventListener("blur", done, { once: true });
      input.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") input.blur(); });
      input.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    });
    return el;
  }

  function measure() {
    pinOffsets = new Map();
    const z = view.z;
    for (const [id, el] of nodeEls) {
      const nr = el.getBoundingClientRect();
      const map = {};
      for (const dot of el.querySelectorAll(".gn-pin")) {
        const r = dot.getBoundingClientRect();
        map[`${dot.dataset.dir}:${dot.dataset.pin}`] = { x: (r.left + r.width / 2 - nr.left) / z, y: (r.top + r.height / 2 - nr.top) / z };
      }
      pinOffsets.set(id, map);
    }
  }

  function pinPos(nodeId, dir, pinName) {
    const n = findNode(nodeId);
    const off = pinOffsets.get(nodeId)?.[`${dir}:${pinName}`];
    if (!n || !off) return null;
    return { x: n.x + off.x, y: n.y + off.y };
  }

  const curve = (a, b) => {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    return `M${a.x} ${a.y} C${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  };

  function drawLinks() {
    svg.textContent = "";
    const g = cstore.gimmick;
    for (const l of linksOf()) {
      const a = pinPos(l.from, "out", l.fromPin);
      const b = pinPos(l.to, "in", l.toPin);
      if (!a || !b) continue;
      const from = findNode(l.from);
      const type = pinsOf(from, g).outputs.find((p) => p.name === l.fromPin)?.type || "any";
      const key = linkKey(l);
      const d = curve(a, b);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("class", `gn-link ${type === "exec" ? "exec" : "data"}${selectedLink === key ? " selected" : ""}`);
      path.style.stroke = PIN_COLORS[type] || "#ccc";
      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hit.setAttribute("d", d);
      hit.setAttribute("class", "gn-link-hit");
      hit.dataset.link = key;
      svg.append(path, hit);
    }
  }

  const linkKey = (l) => `${l.from}:${l.fromPin}>${l.to}:${l.toPin}`;

  function syncLists() {
    const g = cstore.gimmick;
    const fill = (dl, values) => {
      dl.textContent = "";
      for (const v of new Set(values)) if (v) dl.appendChild(h("option", { value: v }));
    };
    fill(tags, g.objects.flatMap((o) => String(normalizeObject(o).tag).split(/[\s,、]+/)));
    fill(signals, allGraphs(g).flatMap((x) => x.graph.nodes).filter((n) => n.type === "event.signal" || n.type === "action.emit").map((n) => n.values?.name));
  }

  function render() {
    builtKey = structKey();
    syncs = [];
    nodeEls = new Map();
    nodesLayer.textContent = "";
    commentsLayer.textContent = "";
    const gr = graphOf();
    for (const c of gr.comments) commentsLayer.appendChild(commentEl(c));
    for (const n of gr.nodes) {
      const el = nodeEl(n);
      nodeEls.set(n.id, el);
      nodesLayer.appendChild(el);
    }
    empty.hidden = gr.nodes.length > 0;
    renderSide();
    renderCrumbs();
    syncLists();
    sync();
    applyView();
    if (root.offsetParent !== null) {
      measure();
      drawLinks();
    }
  }

  function sync() {
    for (const s of syncs) { try { s(); } catch (e) { console.error(e); } }
  }

  /** 開いたとき：読める大きさ（90%）で、左上のまとまりから見せる。全体は「⤢ 全体」で */
  function frameStart() {
    const gr = graphOf();
    if (!gr.nodes.length) { view.x = 40; view.y = 60; view.z = 1; applyView(); return; }
    const xs = [...gr.nodes.map((n) => n.x), ...gr.comments.map((c) => c.x)];
    const ys = [...gr.nodes.map((n) => n.y), ...gr.comments.map((c) => c.y)];
    view.z = 0.9;
    view.x = 30 - Math.min(...xs) * view.z;
    view.y = 56 - Math.min(...ys) * view.z;
    applyView();
    measure();
    drawLinks();
  }

  /** 全部が見える位置と倍率にする */
  function frameAll() {
    const gr = graphOf();
    const r = rootRect();
    if (!gr.nodes.length || !r.width) { view.x = 40; view.y = 60; view.z = 1; applyView(); return; }
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const n of gr.nodes) {
      const el = nodeEls.get(n.id);
      const w = el ? el.offsetWidth : 200;
      const hh = el ? el.offsetHeight : 100;
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + w); y1 = Math.max(y1, n.y + hh);
    }
    for (const c of gr.comments) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + c.h); }
    const pad = 60;
    view.z = Math.max(0.25, Math.min(1.1, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2 - 30) / (y1 - y0))));
    view.x = (r.width - (x1 - x0) * view.z) / 2 - x0 * view.z;
    view.y = (r.height - (y1 - y0) * view.z) / 2 - y0 * view.z + 15;
    applyView();
    measure();
    drawLinks();
  }

  // ===============================
  // 選択
  // ===============================
  function setSelection(ids, { comment = null, link = null } = {}) {
    selected = new Set(ids);
    selectedComment = comment;
    selectedLink = link;
    for (const [id, el] of nodeEls) el.classList.toggle("selected", selected.has(id));
    for (const el of commentsLayer.children) el.classList.toggle("selected", el.dataset.comment === comment);
    for (const p of svg.querySelectorAll(".gn-link")) p.classList.remove("selected");
    if (link) drawLinks();
    builtKey = structKey();
    // 1つだけ選んだら、右のインスペクターに説明と設定を出す（入口・出口なら、関数・マクロの入出力の設定）
    const one = selected.size === 1 ? findNode([...selected][0]) : null;
    if (one && NODE_TYPES[one.type]?.inner && currentFn()) selectC("function", currentFn().id);
    else if (one) selectC("node", one.id);
    else if (cstore.selection?.type === "node") selectC(null);
  }

  // ===============================
  // つなぐ・外す
  // ===============================
  function pinInfo(dot) {
    return { node: dot.dataset.node, pin: dot.dataset.pin, dir: dot.dataset.dir, type: dot.dataset.type };
  }

  /** a と b（向きが逆のピン）をつなぐ。つなげない組み合わせなら false */
  function connect(a, b) {
    if (!a || !b || a.node === b.node || a.dir === b.dir) return false;
    const out = a.dir === "out" ? a : b;
    const inp = a.dir === "out" ? b : a;
    if (!canConnect(out.type, inp.type)) {
      toast(`${PIN_TYPE_LABELS[out.type]}のピンと${PIN_TYPE_LABELS[inp.type]}のピンはつなげません`, "error");
      return false;
    }
    change((g) => {
      const gr = graphOf(g);
      gr.links = gr.links.filter((l) => {
        // データの入口は1本だけ。実行の出口も1本だけ（UE と同じ）
        if (inp.type !== "exec" && l.to === inp.node && l.toPin === inp.pin) return false;
        if (out.type === "exec" && l.from === out.node && l.fromPin === out.pin) return false;
        return true;
      });
      gr.links.push({ from: out.node, fromPin: out.pin, to: inp.node, toPin: inp.pin });
    });
    return true;
  }

  function breakPin(p) {
    change((g) => {
      const gr = graphOf(g);
      gr.links = gr.links.filter((l) => !(p.dir === "in" ? l.to === p.node && l.toPin === p.pin : l.from === p.node && l.fromPin === p.pin));
    });
  }

  function removeLink(key) {
    change((g) => { const gr = graphOf(g); gr.links = gr.links.filter((l) => linkKey(l) !== key); });
    selectedLink = null;
  }

  function deleteSelection() {
    if (selectedLink) { removeLink(selectedLink); return; }
    if (selectedComment) {
      const id = selectedComment;
      change((g) => { const gr = graphOf(g); gr.comments = gr.comments.filter((c) => c.id !== id); });
      selectedComment = null;
      return;
    }
    if (!selected.size) return;
    const ids = new Set([...selected].filter((id) => !isEntryNode(findNode(id))));
    if (ids.size < selected.size) toast("入口のノードは消せません（関数・マクロごと消すときは、左の一覧から）");
    if (!ids.size) return;
    change((g) => {
      const gr = graphOf(g);
      gr.nodes = gr.nodes.filter((n) => !ids.has(n.id));
      gr.links = gr.links.filter((l) => !ids.has(l.from) && !ids.has(l.to));
    });
    setSelection([]);
  }

  // ===============================
  // コピー・貼り付け
  // ===============================
  function copySelection() {
    const gr = graphOf();
    const ids = new Set(selected);
    if (!ids.size) return null;
    const data = {
      nodes: clone(gr.nodes.filter((n) => ids.has(n.id))),
      links: clone(gr.links.filter((l) => ids.has(l.from) && ids.has(l.to))),
    };
    prefs.setJson(CLIP_KEY, data);
    copySelection.last = data;
    return data;
  }

  function paste(at, data = null) {
    let clip = data;
    if (!clip) {
      clip = prefs.getJson(CLIP_KEY) || copySelection.last;
    }
    if (!clip?.nodes?.length) return;
    const x0 = Math.min(...clip.nodes.map((n) => n.x));
    const y0 = Math.min(...clip.nodes.map((n) => n.y));
    const map = new Map();
    const fn = currentFn();
    const where = fn?.kind ?? null;
    const ok = clip.nodes.filter((n) => NODE_TYPES[n.type] && allowedIn(n.type, where) && !isEntryNode(n));
    if (ok.length < clip.nodes.length) toast(fn ? "関数・マクロの中に置けないノード（イベント・入口など）は貼り付けませんでした" : "イベントグラフに置けないノード（関数の入口・出口など）は貼り付けませんでした");
    if (!ok.length) return;
    const nodes = ok.map((n) => {
      const id = uid("n");
      map.set(n.id, id);
      const values = NODE_TYPES[n.type].inner ? { ...(n.values || {}), fn: fn.id } : n.values;
      return { ...n, id, values, x: snap(at.x + n.x - x0), y: snap(at.y + n.y - y0) };
    });
    const links = clip.links.filter((l) => map.has(l.from) && map.has(l.to)).map((l) => ({ ...l, from: map.get(l.from), to: map.get(l.to) }));
    change((g) => { const gr = graphOf(g); gr.nodes.push(...nodes); gr.links.push(...links); });
    setSelection(nodes.map((n) => n.id));
  }

  function addComment() {
    const gr = graphOf();
    let box;
    const sel = gr.nodes.filter((n) => selected.has(n.id));
    if (sel.length) {
      const pad = 30;
      const xs = sel.map((n) => n.x); const ys = sel.map((n) => n.y);
      const xe = sel.map((n) => n.x + (nodeEls.get(n.id)?.offsetWidth || 200));
      const ye = sel.map((n) => n.y + (nodeEls.get(n.id)?.offsetHeight || 100));
      box = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad - 24, w: Math.max(...xe) - Math.min(...xs) + pad * 2, h: Math.max(...ye) - Math.min(...ys) + pad * 2 + 24 };
    } else {
      const c = toWorld(centerScreen());
      box = { x: snap(c.x - 200), y: snap(c.y - 120), w: 400, h: 240 };
    }
    const cm = { id: uid("cm"), ...box, text: "コメント", color: "#ffffff" };
    change((g) => { graphOf(g).comments.push(cm); });
    selectedComment = cm.id;
  }

  // ===============================
  // パレット（ノードを探して置く）
  // ===============================
  function paletteItems(fromPin) {
    const g = cstore.gimmick;
    const items = [];
    const cur = currentFn();
    const where = cur?.kind ?? null;
    for (const d of Object.values(NODE_TYPES)) {
      if (d.hidden || !allowedIn(d.type, where)) continue;
      items.push({ type: d.type, label: d.title, category: d.category, keywords: d.keywords, values: {}, kind: d.kind });
    }
    // 自作の関数・マクロ（マクロは自分自身の中には置けない）
    for (const f of functionsOf(g)) {
      if (f.kind === "macro" && f.id === cur?.id) continue;
      const type = f.kind === "macro" ? "call.macro" : "call.function";
      items.push({ type, label: f.name, category: FN_KIND_LABELS[f.kind], keywords: `${f.kind} call 呼ぶ ${f.desc || ""}`, values: { fn: f.id }, kind: nodeKind({ type, values: { fn: f.id } }, g) });
    }
    if (cur?.kind === "function") items.push({ type: "fn.return", label: "出口（Return）", category: "関数", keywords: "Return 戻る 返す 終わり", values: { fn: cur.id }, kind: "entry" });
    if (cur?.kind === "macro") items.push({ type: "macro.out", label: "出口（もう1つ）", category: "マクロ", keywords: "Output 出口 戻る", values: { fn: cur.id }, kind: "entry" });
    for (const v of g.variables) {
      items.push({ type: "var.get", label: `${v.name} を読む`, category: "変数", keywords: `get ${v.name}`, values: { var: v.name }, kind: "var" });
      items.push({ type: "var.set", label: `${v.name} に入れる`, category: "変数", keywords: `set ${v.name}`, values: { var: v.name }, kind: "action" });
      if (typeof v.value === "number") items.push({ type: "var.add", label: `${v.name} に足す`, category: "変数", keywords: `add ${v.name}`, values: { var: v.name }, kind: "action" });
    }
    for (const o of g.objects) {
      if (o.prefab) items.push({ type: "action.spawn", label: `「${o.name}」を出す`, category: "オブジェクト", keywords: `spawn ${o.name} ${o.tag || ""}`, values: { prefab: o.id }, kind: "action" });
      items.push({ type: "get.object", label: `「${o.name}」（置いたオブジェクト）`, category: "情報", keywords: `${o.name} ${o.tag || ""}`, values: { object: o.id }, kind: "pure" });
    }
    for (const s of g.sounds) items.push({ type: "action.playSound", label: `「${s.name}」を鳴らす`, category: "演出", keywords: `sound ${s.name}`, values: { sound: s.id }, kind: "action" });
    for (const fx of g.effects) items.push({ type: "action.playEffect", label: `「${fx.name}」を出す`, category: "演出", keywords: `effect ${fx.name}`, values: { effect: fx.id }, kind: "action" });
    const sigs = new Set(graphOf(g).nodes.filter((n) => n.type === "event.signal").map((n) => n.values?.name).filter(Boolean));
    for (const s of sigs) items.push({ type: "action.emit", label: `合図「${s}」を出す`, category: "ゲーム", keywords: `emit ${s}`, values: { name: s }, kind: "action" });
    if (!fromPin) return items;
    // ピンから線を伸ばして開いたときは、つなげるノードだけ
    return items.filter((it) => !!compatiblePin(it, fromPin));
  }

  function compatiblePin(item, fromPin) {
    const probe = newNode(item.type, 0, 0, item.values, "probe");
    const { inputs, outputs } = pinsOf(probe, cstore.gimmick);
    const list = fromPin.dir === "out" ? inputs : outputs;
    return list.find((p) => (fromPin.dir === "out" ? canConnect(fromPin.type, p.type) : canConnect(p.type, fromPin.type)));
  }

  function openPalette(screen, worldAt, fromPin = null) {
    closeMenus();
    const all = paletteItems(fromPin);
    const search = h("input", { type: "search", class: "gn-search", placeholder: fromPin ? "つなげるノードを探す" : "ノードを探す（例：分岐、ギフト、足し算、Branch）" });
    const list = h("div", { class: "gn-palette-list" });
    const menu = h("div", { class: "menu gn-palette" }, search, list);
    let active = 0;
    let shown = [];
    const create = (it) => {
      closeMenus();
      const x = snap(fromPin?.dir === "in" ? worldAt.x - 240 : worldAt.x);
      const node = newNode(it.type, x, snap(worldAt.y - 20), it.values, uid("n"));
      change((g) => { graphOf(g).nodes.push(node); });
      if (fromPin) {
        const p = compatiblePin(it, fromPin);
        if (p) connect(fromPin, { node: node.id, pin: p.name, dir: fromPin.dir === "out" ? "in" : "out", type: p.type });
      }
      setSelection([node.id]);
    };
    function fill() {
      const q = search.value.trim().toLowerCase();
      list.textContent = "";
      shown = all.filter((it) => !q || `${it.label} ${it.category} ${it.keywords}`.toLowerCase().includes(q));
      active = Math.min(active, Math.max(0, shown.length - 1));
      const cats = [...CATEGORIES, ...new Set(shown.map((x) => x.category))];
      let i = 0;
      for (const cat of [...new Set(cats)]) {
        const group = shown.filter((it) => it.category === cat);
        if (!group.length) continue;
        list.appendChild(h("div", { class: "gn-palette-cat" }, cat));
        for (const it of group) {
          const idx = shown.indexOf(it);
          const btn = h("button", {
            type: "button", class: `gn-palette-item k-${it.kind}${idx === active ? " active" : ""}`,
            onclick: () => create(it),
            onmouseenter: () => { active = idx; for (const b of list.querySelectorAll(".gn-palette-item")) b.classList.toggle("active", b === btn); },
          }, h("span", { class: "gn-palette-dot" }), it.label);
          list.appendChild(btn);
          i++;
        }
      }
      if (!i) list.appendChild(h("p", { class: "hint pad" }, "見つかりません"));
    }
    search.addEventListener("input", () => { active = 0; fill(); });
    search.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = Math.max(0, Math.min(shown.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)));
        fill();
        list.querySelector(".gn-palette-item.active")?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (shown[active]) create(shown[active]);
      } else if (e.key === "Escape") closeMenus();
    });
    fill();
    positionMenu(menu, null, { x: screen.x, y: screen.y });
    search.focus();
  }

  // ===============================
  // マウス
  // ===============================
  root.addEventListener("contextmenu", (e) => e.preventDefault());
  // 端のノードの入力欄にフォーカスしたときなどに、はみ出しを隠した root ごとずれないようにする（動かすのは view だけ）
  root.addEventListener("scroll", () => { root.scrollTop = 0; root.scrollLeft = 0; });

  root.addEventListener("pointermove", (e) => { lastPointer = { x: e.clientX, y: e.clientY }; });

  root.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".gn-toolbar")) return;
    if (e.target.closest("input, select, textarea, label.gn-bool")) return;
    closeMenus();
    const pinDot = e.target.closest(".gn-pin");
    const nodeDiv = e.target.closest(".gn-node");
    const resize = e.target.closest(".gn-comment-resize");
    const commentHead = e.target.closest(".gn-comment-head");
    const linkHit = e.target.closest(".gn-link-hit");

    if (pinDot && e.button === 0) {
      e.preventDefault();
      const p = pinInfo(pinDot);
      if (e.altKey) { breakPin(p); return; }
      dragLink(e, p, pinDot);
      return;
    }
    // 右クリックのメニューは pointerdown で開くので、ここで止める（document の「外を押したら閉じる」に届かないように）
    if (e.button === 2 && (pinDot || nodeDiv || commentHead)) e.stopPropagation();
    if (pinDot && e.button === 2) {
      const p = pinInfo(pinDot);
      openContextMenu([{ label: "このピンの線を外す", run: () => breakPin(p) }], { x: e.clientX, y: e.clientY });
      return;
    }
    if (linkHit && e.button === 0) {
      if (e.altKey) removeLink(linkHit.dataset.link);
      else setSelection([], { link: linkHit.dataset.link });
      return;
    }
    if (nodeDiv && e.button === 2) {
      const id = nodeDiv.dataset.id;
      if (!selected.has(id)) setSelection([id]);
      nodeMenu(id, e);
      return;
    }
    if (nodeDiv && e.button === 0) {
      e.preventDefault();
      const id = nodeDiv.dataset.id;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        const next = new Set(selected);
        next.has(id) ? next.delete(id) : next.add(id);
        setSelection([...next]);
        return;
      }
      if (!selected.has(id)) setSelection([id]);
      dragNodes(e, [...selected], e.altKey);
      return;
    }
    if (resize && e.button === 0) { e.preventDefault(); resizeComment(e, resize.dataset.resize); return; }
    if (commentHead && e.button === 0) {
      e.preventDefault();
      const id = commentHead.dataset.comment;
      setSelection([], { comment: id });
      dragComment(e, id);
      return;
    }
    if (commentHead && e.button === 2) {
      const id = commentHead.dataset.comment;
      openContextMenu([
        ...COMMENT_COLORS.map((c) => ({ label: `● 色：${c}`, run: () => change((g) => { const x = graphOf(g).comments.find((y) => y.id === id); if (x) x.color = c; }) })),
        "-",
        { label: "削除（中のノードは残す）", run: () => change((g) => { const gr = graphOf(g); gr.comments = gr.comments.filter((c) => c.id !== id); }) },
      ], { x: e.clientX, y: e.clientY });
      return;
    }
    // 何も無い所
    if (e.button === 1 || e.button === 2 || spaceDown) { pan(e); return; }
    if (e.button === 0) marqueeSelect(e);
  });

  root.addEventListener("dblclick", (e) => {
    // ノードをつかむとポインターを root に捕まえるので、ダブルクリックの相手は root になる。実際に下にあるものを見る
    const under = document.elementFromPoint(e.clientX, e.clientY) || e.target;
    if (under.closest("input, select, textarea")) return;
    const nd = under.closest(".gn-node");
    if (nd) {
      // 関数・マクロを呼ぶノードは、ダブルクリックで中身を開く（UE と同じ）
      const n = findNode(nd.dataset.id);
      if (isCall(n) && fnOf(cstore.gimmick, n.values?.fn)) openGraph(n.values.fn);
      return;
    }
    if (under.closest(".gn-toolbar, .gn-comment-head, .gn-palette")) return;
    openPalette({ x: e.clientX, y: e.clientY }, toWorld({ x: e.clientX, y: e.clientY }));
  });

  root.addEventListener("wheel", (e) => {
    if (e.target.closest(".gn-palette")) return;
    e.preventDefault();
    const r = rootRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const z0 = view.z;
    const z = Math.max(0.2, Math.min(2, z0 * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    view.x = px - ((px - view.x) / z0) * z;
    view.y = py - ((py - view.y) / z0) * z;
    view.z = z;
    applyView();
  }, { passive: false });

  function pan(e) {
    const x0 = e.clientX;
    const y0 = e.clientY;
    const v0 = { ...view };
    let moved = false;
    root.setPointerCapture(e.pointerId);
    root.classList.add("panning");
    const move = (ev) => {
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 4) moved = true;
      view.x = v0.x + ev.clientX - x0;
      view.y = v0.y + ev.clientY - y0;
      applyView();
    };
    const up = (ev) => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", up);
      root.classList.remove("panning");
      // 右クリックして動かさなければ、パレットを開く（UE と同じ）
      if (!moved && e.button === 2) openPalette({ x: ev.clientX, y: ev.clientY }, toWorld({ x: ev.clientX, y: ev.clientY }));
    };
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
  }

  function marqueeSelect(e) {
    const r = rootRect();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const base = e.shiftKey ? new Set(selected) : new Set();
    let moved = false;
    root.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 3) moved = true;
      if (!moved) return;
      const left = Math.min(x0, ev.clientX); const top = Math.min(y0, ev.clientY);
      const w = Math.abs(ev.clientX - x0); const hh = Math.abs(ev.clientY - y0);
      Object.assign(marquee.style, { left: `${left - r.left}px`, top: `${top - r.top}px`, width: `${w}px`, height: `${hh}px` });
      marquee.hidden = false;
      const ids = new Set(base);
      for (const [id, el] of nodeEls) {
        const b = el.getBoundingClientRect();
        if (b.right > left && b.left < left + w && b.bottom > top && b.top < top + hh) ids.add(id);
      }
      for (const [id, el] of nodeEls) el.classList.toggle("selected", ids.has(id));
      selected = ids;
    };
    const up = () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", up);
      marquee.hidden = true;
      if (!moved) setSelection([]);
      else setSelection([...selected]);
    };
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
  }

  function dragNodes(e, ids, duplicate) {
    let moveIds = ids;
    if (duplicate) {
      // Alt+ドラッグで複製してから動かす
      const data = copySelection();
      const before = new Set(graphOf().nodes.map((n) => n.id));
      paste({ x: Math.min(...data.nodes.map((n) => n.x)), y: Math.min(...data.nodes.map((n) => n.y)) }, data);
      moveIds = graphOf().nodes.filter((n) => !before.has(n.id)).map((n) => n.id);
    }
    const p0 = toWorld({ x: e.clientX, y: e.clientY });
    const start = new Map(graphOf().nodes.filter((n) => moveIds.includes(n.id)).map((n) => [n.id, { x: n.x, y: n.y }]));
    let moved = false;
    root.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const p = toWorld({ x: ev.clientX, y: ev.clientY });
      const dx = p.x - p0.x;
      const dy = p.y - p0.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      live((g) => {
        for (const n of graphOf(g).nodes) {
          const s = start.get(n.id);
          if (!s) continue;
          n.x = snap(s.x + dx);
          n.y = snap(s.y + dy);
          const el = nodeEls.get(n.id);
          if (el) { el.style.left = `${n.x}px`; el.style.top = `${n.y}px`; }
        }
      });
      drawLinks();
    };
    const up = () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", up);
      if (moved) endLive();
    };
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
  }

  function dragComment(e, id) {
    const gr = graphOf();
    const c = gr.comments.find((x) => x.id === id);
    if (!c) return;
    // コメントの中にすっぽり入っているノードも一緒に動かす（UE と同じ）
    const inside = gr.nodes.filter((n) => {
      const el = nodeEls.get(n.id);
      const w = el?.offsetWidth || 0;
      const hh = el?.offsetHeight || 0;
      return n.x >= c.x && n.y >= c.y && n.x + w <= c.x + c.w && n.y + hh <= c.y + c.h;
    }).map((n) => [n.id, { x: n.x, y: n.y }]);
    const start = { x: c.x, y: c.y, nodes: new Map(inside) };
    const p0 = toWorld({ x: e.clientX, y: e.clientY });
    let moved = false;
    root.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const p = toWorld({ x: ev.clientX, y: ev.clientY });
      const dx = snap(p.x - p0.x);
      const dy = snap(p.y - p0.y);
      if (!moved && !dx && !dy) return;
      moved = true;
      live((g) => {
        const gg = graphOf(g);
        const cc = gg.comments.find((x) => x.id === id);
        cc.x = start.x + dx;
        cc.y = start.y + dy;
        const cel = commentsLayer.querySelector(`[data-comment="${id}"]`);
        if (cel) { cel.style.left = `${cc.x}px`; cel.style.top = `${cc.y}px`; }
        for (const n of gg.nodes) {
          const s = start.nodes.get(n.id);
          if (!s) continue;
          n.x = s.x + dx;
          n.y = s.y + dy;
          const el = nodeEls.get(n.id);
          if (el) { el.style.left = `${n.x}px`; el.style.top = `${n.y}px`; }
        }
      });
      drawLinks();
    };
    const up = () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", up);
      if (moved) endLive();
    };
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
  }

  function resizeComment(e, id) {
    const c = graphOf().comments.find((x) => x.id === id);
    if (!c) return;
    const p0 = toWorld({ x: e.clientX, y: e.clientY });
    const s = { w: c.w, h: c.h };
    root.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const p = toWorld({ x: ev.clientX, y: ev.clientY });
      live((g) => {
        const cc = graphOf(g).comments.find((x) => x.id === id);
        cc.w = Math.max(120, snap(s.w + p.x - p0.x));
        cc.h = Math.max(80, snap(s.h + p.y - p0.y));
        const cel = commentsLayer.querySelector(`[data-comment="${id}"]`);
        if (cel) { cel.style.width = `${cc.w}px`; cel.style.height = `${cc.h}px`; }
      });
    };
    const up = () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", up);
      endLive();
    };
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
  }

  function dragLink(e, from, dot) {
    const temp = document.createElementNS("http://www.w3.org/2000/svg", "path");
    temp.setAttribute("class", `gn-link temp ${from.type === "exec" ? "exec" : "data"}`);
    temp.style.stroke = PIN_COLORS[from.type] || "#ccc";
    svg.appendChild(temp);
    const start = pinPos(from.node, from.dir, from.pin) || toWorld({ x: e.clientX, y: e.clientY });
    root.setPointerCapture(e.pointerId);
    dot.classList.add("dragging");
    const move = (ev) => {
      const p = toWorld({ x: ev.clientX, y: ev.clientY });
      temp.setAttribute("d", from.dir === "out" ? curve(start, p) : curve(p, start));
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".gn-pin");
      for (const x of root.querySelectorAll(".gn-pin.target")) x.classList.remove("target", "bad");
      if (over && over !== dot) {
        const t = pinInfo(over);
        const ok = t.dir !== from.dir && t.node !== from.node && (from.dir === "out" ? canConnect(from.type, t.type) : canConnect(t.type, from.type));
        over.classList.add("target");
        over.classList.toggle("bad", !ok);
      }
    };
    const up = (ev) => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", up);
      temp.remove();
      dot.classList.remove("dragging");
      for (const x of root.querySelectorAll(".gn-pin.target")) x.classList.remove("target", "bad");
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".gn-pin");
      if (over && over !== dot) { connect(from, pinInfo(over)); return; }
      if (!over) openPalette({ x: ev.clientX, y: ev.clientY }, toWorld({ x: ev.clientX, y: ev.clientY }), from);
    };
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
  }

  function nodeMenu(id, e) {
    const n = findNode(id);
    const d = NODE_TYPES[n?.type];
    const callee = isCall(n) ? fnOf(cstore.gimmick, n.values?.fn) : null;
    openContextMenu([
      d?.kind === "event" ? { label: "▶ 今すぐ動かす（再生中）", disabled: !opts.isPlaying(), run: () => { if (!opts.fire(id)) toast("再生中だけ動かせます"); } } : null,
      d?.kind === "event" ? "-" : null,
      callee ? { label: `「${callee.name}」の中身を開く`, run: () => openGraph(callee.id) } : null,
      callee ? "-" : null,
      { label: "関数にまとめる", run: () => collapse("function") },
      { label: "マクロにまとめる", run: () => collapse("macro") },
      "-",
      { label: "複製", key: "Ctrl+D", run: () => duplicate() },
      { label: "コピー", key: "Ctrl+C", run: () => copySelection() },
      { label: "線を全部外す", run: () => change((g) => { const gr = graphOf(g); gr.links = gr.links.filter((l) => !selected.has(l.from) && !selected.has(l.to)); }) },
      { label: "コメントで囲む", run: () => addComment() },
      "-",
      { label: "削除", key: "Delete", run: () => deleteSelection() },
    ], { x: e.clientX, y: e.clientY });
  }

  function duplicate() {
    const data = copySelection();
    if (!data) return;
    paste({ x: Math.min(...data.nodes.map((n) => n.x)) + 40, y: Math.min(...data.nodes.map((n) => n.y)) + 40 }, data);
  }

  // ===============================
  // 関数・マクロ（グラフを切り替える・マイブループリント）
  // ===============================
  /** グラフを開く（null ＝ イベントグラフ） */
  function openGraph(id) {
    const g = cstore.gimmick;
    const f = id ? fnOf(g, id) : null;
    if (id && !f) return;
    views.set(cstore.graphId || "", { ...view });
    if (f) ensureFunctionGraph(f);
    cstore.graphId = f ? f.id : null;
    selected = new Set();
    selectedComment = null;
    selectedLink = null;
    if (f) selectC("function", f.id);
    else if (cstore.selection?.type === "node" || cstore.selection?.type === "function") selectC(null);
    emitC("graphOpened", cstore.graphId);
    render();
    const saved = views.get(cstore.graphId || "");
    if (saved) { Object.assign(view, saved); applyView(); measure(); drawLinks(); } else frameStart();
  }

  function newFunction(kind) {
    let f = null;
    change((g) => { f = createFunction(g, kind); });
    if (f) openGraph(f.id);
    toast(kind === "macro"
      ? "マクロを作りました。入口から出口までの間にノードを置き、右で入出力を決めます"
      : "関数を作りました。入口と出口（Return）の間にノードを置き、右で入力・出力を決めます");
  }

  async function removeFunction(f) {
    const n = callSites(cstore.gimmick, f.id);
    const ok = await modal(`${FN_KIND_LABELS[f.kind]}を削除`, h("p", {}, `「${f.name}」を削除します。${n ? `呼んでいるノード ${n} 個も一緒に消えます。` : ""}（元に戻す で戻せます）`), { okText: "削除" });
    if (!ok) return;
    const wasOpen = cstore.graphId === f.id;
    change((g) => { deleteFunction(g, f.id); });
    if (wasOpen) openGraph(null);
    else if (cstore.selection?.type === "function" && cstore.selection.id === f.id) selectC(null);
  }

  function collapse(kind) {
    const ids = new Set(selected);
    if (!ids.size) { toast("まとめるノードを選んでください"); return; }
    let res = null;
    change((g) => { res = collapseToFunction(g, graphOf(g), ids, kind); });
    if (typeof res === "string") { toast(res, "error"); return; }
    if (!res) return;
    setSelection([res.call.id]);
    toast(`「${res.fn.name}」にまとめました。左の一覧で名前を変えられます（ダブルクリックで中身を開く）`);
  }

  /** 呼ぶノードを置く */
  function placeCall(f, at) {
    const type = f.kind === "macro" ? "call.macro" : "call.function";
    if (f.kind === "macro" && f.id === cstore.graphId) { toast("マクロの中に、そのマクロ自身は置けません", "error"); return; }
    const node = newNode(type, snap(at.x), snap(at.y), { fn: f.id }, uid("n"));
    change((g) => { graphOf(g).nodes.push(node); });
    setSelection([node.id]);
  }

  function toggleSide() {
    // 「並べる」では狭いので、ふだんはしまっておき、☰ のときだけ出す
    if (shell.closest(".split")) {
      shell.classList.toggle("split-side-on");
    } else {
      shell.classList.toggle("side-off");
      prefs.set("ld-gn-side", shell.classList.contains("side-off") ? "0" : "1");
    }
    requestAnimationFrame(() => { measure(); drawLinks(); });
  }

  function renderCrumbs() {
    const f = currentFn();
    crumbs.textContent = "";
    crumbs.append(h("button", { type: "button", class: `gn-crumb${f ? "" : " here"}`, onclick: () => openGraph(null) }, "📊 イベントグラフ"));
    if (f) {
      crumbs.append(h("span", { class: "gn-crumb-sep" }, "›"),
        h("span", { class: `gn-crumb here k-${f.kind}` }, `${f.kind === "macro" ? "⇉" : "ƒ"} ${f.name}`),
        h("span", { class: "gn-crumb-kind" }, f.kind === "macro" ? "マクロ" : f.pure ? "ピュア関数" : "関数"));
    }
    root.classList.toggle("in-fn", !!f);
    root.dataset.kind = f?.kind || "event";
  }

  function sideItem(f) {
    const g = cstore.gimmick;
    const count = callSites(g, f.id);
    const label = h("span", { class: "gn-side-name" }, f.name);
    const el = h("div", {
      class: `gn-side-item fn k-${f.kind}${f.pure ? " pure" : ""}${cstore.graphId === f.id ? " active" : ""}`,
      title: `${f.desc ? `${f.desc}\n` : ""}クリックで開く・グラフへドラッグで呼ぶノードを置く・右クリックでメニュー`,
      dataset: { fn: f.id },
    },
    h("span", { class: "gn-side-icon" }, f.kind === "macro" ? "⇉" : "ƒ"),
    label,
    count ? h("span", { class: "gn-side-count", title: `${count} か所から呼んでいます` }, String(count)) : null);
    const rename = () => {
      const input = h("input", { type: "text", class: "gn-side-input", value: f.name, maxlength: 60 });
      label.replaceWith(input);
      input.focus();
      input.select();
      const done = () => {
        const name = input.value.trim();
        if (name && name !== f.name) change((gm) => { const x = fnOf(gm, f.id); if (x) x.name = name.slice(0, 60); });
        else render();
      };
      input.addEventListener("blur", done, { once: true });
      input.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") input.blur(); if (ev.key === "Escape") { input.value = f.name; input.blur(); } });
      input.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    };
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openContextMenu([
        { label: "中身を開く", run: () => openGraph(f.id) },
        { label: "呼ぶノードをグラフに置く", run: () => placeCall(f, toWorld(centerScreen())) },
        "-",
        { label: "名前を変える", run: () => rename() },
        { label: "複製", run: () => change((gm) => { duplicateFunction(gm, f.id); }) },
        "-",
        { label: "削除", run: () => removeFunction(f) },
      ], { x: e.clientX, y: e.clientY });
    });
    // クリックで開く・グラフへドラッグで呼ぶノードを置く
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("input")) return;
      const x0 = e.clientX;
      const y0 = e.clientY;
      let ghost = null;
      const move = (ev) => {
        if (!ghost && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return;
        if (!ghost) {
          ghost = h("div", { class: `gn-drag-ghost k-${f.kind}` }, `${f.kind === "macro" ? "⇉" : "ƒ"} ${f.name}`);
          document.body.appendChild(ghost);
        }
        ghost.style.left = `${ev.clientX + 12}px`;
        ghost.style.top = `${ev.clientY + 8}px`;
        const r = rootRect();
        root.classList.toggle("drop-ok", ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom);
      };
      const up = (ev) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        root.classList.remove("drop-ok");
        if (!ghost) {
          // 開いているものをもう一度クリックしたら、名前を変える
          if (cstore.graphId === f.id) rename();
          else openGraph(f.id);
          return;
        }
        ghost.remove();
        const r = rootRect();
        if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
          placeCall(f, toWorld({ x: ev.clientX - 20, y: ev.clientY - 14 }));
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    return el;
  }

  function renderSide() {
    const g = cstore.gimmick;
    const list = functionsOf(g);
    side.textContent = "";
    const group = (kind, title, hint) => {
      const items = list.filter((f) => f.kind === kind);
      return [
        h("div", { class: "gn-side-group" },
          h("span", {}, title),
          h("button", { type: "button", class: "gn-side-add", title: `${title}を作る`, onclick: () => newFunction(kind) }, "＋")),
        ...items.map(sideItem),
        items.length ? null : h("p", { class: "gn-side-empty" }, hint),
      ];
    };
    side.append(
      h("div", { class: "gn-side-head" }, "マイブループリント"),
      h("div", {
        class: `gn-side-item graph${cstore.graphId ? "" : " active"}`,
        onclick: () => openGraph(null),
        title: "イベント（ゲームが始まった・ギフトが来た…）から動くメインのグラフ",
      }, h("span", { class: "gn-side-icon" }, "📊"), h("span", { class: "gn-side-name" }, "イベントグラフ")),
      ...group("function", "関数", "よく使う処理を1つのノードにまとめます。入力を受け取り、出力を返します。").filter(Boolean),
      ...group("macro", "マクロ", "実行ピンを何本でも持てる、中で「待つ」も使える部品です。").filter(Boolean),
      h("p", { class: "gn-side-hint" }, "クリックで中身を開く（開いているものをもう一度クリックで名前を変える）・グラフへドラッグで呼ぶノードを置く・右クリックでメニュー"),
    );
  }

  onC((kind, detail) => {
    if (kind === "openGraph") openGraph(detail);
  });

  // ===============================
  // キーボード
  // ===============================
  window.addEventListener("keydown", (e) => {
    if (e.key === " " && !isTyping()) spaceDown = true;
    if (root.offsetParent === null || isTyping()) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelection(); return; }
    if (mod && k === "c") { if (copySelection()) { e.preventDefault(); toast(`${selected.size} 個のノードをコピーしました`); } return; }
    if (mod && k === "v") { e.preventDefault(); paste(toWorld(lastPointer)); return; }
    if (mod && k === "d") { e.preventDefault(); duplicate(); return; }
    if (mod && k === "a") { e.preventDefault(); setSelection(graphOf().nodes.map((n) => n.id)); return; }
    if (!mod && k === "f") { e.preventDefault(); frameAll(); return; }
    if (e.key === "Escape" && (selected.size || selectedLink || selectedComment)) setSelection([]);
  });
  window.addEventListener("keyup", (e) => { if (e.key === " ") spaceDown = false; });

  // ===============================
  // 状態の変化
  // ===============================
  onC((kind, detail) => {
    if (kind !== "gimmick") return;
    if (detail?.live) return; // ドラッグ中はもう描いてある
    // 消されたノードを選んだままにしない
    const ids = new Set(graphOf().nodes.map((n) => n.id));
    selected = new Set([...selected].filter((id) => ids.has(id)));
    if (structKey() !== builtKey || detail?.history) render();
    else { syncLists(); sync(); }
  });

  new ResizeObserver(() => {
    if (root.offsetParent === null) return;
    if (framedFor !== cstore.gimmick?.id) {
      framedFor = cstore.gimmick?.id;
      render();
      frameStart();
    } else {
      measure();
      drawLinks();
    }
  }).observe(root);

  render();

  return {
    render,
    frameAll,
    /** 再生中にノードが動いた（光らせる） */
    trace(nodeId, graphId = "") {
      if ((graphId || null) !== (cstore.graphId || null)) return;
      const now = performance.now();
      if (now - (traceAt.get(nodeId) || 0) < 140) return;
      traceAt.set(nodeId, now);
      const el = nodeEls.get(nodeId);
      if (!el) return;
      el.classList.remove("fired");
      void el.offsetWidth;
      el.classList.add("fired");
    },
    /** 表示されたとき（タブを切り替えた）にピンの位置を測り直す */
    shown() {
      requestAnimationFrame(() => {
        if (framedFor !== cstore.gimmick?.id) { framedFor = cstore.gimmick?.id; render(); frameStart(); return; }
        measure();
        drawLinks();
      });
    },
    select: (ids) => setSelection(ids),
    openGraph: (id) => openGraph(id),
  };
}
