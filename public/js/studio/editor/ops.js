// public/js/studio/editor/ops.js
// 選択した要素への操作（複製・削除・グループ・重ね順・整列・コピー＆ペースト）。
import { store, change, select, selected } from "./state.js";
import { prefs } from "./ui.js";
import {
  clone, uid, findElement, aabb, unionBox, translate, refreshGroup, createElement, flatten,
} from "../shared/model.js";

/** 要素とその中身に新しい id を振る（複製・貼り付け） */
function reassignIds(el) {
  el.id = uid(el.type);
  if (el.type === "group") el.children.forEach(reassignIds);
  return el;
}

/** 選択を、同じ入れ物（親）ごとにまとめて返す */
function selectedEntries(scene) {
  return store.selection
    .map((id) => findElement(scene.elements, id))
    .filter(Boolean);
}

/** 要素を足して選ぶ（at: その点を中心に / center: キャンバスの中央に） */
export function addElement(el, { at, center = false } = {}) {
  change((scene) => {
    if (at) {
      el.x = Math.round(at.x - el.w / 2);
      el.y = Math.round(at.y - el.h / 2);
    } else if (center) {
      el.x = Math.round((scene.width - el.w) / 2);
      el.y = Math.round((scene.height - el.h) / 2);
    }
    const target = store.enteredGroup && findElement(scene.elements, store.enteredGroup)?.el;
    (target?.children ?? scene.elements).push(el);
  });
  select(el.id);
  return el;
}

function addElements(list) {
  change((scene) => { scene.elements.push(...list); });
  select(list.map((e) => e.id));
}

export function deleteSelection() {
  if (!store.selection.length) return;
  change((scene) => {
    for (const { el, list } of selectedEntries(scene)) {
      const i = list.indexOf(el);
      if (i >= 0) list.splice(i, 1);
    }
    // 空になったグループは消す
    const prune = (list) => {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].type === "group") {
          prune(list[i].children);
          if (list[i].children.length === 0) list.splice(i, 1);
          else if (list[i].children.length === 1) list.splice(i, 1, list[i].children[0]);
        }
      }
    };
    prune(scene.elements);
  });
  if (store.enteredGroup && !findElement(store.scene.elements, store.enteredGroup)) store.enteredGroup = null;
  select([]);
}

export function duplicateSelection(offset = 24) {
  const ids = [];
  change((scene) => {
    for (const { el, list } of selectedEntries(scene)) {
      const copy = reassignIds(clone(el));
      copy.name = `${el.name}`;
      translate(copy, offset, offset);
      list.splice(list.indexOf(el) + 1, 0, copy);
      ids.push(copy.id);
    }
  });
  select(ids);
}

// ---- コピー＆ペースト（別のシーンにも貼れるよう localStorage にも置く） ----
let clipboard = null;
const CLIP_KEY = "ld-studio-clipboard";

export function copySelection() {
  const items = selected().map(clone);
  if (!items.length) return false;
  clipboard = items;
  prefs.setJson(CLIP_KEY, items);
  return true;
}

export function cutSelection() {
  if (copySelection()) deleteSelection();
}

export function paste() {
  const saved = prefs.getJson(CLIP_KEY);
  const items = Array.isArray(saved) ? saved : clipboard;
  if (!items?.length) return false;
  const copies = items.map((el) => {
    const c = reassignIds(clone(el));
    translate(c, 24, 24);
    return c;
  });
  // 次に貼るときはさらにずらす
  clipboard = copies.map(clone);
  prefs.setJson(CLIP_KEY, clipboard);
  addElements(copies);
  return true;
}

// ---- グループ ----
export function groupSelection() {
  const scene = store.scene;
  const entries = selectedEntries(scene);
  if (entries.length < 2) return;
  // 違う入れ物の要素はまとめない（グループの外と中を混ぜると重ね順が決められない）
  const list = entries[0].list;
  if (!entries.every((e) => e.list === list)) return;
  const group = createElement("group", { name: "グループ" });
  change(() => {
    const ordered = entries.map((e) => e.el).sort((a, b) => list.indexOf(a) - list.indexOf(b));
    const top = Math.max(...ordered.map((el) => list.indexOf(el)));
    group.children = ordered;
    refreshGroup(group);
    const insertAt = top - ordered.length + 1;
    for (const el of ordered) list.splice(list.indexOf(el), 1);
    list.splice(insertAt, 0, group);
  });
  select(group.id);
}

export function ungroupSelection() {
  const ids = [];
  change((scene) => {
    for (const { el, list } of selectedEntries(scene)) {
      if (el.type !== "group") continue;
      const i = list.indexOf(el);
      list.splice(i, 1, ...el.children);
      ids.push(...el.children.map((c) => c.id));
    }
  });
  if (ids.length) {
    store.enteredGroup = null;
    select(ids);
  }
}

