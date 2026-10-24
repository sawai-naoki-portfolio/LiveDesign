// lib/studio/gimmick.js
// クリエイターモードで作る「ギミック」（ゲーム・エフェクト・サウンド…）の入れ物と検査。
//
// ギミックは Unity のプレハブのように、アーティストモードのデザインに何度でも置ける部品。
// 中身は「ステージ・オブジェクト・ブループリント（ノードのつながり）・サウンド・エフェクト・変数」で、
// 動かすのはブラウザ側（public/js/studio/shared/gimmick/）。サーバーは保存と配布だけをする。
// 自作の関数・マクロ（functions）は、それぞれ自分のブループリントを持つ。
//
// シーンと同じく REST で丸ごと届き、ブラウザからは誰でも送れる前提なので、保存する前に形を整える
// （整え方の小道具は sanitize.js）。見るのは「壊れていない・大きすぎない・型が合っている」ことだけで、
// 細かい解釈はブラウザ側が持つ。
// ノードの種類や式（score + 1 など）は文字列のまま保存し、ブラウザ側（nodes.js・expr.js）だけが解釈する。
// サーバーがノードの種類を全部知ると、ノードを足すたびに両側を直すことになるので、ここでは形だけを見る。
// JavaScript として実行することは一切ない。
import {
  sanitizeLoose, clampNum, str, isPlainObject, freshPartId, PART_ID_PATTERN,
} from "./sanitize.js";

const GIMMICK_KINDS = ["game", "effect", "sound", "other"];

// ノードの種類の形（"event.gift" "flow.branch" "expr" …）。中身はブラウザ側の nodes.js が決める
const NODE_TYPE_RE = /^[a-z]+(\.[A-Za-z]{1,40})?$/;
const PIN_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

export const GIMMICK_LIMITS = {
  objects: 300,
  nodes: 600,
  links: 2000,
  comments: 100,
  sounds: 60,
  effects: 60,
  variables: 60,
  size: 4096,
  functions: 40,      // 関数とマクロを合わせた数
  functionNodes: 300, // 関数・マクロ1つのノードの数
  totalNodes: 3000,   // イベントグラフと関数・マクロを合わせたノードの数
  params: 16,         // 関数・マクロの入力（出力）の数
};

// 関数・マクロの入出力の種類（実行ピンはマクロだけ）
const PARAM_TYPES = ["number", "string", "bool", "entity", "any"];
const PARAM_ID_RE = /^p[0-9]{1,4}$/;

/** 配列の要素ごとに id を確かめ、重複や壊れた id は振り直す */
function withIds(list, limit, prefix, fn) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).slice(0, limit).map((raw) => {
    if (!isPlainObject(raw)) return null;
    const out = fn(raw);
    if (!out) return null;
    let id = typeof raw.id === "string" && PART_ID_PATTERN.test(raw.id) ? raw.id : "";
    if (!id || seen.has(id)) id = freshPartId(prefix);
    seen.add(id);
    return { ...out, id };
  }).filter(Boolean);
}

/** 細かい中身は形だけ整えて通す（id・種類など、決まった鍵だけ型を固定する） */
function loose(raw, fixed = {}) {
  const out = sanitizeLoose(raw) || {};
  delete out.id;
  return { ...out, ...fixed };
}

function sanitizeObject(raw) {
  return loose(raw, {
    name: str(raw.name, 80, "オブジェクト") || "オブジェクト",
    tag: str(raw.tag, 40),
    x: clampNum(raw.x, -GIMMICK_LIMITS.size * 2, GIMMICK_LIMITS.size * 2, 0),
    y: clampNum(raw.y, -GIMMICK_LIMITS.size * 2, GIMMICK_LIMITS.size * 2, 0),
    w: clampNum(raw.w, 1, GIMMICK_LIMITS.size * 2, 80),
    h: clampNum(raw.h, 1, GIMMICK_LIMITS.size * 2, 80),
    rotation: clampNum(raw.rotation, -3600, 3600, 0),
    opacity: clampNum(raw.opacity, 0, 1, 1),
    prefab: raw.prefab === true,
    hidden: raw.hidden === true,
  });
}

