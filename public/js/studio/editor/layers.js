// public/js/studio/editor/layers.js
// レイヤーパネル（Photoshop 風）。上にあるものほど手前。
// クリックで選択、Shift/Ctrl で追加、ドラッグで並べ替え（グループの上に落とすと中へ）、
// ダブルクリックで名前の変更、目と鍵で表示・ロック。
import { store, on, change, select } from "./state.js";
import { moveElement } from "./ops.js";
import { h, icon } from "./ui.js";
import { TYPE_META, findElement } from "../shared/model.js";

const TYPE_ICONS = {
  rect: "▭", ellipse: "◯", polygon: "△", path: "✎", text: "T", image: "🖼", group: "▤",
  chat: "💬", danmaku: "≋", alert: "🔔", goal: "▰", leaderboard: "🏆", events: "☰", timer: "⏱",
};

export function initLayers(panel) {
  const collapsed = new Set();
  let dragId = null;

  function rowFor(el, depth) {
    const isSel = store.selection.includes(el.id);
    const nameSpan = h("span", { class: "layer-name" }, el.name || TYPE_META[el.type]?.label || el.type);
    const row = h("div", {
      class: `layer-row${isSel ? " selected" : ""}${el.visible === false ? " hidden-el" : ""}${el.locked ? " locked" : ""}${store.enteredGroup === el.id ? " entered" : ""}`,
      draggable: "true",
      dataset: { id: el.id },
      style: { paddingLeft: `${8 + depth * 16}px` },
    },
    el.type === "group"
      ? h("button", {
        type: "button", class: "layer-caret",
        onclick: (e) => {
          e.stopPropagation();
          collapsed.has(el.id) ? collapsed.delete(el.id) : collapsed.add(el.id);
          render();
        },
      }, collapsed.has(el.id) ? "▸" : "▾")
      : h("span", { class: "layer-caret" }),
    h("span", { class: "layer-icon" }, TYPE_ICONS[el.type] || "•"),
    nameSpan,
    el.startHidden ? h("span", { class: "layer-badge", title: "配信画面では最初は隠れています" }, "隠") : null,
    h("button", {
      type: "button", class: "layer-btn", title: el.locked ? "ロック解除" : "ロック",
      onclick: (e) => { e.stopPropagation(); change((s) => { const t = findElement(s.elements, el.id)?.el; if (t) t.locked = !t.locked; }); },
    }, icon(el.locked ? "lock" : "unlock", 14)),
    h("button", {
      type: "button", class: "layer-btn", title: el.visible === false ? "表示" : "非表示",
      onclick: (e) => { e.stopPropagation(); change((s) => { const t = findElement(s.elements, el.id)?.el; if (t) t.visible = t.visible === false; }); },
    }, icon(el.visible === false ? "eyeOff" : "eye", 14)));

    row.addEventListener("click", (e) => {
      if (e.shiftKey || e.ctrlKey || e.metaKey) select(el.id, { toggle: true });
      else select(el.id);
    });
    nameSpan.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const input = h("input", { type: "text", value: el.name || "", class: "layer-rename" });
      nameSpan.replaceWith(input);
      input.focus();
      input.select();
      const done = () => change((s) => { const t = findElement(s.elements, el.id)?.el; if (t) t.name = input.value.trim() || t.name; });
      input.addEventListener("blur", done);
      input.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") input.blur();
        if (ev.key === "Escape") { input.value = el.name; input.blur(); }
      });
    });

    row.addEventListener("dragstart", (e) => {
      dragId = el.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", el.id);
    });
    row.addEventListener("dragover", (e) => {
      if (!dragId || dragId === el.id) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      row.classList.remove("drop-above", "drop-below", "drop-inside");
      if (el.type === "group" && y > 0.3 && y < 0.7) row.classList.add("drop-inside");
      else row.classList.add(y < 0.5 ? "drop-above" : "drop-below");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop-above", "drop-below", "drop-inside"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const pos = row.classList.contains("drop-inside") ? "inside" : row.classList.contains("drop-above") ? "above" : "below";
      row.classList.remove("drop-above", "drop-below", "drop-inside");
      if (dragId) moveElement(dragId, el.id, pos);
      dragId = null;
    });
    row.addEventListener("dragend", () => { dragId = null; });
    return row;
  }

  function walk(list, depth, out) {
    // 配列の後ろ（手前）を上に出す
    for (let i = list.length - 1; i >= 0; i--) {
      const el = list[i];
      out.push(rowFor(el, depth));
      if (el.type === "group" && !collapsed.has(el.id)) walk(el.children, depth + 1, out);
    }
  }

  function render() {
    panel.textContent = "";
    if (!store.scene) return;
    const rows = [];
    walk(store.scene.elements, 0, rows);
    if (rows.length === 0) {
      panel.appendChild(h("p", { class: "hint pad" }, "まだ何もありません。左の「素材」や上の道具から追加してください。"));
      return;
    }
    panel.append(...rows);
    panel.querySelector(".layer-row.selected")?.scrollIntoView({ block: "nearest" });
  }

  let frame = 0;
  on((kind, detail) => {
    if (kind !== "scene" && kind !== "selection") return;
    if (kind === "scene" && detail?.live) return; // ドラッグ中は描き直さない
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; render(); });
  });
  return { render };
}