// ---- 重ね順（配列の後ろほど手前） ----
export function arrange(where) {
  change((scene) => {
    const entries = selectedEntries(scene);
    const byList = new Map();
    for (const e of entries) {
      if (!byList.has(e.list)) byList.set(e.list, []);
      byList.get(e.list).push(e.el);
    }
    for (const [list, els] of byList) {
      const sorted = els.sort((a, b) => list.indexOf(a) - list.indexOf(b));
      if (where === "front" || where === "back") {
        for (const el of sorted) list.splice(list.indexOf(el), 1);
        if (where === "front") list.push(...sorted);
        else list.unshift(...sorted);
      } else if (where === "forward") {
        for (const el of [...sorted].reverse()) {
          const i = list.indexOf(el);
          if (i < list.length - 1 && !sorted.includes(list[i + 1])) list.splice(i, 2, list[i + 1], el);
        }
      } else if (where === "backward") {
        for (const el of sorted) {
          const i = list.indexOf(el);
          if (i > 0 && !sorted.includes(list[i - 1])) list.splice(i - 1, 2, el, list[i - 1]);
        }
      }
    }
  });
}

/** 並べ替え（レイヤーパネルのドラッグ）。dragId を targetId の前後・中へ */
export function moveElement(dragId, targetId, position) {
  if (dragId === targetId) return;
  change((scene) => {
    const drag = findElement(scene.elements, dragId);
    if (!drag) return;
    // 自分の中には入れない
    if (drag.el.type === "group" && findElement(drag.el.children, targetId)) return;
    drag.list.splice(drag.list.indexOf(drag.el), 1);
    if (position === "inside") {
      const t = findElement(scene.elements, targetId);
      if (t?.el.type === "group") { t.el.children.push(drag.el); return; }
    }
    const target = findElement(scene.elements, targetId);
    if (!target) { scene.elements.push(drag.el); return; }
    const i = target.list.indexOf(target.el);
    // レイヤーパネルは手前が上なので、「上に落とした」＝配列では後ろ
    target.list.splice(position === "above" ? i + 1 : i, 0, drag.el);
  });
}

// ---- 整列・分布 ----
export function align(how) {
  const scene = store.scene;
  const els = selected();
  if (!els.length) return;
  // 1つだけならキャンバスに、複数なら選択範囲に揃える
  const ref = els.length === 1 ? { x: 0, y: 0, w: scene.width, h: scene.height } : unionBox(els.map(aabb));
  change(() => {
    for (const el of els) {
      const b = aabb(el);
      let dx = 0;
      let dy = 0;
      if (how === "left") dx = ref.x - b.x;
      if (how === "center") dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
      if (how === "right") dx = ref.x + ref.w - (b.x + b.w);
      if (how === "top") dy = ref.y - b.y;
      if (how === "middle") dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
      if (how === "bottom") dy = ref.y + ref.h - (b.y + b.h);
      translate(el, Math.round(dx), Math.round(dy));
    }
  });
}

export function distribute(axis) {
  const els = selected();
  if (els.length < 3) return;
  change(() => {
    const items = els.map((el) => ({ el, b: aabb(el) }))
      .sort((a, b) => (axis === "h" ? a.b.x - b.b.x : a.b.y - b.b.y));
    const first = items[0].b;
    const last = items[items.length - 1].b;
    const total = items.reduce((s, it) => s + (axis === "h" ? it.b.w : it.b.h), 0);
    const span = axis === "h" ? last.x + last.w - first.x : last.y + last.h - first.y;
    const gap = (span - total) / (items.length - 1);
    let cursor = axis === "h" ? first.x : first.y;
    for (const it of items) {
      const pos = axis === "h" ? it.b.x : it.b.y;
      if (axis === "h") translate(it.el, Math.round(cursor - pos), 0);
      else translate(it.el, 0, Math.round(cursor - pos));
      cursor += (axis === "h" ? it.b.w : it.b.h) + gap;
    }
  });
}

export function nudge(dx, dy) {
  if (!store.selection.length) return;
  change(() => { for (const el of selected()) if (!el.locked) translate(el, dx, dy); }, { coalesce: "nudge" });
}

export function toggleFlag(flag) {
  const els = selected();
  if (!els.length) return;
  const value = !els[0][flag === "visible" ? "visible" : "locked"];
  change(() => {
    for (const el of els) {
      if (flag === "visible") el.visible = value;
      else el.locked = value;
    }
  });
}

export function selectAll() {
  const list = store.enteredGroup
    ? findElement(store.scene.elements, store.enteredGroup)?.el.children ?? store.scene.elements
    : store.scene.elements;
  select(list.filter((e) => !e.locked && e.visible !== false).map((e) => e.id));
}

/** シーンにある要素の名前（ルールの宛先選び用） */
export function elementOptions(filter = () => true) {
  return flatten(store.scene?.elements || [])
    .filter(filter)
    .map((el) => [el.id, el.name || el.type]);
}
