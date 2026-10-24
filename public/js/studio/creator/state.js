// public/js/studio/creator/state.js
// クリエイターモードの状態（開いているギミック・選んでいるもの・再生中か）と、
// 元に戻す／やり直し・自動保存（中身はアーティストモードと同じ editor/document.js）。
//
//   change(fn, {coalesce})  … 1回の操作。履歴に1つ積む（同じ欄を続けて触ったものはまとめる）
//   live(fn) → endLive()    … ドラッグ中。履歴は離したときに1つ
import { api } from "../editor/api.js";
import { createDocument } from "../editor/document.js";
import { clone } from "../shared/model.js";

const listeners = new Set();

export const cstore = {
  /** @type {object|null} */
  gimmick: null,
  /** 選んでいるもの {type: "object"|"sound"|"effect"|"variable"|"node"|"function", id} */
  selection: null,
  /** ブループリントで開いているグラフ（null ＝ イベントグラフ、それ以外は関数・マクロの id） */
  graphId: null,
  /** "stopped" | "playing" | "paused" */
  play: "stopped",
  zoom: 1,
  saveState: "saved",
  sound: true,
};

/** @param {(kind: "gimmick"|"selection"|"play"|"save"|"log"|"view", detail?: any) => void} fn */
export function onC(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitC(kind, detail) {
  for (const fn of listeners) {
    try { fn(kind, detail); } catch (e) { console.error(e); }
  }
}

// ===============================
// 履歴と保存（editor/document.js）
// ===============================
const KEYS = ["name", "kind", "description", "width", "height", "background", "gravity", "variables", "objects", "graph", "functions", "sounds", "effects"];

export const {
  change, live, endLive, undo, redo, canUndo, canRedo, flushSave: flushSaveC,
} = createDocument({
  get: () => cstore.gimmick,
  snapshot: () => JSON.stringify(KEYS.map((k) => cstore.gimmick[k])),
  restore(json) {
    const vals = JSON.parse(json);
    KEYS.forEach((k, i) => { cstore.gimmick[k] = k === "functions" ? vals[i] ?? [] : vals[i]; });
    if (cstore.graphId && !cstore.gimmick.functions.some((f) => f.id === cstore.graphId)) cstore.graphId = null;
    if (cstore.selection && !findSelected()) cstore.selection = null;
  },
  save: (g) => api.saveGimmick(g.id, clone(g)),
  onChange(detail) {
    emitC("gimmick", detail);
    if (detail.history) emitC("selection");
  },
  onSaveState(state) {
    cstore.saveState = state;
    emitC("save");
  },
});

// ===============================
// 選択
// ===============================
const LISTS = { object: "objects", sound: "sounds", effect: "effects" };

export function selectC(type, id) {
  cstore.selection = type ? { type, id } : null;
  emitC("selection");
}

/** 選んでいるものの実体（書き換えは change() の中で） */
function findSelected(g = cstore.gimmick) {
  const s = cstore.selection;
  if (!s || !g) return null;
  return findIn(g, s.type, s.id) || null;
}

/** グラフ（null ＝ イベントグラフ、それ以外は関数・マクロの id）。無ければ null */
export function graphFor(g, graphId = cstore.graphId) {
  if (!graphId) return g.graph || null;
  return (g.functions || []).find((f) => f.id === graphId)?.graph || null;
}

export function findIn(g, type, id) {
  if (type === "variable") return g.variables.find((v) => v.name === id);
  // ノードは、開いているグラフの中から探す
  if (type === "node") return graphFor(g)?.nodes?.find((n) => n.id === id);
  if (type === "function") return (g.functions || []).find((f) => f.id === id);
  return g[LISTS[type]]?.find((x) => x.id === id);
}

// ===============================
// 再生
// ===============================
export function setPlay(state) {
  cstore.play = state;
  emitC("play");
}
