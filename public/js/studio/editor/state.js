// public/js/studio/editor/state.js
// エディタの状態（開いているシーン・選択・道具・表示倍率）と、元に戻す／やり直し・自動保存。
//
// シーンを書き換えるのは change() か live()→endLive() だけ（中身は editor/document.js）。
//   change(fn)      … 1回の操作（プロパティの変更・削除・並べ替え）。履歴に1つ積む
//   live(fn)        … ドラッグ中など、指を離すまで何度も呼ぶもの。履歴は endLive() で1つだけ
// 同じ欄を続けて触った変更（色を選んでいる途中など）は coalesce で1つにまとめる。
import { api } from "./api.js";
import { createDocument } from "./document.js";
import { clone, findElement, refreshGroup } from "../shared/model.js";

const listeners = new Set();

export const store = {
  scene: null,
  /** @type {string[]} */
  selection: [],
  tool: "select",
  zoom: 0.5,
  panX: 0,
  panY: 0,
  /** ダブルクリックで中に入っているグループ */
  enteredGroup: null,
  /** パスの点を編集中の要素 */
  nodeEdit: null,
  /** 文字を編集中の要素 */
  editingText: null,
  snap: true,
  livePreview: true,
  sound: true,
  saveState: "saved",
};

/**
 * @param {(kind: "scene"|"selection"|"tool"|"view"|"save"|"rules", detail?: object) => void} fn
 */
export function on(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(kind, detail) {
  for (const fn of listeners) {
    try { fn(kind, detail); } catch (e) { console.error(e); }
  }
}

// ===============================
// 履歴と保存（editor/document.js）
// ===============================
export const {
  change, live, endLive, undo, redo, canUndo, canRedo, resetHistory, flushSave,
} = createDocument({
  get: () => store.scene,
  snapshot: () => JSON.stringify({
    name: store.scene.name, width: store.scene.width, height: store.scene.height,
    background: store.scene.background, elements: store.scene.elements, rules: store.scene.rules,
    meta: store.scene.meta,
  }),
  restore(json) {
    Object.assign(store.scene, JSON.parse(json));
    // 消えた要素を選んだままにしない
    store.selection = store.selection.filter((id) => findElement(store.scene.elements, id));
    store.nodeEdit = null;
    store.editingText = null;
  },
  // グループの枠は中身から決まるので、書き換えのたびに合わせ直す
  normalize(scene) {
    for (const el of scene.elements) if (el.type === "group") refreshGroup(el);
  },
  save: (scene) => api.saveScene(scene.id, clone(scene)),
  onChange(detail) {
    emit("scene", detail);
    if (detail.history) emit("selection");
  },
  onSaveState(state) {
    store.saveState = state;
    emit("save");
  },
});

// ===============================
// 選択
// ===============================
export function select(ids, { add = false, toggle = false } = {}) {
  const list = Array.isArray(ids) ? ids : ids ? [ids] : [];
  if (toggle) {
    const set = new Set(store.selection);
    for (const id of list) set.has(id) ? set.delete(id) : set.add(id);
    store.selection = [...set];
  } else if (add) {
    store.selection = [...new Set([...store.selection, ...list])];
  } else {
    store.selection = list;
  }
  if (store.nodeEdit && !store.selection.includes(store.nodeEdit)) store.nodeEdit = null;
  emit("selection");
}

/** 選んでいる要素（実体。書き換えは change() の中で） */
export function selected() {
  if (!store.scene) return [];
  return store.selection.map((id) => findElement(store.scene.elements, id)?.el).filter(Boolean);
}

export function setTool(tool) {
  store.tool = tool;
  if (tool !== "select") store.nodeEdit = null;
  emit("tool");
}
