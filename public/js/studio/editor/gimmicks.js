// public/js/studio/editor/gimmicks.js
// アーティストモードから見たギミック（クリエイターモードで作ったもの）：読み込み・見本・置く。
import { api } from "./api.js";
import { h } from "./ui.js";
import { addElement } from "./ops.js";
import { store } from "./state.js";
import { createElement } from "../shared/model.js";
import { createPlayer } from "../shared/gimmick/player.js";
import { putGimmicks, allGimmicks, getGimmick } from "../shared/gimmick/registry.js";

/** 自分のギミックを全部読む（デザインに置いたギミック枠が中身を引けるように） */
export async function loadGimmicks() {
  try {
    putGimmicks(await api.listGimmicks({ full: true }));
  } catch (e) {
    console.warn("ギミックを読み込めませんでした", e);
  }
  return allGimmicks();
}

/** 新しいものから並べる */
export const gimmickList = () => allGimmicks().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

export const gimmickOptions = () => gimmickList().map((g) => [g.id, g.name]);

/** ギミックの見本（止めた1コマ） */
export function gimmickThumb(def, W = 260, H = 160) {
  const box = h("div", { class: `gm-thumb${def.background === "transparent" ? " checker" : ""}` });
  if (W) box.style.width = `${W}px`;
  if (H) box.style.height = `${H}px`;
  try {
    createPlayer(box, def, { mode: "thumb" });
  } catch (e) {
    box.textContent = "🧩";
  }
  return box;
}

/** デザインにギミック枠を置く（大きさはギミックのステージに合わせ、はみ出すなら縮める） */
export function placeGimmick(id, at) {
  const def = getGimmick(id);
  if (!def || !store.scene) return;
  const s = store.scene;
  const f = Math.min(1, (s.width * 0.8) / def.width, (s.height * 0.8) / def.height);
  const el = createElement("gimmick", {
    name: def.name, w: Math.round(def.width * f), h: Math.round(def.height * f),
    cfg: { gimmickId: def.id, vars: [], live: true },
  });
  addElement(el, at ? { at } : { center: true });
}

/** クリエイターモードで開く（別のタブ） */
export function openInCreator(id) {
  window.open(id ? `/studio?gimmick=${encodeURIComponent(id)}` : "/studio?mode=creator", "_blank");
}