/**
 * ブループリント（ノードとそのつながり）。
 *   nodes:    [{id, type, x, y, values}]       values はピンに書いた値とノードの設定
 *   links:    [{from, fromPin, to, toPin}]     出力ピン → 入力ピン
 *   comments: [{id, x, y, w, h, text, color}]  ノードを囲むメモ（UE のコメント）
 * つながりは、両端のノードが実在するものだけ残す（同じつながりの重複も捨てる）。
 */
function sanitizeGraph(raw, limit = GIMMICK_LIMITS.nodes) {
  const src = isPlainObject(raw) ? raw : {};
  const nodes = withIds(src.nodes, Math.max(0, limit), "n", (n) => {
    if (typeof n.type !== "string" || !NODE_TYPE_RE.test(n.type)) return null;
    return {
      type: n.type,
      x: Math.round(clampNum(n.x, -100000, 100000, 0)),
      y: Math.round(clampNum(n.y, -100000, 100000, 0)),
      values: isPlainObject(n.values) ? sanitizeLoose(n.values) ?? {} : {},
    };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set();
  const links = (Array.isArray(src.links) ? src.links : []).slice(0, GIMMICK_LIMITS.links).filter((l) => {
    if (!isPlainObject(l) || !ids.has(l.from) || !ids.has(l.to) || l.from === l.to) return false;
    if (!PIN_RE.test(String(l.fromPin)) || !PIN_RE.test(String(l.toPin))) return false;
    const key = `${l.from}:${l.fromPin}>${l.to}:${l.toPin}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((l) => ({ from: l.from, fromPin: l.fromPin, to: l.to, toPin: l.toPin }));
  const comments = withIds(src.comments, GIMMICK_LIMITS.comments, "cm", (c) => ({
    x: Math.round(clampNum(c.x, -100000, 100000, 0)),
    y: Math.round(clampNum(c.y, -100000, 100000, 0)),
    w: Math.round(clampNum(c.w, 80, 20000, 400)),
    h: Math.round(clampNum(c.h, 60, 20000, 240)),
    text: str(c.text, 200, "コメント"),
    color: str(c.color, 40, "#ffffff"),
  }));
  return { nodes, links, comments };
}

/**
 * 自作の関数・マクロ。
 *   {id, name, kind: "function" | "macro", pure, desc, inputs: [{id, name, type}], outputs: [...], graph}
 * 入出力の id（p1, p2 …）はそのままピンの名前になるので、形を決めて、関数の中で重ならないようにする。
 * ノードの数は、イベントグラフと合わせて totalNodes まで（多すぎる分は、後ろの関数から捨てる）。
 */
function sanitizeFunctions(list, nodesLeft) {
  let left = nodesLeft;
  return withIds(list, GIMMICK_LIMITS.functions, "fn", (f) => {
    const kind = f.kind === "macro" ? "macro" : "function";
    const used = new Set();
    let next = 1;
    const param = (p, fallback) => {
      if (!isPlainObject(p)) return null;
      // 実行ピン（exec）はマクロだけ。関数の exec は捨て、知らない種類は「なんでも」にする
      if (p.type === "exec" && kind === "function") return null;
      const type = PARAM_TYPES.includes(p.type) || p.type === "exec" ? p.type : "any";
      let id = typeof p.id === "string" && PARAM_ID_RE.test(p.id) && !used.has(p.id) ? p.id : "";
      while (!id || used.has(id)) id = `p${next++}`;
      used.add(id);
      return { id, name: str(p.name, 40).trim() || fallback, type };
    };
    const params = (raw, fallback) => (Array.isArray(raw) ? raw : []).slice(0, GIMMICK_LIMITS.params).map((p) => param(p, fallback)).filter(Boolean);
    const inputs = params(f.inputs, "入力");
    const outputs = params(f.outputs, "出力");
    const graph = sanitizeGraph(f.graph, Math.min(GIMMICK_LIMITS.functionNodes, left));
    left -= graph.nodes.length;
    return {
      name: str(f.name, 60).trim() || (kind === "macro" ? "マクロ" : "関数"),
      kind,
      pure: kind === "function" && f.pure === true,
      desc: str(f.desc, 300),
      inputs,
      outputs,
      graph,
    };
  });
}

// 式の中で別の意味を持つ名前・オブジェクトの仕組みに触る名前は、変数にできない
const RESERVED_VAR_NAMES = new Set(["W", "H", "t", "time", "self", "other", "true", "false", "and", "or", "not", "constructor", "prototype"]);

/** 変数の名前として使えるか（英数字・日本語・_。数字で始めない・__ で始めない） */
function isValidGimmickVarName(name) {
  return typeof name === "string" && name.length <= 40 && /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) &&
    !name.startsWith("__") && !RESERVED_VAR_NAMES.has(name);
}

function sanitizeVariable(raw) {
  // 式の中で名前として読めるもの（日本語も可）。数字で始まるもの・記号入りは捨てる
  const name = str(raw.name, 40).trim();
  if (!isValidGimmickVarName(name)) return null;
  const value = typeof raw.value === "number" && Number.isFinite(raw.value) ? raw.value : str(raw.value, 400);
  return {
    name,
    value,
    exposed: raw.exposed === true,
    label: str(raw.label, 80),
  };
}

/** 名前が重なる変数は最初のものだけ残す */
function uniqueByName(list) {
  const seen = new Set();
  return list.filter((v) => {
    if (!v || seen.has(v.name)) return false;
    seen.add(v.name);
    return true;
  });
}

function graphs(src) {
  const graph = sanitizeGraph(src.graph);
  return { graph, functions: sanitizeFunctions(src.functions, GIMMICK_LIMITS.totalNodes - graph.nodes.length) };
}

/**
 * 届いたギミックを保存できる形にする。
 * @param {unknown} raw
 * @param {string} id 保存先のID（本文の id は信用しない）
 */
export function sanitizeGimmick(raw, id) {
  const src = isPlainObject(raw) ? raw : {};
  return {
    id,
    name: str(src.name, 80, "無題のギミック").trim() || "無題のギミック",
    kind: GIMMICK_KINDS.includes(src.kind) ? src.kind : "other",
    description: str(src.description, 500),
    width: Math.round(clampNum(src.width, 16, GIMMICK_LIMITS.size, 800)),
    height: Math.round(clampNum(src.height, 16, GIMMICK_LIMITS.size, 600)),
    background: str(src.background, 80, "transparent") || "transparent",
    gravity: clampNum(src.gravity, -10000, 10000, 1200),
    variables: uniqueByName((Array.isArray(src.variables) ? src.variables : [])
      .slice(0, GIMMICK_LIMITS.variables)
      .map((v) => (isPlainObject(v) ? sanitizeVariable(v) : null))),
    objects: withIds(src.objects, GIMMICK_LIMITS.objects, "obj", sanitizeObject),
    ...graphs(src),
    sounds: withIds(src.sounds, GIMMICK_LIMITS.sounds, "snd", (s) => loose(s, { name: str(s.name, 80, "サウンド") || "サウンド" })),
    effects: withIds(src.effects, GIMMICK_LIMITS.effects, "fx", (e) => loose(e, { name: str(e.name, 80, "エフェクト") || "エフェクト" })),
    updatedAt: Date.now(),
  };
}

/** 一覧に出す要約 */
export function gimmickSummary(g) {
  return {
    id: g.id,
    name: g.name,
    kind: g.kind,
    description: g.description,
    width: g.width,
    height: g.height,
    objects: g.objects.length,
    nodes: g.graph.nodes.length + (g.functions || []).reduce((n, f) => n + f.graph.nodes.length, 0),
    functions: (g.functions || []).length,
    updatedAt: g.updatedAt,
    signals: gimmickSignals(g),
  };
}

/** アーティストモードのルールから送れる合図の名前（ブループリントの「合図を受けたとき」） */
export function gimmickSignals(g) {
  const names = new Set();
  for (const n of g.graph?.nodes || []) {
    const name = n.values?.name;
    if (n.type === "event.signal" && typeof name === "string" && name.trim()) names.add(name.trim());
  }
  return [...names];
}

/** シーンに置いてあるギミックの ID（オーバーレイに一緒に渡す） */
export function referencedGimmickIds(elements) {
  const ids = new Set();
  const walk = (list) => {
    for (const el of list || []) {
      if (el?.type === "gimmick" && typeof el.cfg?.gimmickId === "string") ids.add(el.cfg.gimmickId);
      if (el?.type === "group") walk(el.children);
    }
  };
  walk(elements);
  return [...ids];
}
