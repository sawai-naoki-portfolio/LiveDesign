// public/js/studio/shared/gimmick/registry.js
// 画面で使うギミックの中身の置き場（アーティストモードのエディタとオーバーレイで共有）。
//
// デザインの「ギミック枠」は ID だけを持ち、中身はここから引く（Unity のプレハブと同じく、
// クリエイターモードで直すと、置いてある全部のデザインに反映される）。
//   エディタ    … /api/studio/gimmicks?full=1 で全部読む
//   オーバーレイ … /api/public/scenes/:id に添えられた gimmicks を読む
// どちらも、保存されると WebSocket の studioGimmick が届くので put() で差し替える。
const defs = new Map();
const listeners = new Set();

export const getGimmick = (id) => defs.get(id) || null;
export const allGimmicks = () => [...defs.values()];

export function putGimmick(def) {
  if (!def?.id) return;
  // 同じ中身をもう一度受け取っても、動いているギミックを最初からやり直さない
  // （デザインを保存するたびに、添えられたギミックが届くため）
  const before = defs.get(def.id);
  if (before && JSON.stringify(before) === JSON.stringify(def)) return;
  defs.set(def.id, def);
  for (const fn of listeners) fn(def.id, def);
}

export function putGimmicks(list) {
  for (const def of Array.isArray(list) ? list : Object.values(list || {})) putGimmick(def);
}

export function removeGimmick(id) {
  if (!defs.delete(id)) return;
  for (const fn of listeners) fn(id, null);
}

/** 中身が変わったら呼ぶ（id, def|null）。やめるときは戻り値を呼ぶ */
export function onGimmick(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
