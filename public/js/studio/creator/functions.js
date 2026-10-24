// public/js/studio/creator/functions.js
// 自作の関数・マクロを作る・消す・入出力（ピン）を変える。ギミックのデータだけを触る
// （画面は graph.js の「マイブループリント」と、inspector.js の関数の設定）。
//
// 入出力を消したり種類を変えたりすると、そのピンにつながっていた線は使えなくなるので、
// イベントグラフと全部の関数・マクロから、合わなくなった線を取り除く（pruneLinks）。
import { NODE_TYPES, fnOf, pinsOf, canConnect, newNode } from "../shared/gimmick/nodes.js";
import { uid, clone } from "../shared/model.js";

export const FN_KIND_LABELS = { function: "関数", macro: "マクロ" };

/** 関数・マクロの一覧（無ければ作る） */
export function functionsOf(g) {
  if (!Array.isArray(g.functions)) g.functions = [];
  return g.functions;
}

/** イベントグラフと、全部の関数・マクロのグラフ */
export function allGraphs(g) {
  return [{ fn: null, graph: g.graph }, ...functionsOf(g).map((f) => ({ fn: f, graph: f.graph }))].filter((x) => x.graph);
}

/** 同じ名前が無いようにする（「新しい関数」「新しい関数 2」…） */
export function uniqueFnName(g, base, exceptId = null) {
  const names = new Set(functionsOf(g).filter((f) => f.id !== exceptId).map((f) => f.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

function nextParamId(f) {
  const used = new Set([...f.inputs, ...f.outputs].map((p) => p.id));
  for (let i = 1; ; i++) if (!used.has(`p${i}`)) return `p${i}`;
}

const ENTRY = { function: "fn.entry", macro: "macro.in" };
const EXIT = { function: "fn.return", macro: "macro.out" };

/** 入口のノード（関数なら fn.entry、マクロなら macro.in） */
export const isEntryNode = (n) => n?.type === "fn.entry" || n?.type === "macro.in";

/** 新しい関数・マクロ。入口と出口をつないだ状態で作る */
export function createFunction(g, kind, name) {
  const id = uid("fn");
  const f = {
    id,
    name: uniqueFnName(g, name || (kind === "macro" ? "新しいマクロ" : "新しい関数")),
    kind,
    pure: false,
    desc: "",
    inputs: kind === "macro" ? [{ id: "p1", name: "実行", type: "exec" }] : [],
    outputs: kind === "macro" ? [{ id: "p2", name: "続き", type: "exec" }] : [],
    graph: { nodes: [], links: [], comments: [] },
  };
  const a = newNode(ENTRY[kind], 0, 0, { fn: id }, uid("n"));
  const b = newNode(EXIT[kind], 480, 0, { fn: id }, uid("n"));
  f.graph.nodes.push(a, b);
  f.graph.links.push(kind === "macro"
    ? { from: a.id, fromPin: "p1", to: b.id, toPin: "p2" }
    : { from: a.id, fromPin: "then", to: b.id, toPin: "exec" });
  functionsOf(g).push(f);
  return f;
}

/** 開くときに、形を整える（入口が無ければ置く・入口と出口に自分の id を書く） */
export function ensureFunctionGraph(f) {
  f.graph = f.graph && typeof f.graph === "object" ? f.graph : {};
  for (const k of ["nodes", "links", "comments"]) f.graph[k] = Array.isArray(f.graph[k]) ? f.graph[k] : [];
  f.inputs = Array.isArray(f.inputs) ? f.inputs : [];
  f.outputs = Array.isArray(f.outputs) ? f.outputs : [];
  for (const n of f.graph.nodes) {
    if (NODE_TYPES[n.type]?.inner && n.values?.fn !== f.id) n.values = { ...(n.values || {}), fn: f.id };
  }
  if (!f.graph.nodes.some((n) => n.type === ENTRY[f.kind])) {
    const x = Math.min(0, ...f.graph.nodes.map((n) => n.x)) - (f.graph.nodes.length ? 320 : 0);
    f.graph.nodes.unshift(newNode(ENTRY[f.kind], x, 0, { fn: f.id }, uid("n")));
  }
  return f;
}

/** 呼んでいるノードの数（イベントグラフと全部の関数・マクロの中） */
export function callSites(g, fnId) {
  let n = 0;
  for (const { graph } of allGraphs(g)) n += graph.nodes.filter((x) => (x.type === "call.function" || x.type === "call.macro") && x.values?.fn === fnId).length;
  return n;
}

/** 関数・マクロを消す。呼んでいるノードも消す（UE と同じ）。消した呼ぶノードの数を返す */
export function deleteFunction(g, fnId) {
  g.functions = functionsOf(g).filter((f) => f.id !== fnId);
  let removed = 0;
  for (const { graph } of allGraphs(g)) {
    const gone = new Set(graph.nodes.filter((x) => (x.type === "call.function" || x.type === "call.macro") && x.values?.fn === fnId).map((x) => x.id));
    if (!gone.size) continue;
    removed += gone.size;
    graph.nodes = graph.nodes.filter((x) => !gone.has(x.id));
    graph.links = graph.links.filter((l) => !gone.has(l.from) && !gone.has(l.to));
  }
  return removed;
}

/** 複製（中のノードの id も振り直す） */
export function duplicateFunction(g, fnId) {
  const src = fnOf(g, fnId);
  if (!src) return null;
  const f = clone(src);
  f.id = uid("fn");
  f.name = uniqueFnName(g, `${src.name} のコピー`);
  const map = new Map();
  for (const n of f.graph.nodes) {
    const id = uid("n");
    map.set(n.id, id);
    n.id = id;
    if (NODE_TYPES[n.type]?.inner) n.values = { ...(n.values || {}), fn: f.id };
  }
  f.graph.links = f.graph.links.filter((l) => map.has(l.from) && map.has(l.to)).map((l) => ({ ...l, from: map.get(l.from), to: map.get(l.to) }));
  const list = functionsOf(g);
  list.splice(list.findIndex((x) => x.id === fnId) + 1, 0, f);
  return f;
}

/** 合わなくなった線（無いピン・種類が合わない・無いノード）を全部のグラフから取り除く */
export function pruneLinks(g) {
  for (const { graph } of allGraphs(g)) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const pins = new Map();
    const pinsFor = (n) => {
      if (!pins.has(n.id)) pins.set(n.id, pinsOf(n, g));
      return pins.get(n.id);
    };
    graph.links = graph.links.filter((l) => {
      const a = byId.get(l.from);
      const b = byId.get(l.to);
      if (!a || !b || !NODE_TYPES[a.type] || !NODE_TYPES[b.type]) return !!(a && b); // 知らない種類のノードの線は、そのまま残す
      const o = pinsFor(a).outputs.find((p) => p.name === l.fromPin);
      const i = pinsFor(b).inputs.find((p) => p.name === l.toPin);
      return !!o && !!i && canConnect(o.type, i.type);
    });
  }
}

const PARAM_NAMES = { in: ["入力", "実行"], out: ["出力", "続き"] };

/** 入力（dir = "in"）か出力（"out"）を1つ足す */
export function addParam(g, fnId, dir, type = "number") {
  const f = fnOf(g, fnId);
  if (!f) return null;
  const list = dir === "in" ? f.inputs : f.outputs;
  if (list.length >= 16) return null;
  const base = PARAM_NAMES[dir][type === "exec" ? 1 : 0];
  const names = new Set(list.map((p) => p.name));
  let name = base;
  for (let i = 2; names.has(name); i++) name = `${base}${i}`;
  const p = { id: nextParamId(f), name, type: f.kind === "function" && type === "exec" ? "number" : type };
  list.push(p);
  return p;
}

export function updateParam(g, fnId, pid, patch) {
  const f = fnOf(g, fnId);
  const p = f && [...f.inputs, ...f.outputs].find((x) => x.id === pid);
  if (!p) return;
  if (typeof patch.name === "string") p.name = patch.name.slice(0, 40);
  if (patch.type && (patch.type !== "exec" || f.kind === "macro")) p.type = patch.type;
  pruneLinks(g);
}

export function removeParam(g, fnId, pid) {
  const f = fnOf(g, fnId);
  if (!f) return;
  f.inputs = f.inputs.filter((p) => p.id !== pid);
  f.outputs = f.outputs.filter((p) => p.id !== pid);
  pruneLinks(g);
}

export function moveParam(g, fnId, pid, delta) {
  const f = fnOf(g, fnId);
  if (!f) return;
  for (const list of [f.inputs, f.outputs]) {
    const i = list.findIndex((p) => p.id === pid);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) continue;
    [list[i], list[j]] = [list[j], list[i]];
  }
}

/** ピュア（実行ピンなしで、読まれるたびに計算する）にするか */
export function setPure(g, fnId, pure) {
  const f = fnOf(g, fnId);
  if (!f || f.kind !== "function") return;
  f.pure = !!pure;
  pruneLinks(g);
}

/**
 * 選んだノードを、新しい関数・マクロにまとめる（UE の「関数に折りたたむ」）。
 * 外から入ってくる線は入力に、外へ出ていく線は出力になり、元の場所には呼ぶノードを1つ置く。
 * 関数は実行の出入りがそれぞれ1本までなので、まとめられないときは理由の文字を返す。
 * @returns {{fn: object, call: object} | string}
 */
export function collapseToFunction(g, graph, ids, kind) {
  const inside = (id) => ids.has(id);
  const nodes = graph.nodes.filter((n) => inside(n.id));
  if (!nodes.length) return "ノードを選んでください";
  if (nodes.some((n) => NODE_TYPES[n.type]?.kind === "event")) return "イベントのノードは関数・マクロに入れられません";
  if (nodes.some((n) => NODE_TYPES[n.type]?.inner)) return "入口・出口のノードはまとめられません";
  if (kind === "function" && nodes.some((n) => n.type === "flow.delay")) return "「待つ」は関数に入れられません（マクロにまとめてください）";
  const pinOf = (n, dir, name) => (dir === "in" ? pinsOf(n, g).inputs : pinsOf(n, g).outputs).find((p) => p.name === name);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const incoming = graph.links.filter((l) => !inside(l.from) && inside(l.to));
  const outgoing = graph.links.filter((l) => inside(l.from) && !inside(l.to));
  const execIn = incoming.filter((l) => pinOf(byId.get(l.to), "in", l.toPin)?.type === "exec");
  const execOut = outgoing.filter((l) => pinOf(byId.get(l.from), "out", l.fromPin)?.type === "exec");
  if (kind === "function") {
    if (new Set(execIn.map((l) => `${l.to}:${l.toPin}`)).size > 1) return "関数に入る実行の線は1か所までです（マクロにまとめてください）";
    if (new Set(execOut.map((l) => `${l.from}:${l.fromPin}`)).size > 1) return "関数から出る実行の線は1か所までです（マクロにまとめてください）";
  }

  const f = createFunction(g, kind, kind === "macro" ? "まとめたマクロ" : "まとめた関数");
  f.inputs = [];
  f.outputs = [];
  f.graph.links = [];
  const entry = f.graph.nodes[0];
  const exit = f.graph.nodes[1];
  const x0 = Math.min(...nodes.map((n) => n.x));
  const y0 = Math.min(...nodes.map((n) => n.y));
  const x1 = Math.max(...nodes.map((n) => n.x));
  entry.x = -320;
  exit.x = x1 - x0 + 360;
  entry.y = exit.y = 0;
  f.graph.nodes.splice(1, 0, ...nodes.map((n) => ({ ...clone(n), x: n.x - x0, y: n.y - y0 })));
  f.graph.links.push(...clone(graph.links.filter((l) => inside(l.from) && inside(l.to))));
  const call = newNode(kind === "macro" ? "call.macro" : "call.function", x0, y0, { fn: f.id }, uid("n"));
  const outerLinks = graph.links.filter((l) => !inside(l.from) && !inside(l.to));

  // 入ってくる線：同じ外のピン（データ）・同じ中のピン（実行）は1つの入力にまとめる
  const inKey = new Map();
  for (const l of incoming) {
    const target = byId.get(l.to);
    const p = pinOf(target, "in", l.toPin);
    if (!p) continue;
    const exec = p.type === "exec";
    const key = exec ? `x:${l.to}:${l.toPin}` : `d:${l.from}:${l.fromPin}`;
    let param = inKey.get(key);
    if (!param) {
      param = { id: nextParamId(f), name: exec ? (kind === "function" ? "" : "実行") : (p.label || "入力"), type: exec ? "exec" : p.type };
      if (!(kind === "function" && exec)) f.inputs.push(param);
      inKey.set(key, param);
      outerLinks.push(exec && kind === "function"
        ? { from: l.from, fromPin: l.fromPin, to: call.id, toPin: "exec" }
        : { from: l.from, fromPin: l.fromPin, to: call.id, toPin: param.id });
    } else if (exec) {
      outerLinks.push(kind === "function" ? { from: l.from, fromPin: l.fromPin, to: call.id, toPin: "exec" } : { from: l.from, fromPin: l.fromPin, to: call.id, toPin: param.id });
    }
    f.graph.links.push(exec && kind === "function"
      ? { from: entry.id, fromPin: "then", to: l.to, toPin: l.toPin }
      : { from: entry.id, fromPin: param.id, to: l.to, toPin: l.toPin });
  }
  // 出ていく線：同じ中のピンは1つの出力にまとめる
  const outKey = new Map();
  for (const l of outgoing) {
    const src = byId.get(l.from);
    const p = pinOf(src, "out", l.fromPin);
    if (!p) continue;
    const exec = p.type === "exec";
    const key = `${l.from}:${l.fromPin}`;
    let param = outKey.get(key);
    if (!param) {
      param = { id: nextParamId(f), name: exec ? (kind === "function" ? "" : "続き") : (p.label || "出力"), type: exec ? "exec" : p.type };
      if (!(kind === "function" && exec)) f.outputs.push(param);
      outKey.set(key, param);
      f.graph.links.push(exec && kind === "function"
        ? { from: l.from, fromPin: l.fromPin, to: exit.id, toPin: "exec" }
        : { from: l.from, fromPin: l.fromPin, to: exit.id, toPin: param.id });
    }
    outerLinks.push(exec && kind === "function"
      ? { from: call.id, fromPin: "then", to: l.to, toPin: l.toPin }
      : { from: call.id, fromPin: param.id, to: l.to, toPin: l.toPin });
  }
  // 実行の線が外から入ってこなかったとき：入口から、中で最初に動きそうなノードへつなぐ
  const hasExecIn = (n) => pinsOf(n, g).inputs.some((p) => p.type === "exec");
  const execInside = nodes.some(hasExecIn);
  if (!execIn.length && execInside) {
    const first = nodes.find((n) => hasExecIn(n) && !graph.links.some((l) => l.to === n.id && inside(l.from) && pinOf(n, "in", l.toPin)?.type === "exec"));
    if (first && kind === "function") f.graph.links.push({ from: entry.id, fromPin: "then", to: first.id, toPin: "exec" });
    if (first && kind === "macro") {
      const p = { id: nextParamId(f), name: "実行", type: "exec" };
      f.inputs.unshift(p);
      f.graph.links.push({ from: entry.id, fromPin: p.id, to: first.id, toPin: "exec" });
    }
  }
  // 実行の線が外へ出ていかなかったとき：実行の出口がどこにもつながっていない最後のノードから出口へ
  if (!execOut.length && execInside) {
    const last = [...nodes].reverse().find((n) => pinsOf(n, g).outputs.some((p) => p.name === "then") && !graph.links.some((l) => l.from === n.id && l.fromPin === "then"));
    if (last && kind === "function") f.graph.links.push({ from: last.id, fromPin: "then", to: exit.id, toPin: "exec" });
    if (last && kind === "macro") {
      const p = { id: nextParamId(f), name: "続き", type: "exec" };
      f.outputs.unshift(p);
      f.graph.links.push({ from: last.id, fromPin: "then", to: exit.id, toPin: p.id });
    }
  }
  // 計算のノードだけをまとめた関数は、ピュア関数にする
  if (kind === "function" && !execInside) f.pure = true;
  // 入出力の名前が重ならないように
  for (const list of [f.inputs, f.outputs]) {
    const seen = new Map();
    for (const p of list) {
      const n = (seen.get(p.name) || 0) + 1;
      seen.set(p.name, n);
      if (n > 1) p.name = `${p.name}${n}`;
    }
  }
  const dedupe = (links) => {
    const seen = new Set();
    return links.filter((l) => {
      const k = `${l.from}:${l.fromPin}>${l.to}:${l.toPin}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  f.graph.links = dedupe(f.graph.links);
  graph.nodes = [...graph.nodes.filter((n) => !inside(n.id)), call];
  graph.links = dedupe(outerLinks);
  pruneLinks(g);
  return { fn: f, call };
}
