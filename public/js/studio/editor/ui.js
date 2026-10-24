// public/js/studio/editor/ui.js
// エディタの小さな部品（入力欄・色・塗り・セクション）。
// どの欄も { el, sync() } を返す。値はシーンから毎回読み直すので（sync）、
// 元に戻す・別の要素を選ぶ・ルールが動かした、のどれでも表示がずれない。
import { safeColor, linear, solid } from "../shared/model.js";
import { TEMPLATE_VARS } from "../shared/template.js";

/** 要素を作る。attrs の on* はイベント、class / style / dataset はそれぞれの形で */
export function h(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (k === "text") n.textContent = v;
    else if (v === true) n.setAttribute(k, "");
    else n.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}

const focused = (n) => document.activeElement === n;

/**
 * この端末だけの覚え書き（開いていたタブ・コピーした要素など）。
 * 使えない環境（プライベートモード・保存の拒否・容量切れ）では覚えないだけで、画面は止めない。
 */
export const prefs = {
  get(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 覚えられない */ }
  },
  getJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
  },
  setJson(key, value) {
    prefs.set(key, JSON.stringify(value));
  },
};

/** 文字を打っている最中か（キーボードの近道を止める） */
export function isTyping() {
  const a = document.activeElement;
  return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable);
}

/** 欄の見出しと中身 */
function field(label, control, { wide = false, hint } = {}) {
  return h("label", { class: `fld${wide ? " wide" : ""}`, title: hint || null },
    label ? h("span", { class: "fld-label" }, label) : null, control);
}

/**
 * 数値。見出しを左右にドラッグすると値を増減できる（Photoshop のスクラブ）。
 * @param {{label: string, get: () => number, set: (v: number, opts?: object) => void, min?: number, max?: number, step?: number, unit?: string, wide?: boolean, hint?: string}} o
 */
export function numberField(o) {
  const step = o.step ?? 1;
  const input = h("input", { type: "number", step, min: o.min, max: o.max, class: "num" });
  const clamp = (v) => Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, v));
  const round = (v) => Math.round(v / step) * step;
  const commit = () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) o.set(clamp(v));
  };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { commit(); input.blur(); } });

  const wrap = h("span", { class: "num-wrap" }, input, o.unit ? h("span", { class: "unit" }, o.unit) : null);
  const f = field(o.label, wrap, o);
  const label = f.querySelector(".fld-label");
  if (label) {
    label.classList.add("scrub");
    label.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const start = Number(o.get()) || 0;
      const x0 = e.clientX;
      label.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
        const v = clamp(round(start + ((ev.clientX - x0) / 2) * step * mult));
        input.value = String(+v.toFixed(4));
        o.set(v, { live: true });
      };
      const up = () => {
        label.removeEventListener("pointermove", move);
        label.removeEventListener("pointerup", up);
        o.set(clamp(Number(input.value) || start));
      };
      label.addEventListener("pointermove", move);
      label.addEventListener("pointerup", up);
    });
  }
  return {
    el: f,
    sync() {
      if (focused(input)) return;
      const v = o.get();
      input.value = v === undefined || v === null || Number.isNaN(v) ? "" : String(+Number(v).toFixed(2));
    },
  };
}

/** スライダー＋数値 */
export function sliderField(o) {
  const range = h("input", { type: "range", min: o.min, max: o.max, step: o.step ?? 1 });
  const out = h("span", { class: "range-val" });
  range.addEventListener("input", () => { out.textContent = fmt(range.value); o.set(Number(range.value), { live: true }); });
  range.addEventListener("change", () => o.set(Number(range.value)));
  const fmt = (v) => `${+Number(v).toFixed(2)}${o.unit || ""}`;
  return {
    el: field(o.label, h("span", { class: "range-wrap" }, range, out), o),
    sync() {
      if (focused(range)) return;
      const v = o.get();
      range.value = String(v);
      out.textContent = fmt(v);
    },
  };
}

export function selectField(o) {
  const sel = h("select", {});
  const fill = () => {
    const opts = typeof o.options === "function" ? o.options() : o.options;
    sel.textContent = "";
    for (const opt of opts) {
      const [value, label] = Array.isArray(opt) ? opt : [opt, opt];
      sel.appendChild(h("option", { value }, label));
    }
  };
  fill();
  sel.addEventListener("change", () => o.set(sel.value));
  return {
    el: field(o.label, sel, o),
    sync() {
      if (typeof o.options === "function") fill();
      const v = o.get();
      sel.value = v ?? "";
      if (sel.value !== String(v ?? "") && sel.options.length && v !== undefined) {
        // 一覧に無い値（消した要素を指しているなど）も見えるようにする
        sel.appendChild(h("option", { value: v }, `${v}（不明）`));
        sel.value = v;
      }
    },
  };
}

export function toggleField(o) {
  const input = h("input", { type: "checkbox" });
  input.addEventListener("change", () => o.set(input.checked));
  const el = h("label", { class: `fld toggle${o.wide ? " wide" : ""}`, title: o.hint || null }, input, h("span", {}, o.label));
  return { el, sync() { input.checked = !!o.get(); } };
}

/** 文字。テンプレートを使う欄は「{ } 変数」ボタンで差し込み値を選べる */
export function textField(o) {
  const input = o.multiline
    ? h("textarea", { rows: o.rows || 3, placeholder: o.placeholder || "" })
    : h("input", { type: "text", placeholder: o.placeholder || "" });
  if (o.list) input.setAttribute("list", o.list);
  const commit = () => o.set(input.value);
  input.addEventListener("change", commit);
  if (o.live) input.addEventListener("input", () => o.set(input.value, { live: true }));
  let control = input;
  if (o.vars) {
    const btn = h("button", { type: "button", class: "var-btn", title: "差し込み値を入れる" }, "{ }");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      openVarMenu(btn, o.vars === "event", (key) => {
        const s = input.selectionStart ?? input.value.length;
        const t = input.selectionEnd ?? s;
        input.value = `${input.value.slice(0, s)}{${key}}${input.value.slice(t)}`;
        commit();
        input.focus();
      });
    });
    control = h("span", { class: "text-wrap" }, input, btn);
  }
  return {
    el: field(o.label, control, { ...o, wide: o.wide ?? true }),
    sync() { if (!focused(input)) input.value = o.get() ?? ""; },
  };
}

/** 自分で作った差し込み値（カウンター・タイマー）の名前。エディタが起動時に渡す */
let customVarNames = () => [];
export function setCustomVarNames(fn) {
  customVarNames = fn;
}

let openMenu = null;
export function closeMenus() {
  if (openMenu) openMenu.remove();
  openMenu = null;
}
document.addEventListener("pointerdown", (e) => {
  if (openMenu && !openMenu.contains(e.target)) closeMenus();
});

/** 差し込み値の一覧（イベント用の値も出すかどうか） */
function openVarMenu(anchor, withEvent, pick) {
  closeMenus();
  const extra = customVarNames();
  const items = [
    ...TEMPLATE_VARS.filter((v) => withEvent || v.scope === "global"),
    ...extra.map((key) => ({ key, label: "カウンター／タイマー", scope: "global" })),
  ];
  const menu = h("div", { class: "menu var-menu" },
    items.map((v) => h("button", {
      type: "button",
      onclick: () => { closeMenus(); pick(v.key); },
    }, h("code", {}, `{${v.key}}`), h("span", {}, v.label))));
  positionMenu(menu, anchor);
}

/** 浮かせるメニューを anchor の下（はみ出すなら上）に置く */
export function positionMenu(menu, anchor, at) {
  document.body.appendChild(menu);
  openMenu = menu;
  const r = at ? { left: at.x, bottom: at.y, top: at.y } : anchor.getBoundingClientRect();
  const mh = menu.offsetHeight;
  const mw = menu.offsetWidth;
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, (r.top ?? r.bottom) - mh - 4);
  menu.style.top = `${top}px`;
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - mw - 8, r.left))}px`;
}

/** メニューを開く（右クリック・追加ボタン） */
export function openContextMenu(items, at) {
  closeMenus();
  const menu = h("div", { class: "menu" },
    items.filter(Boolean).map((it) => it === "-" ? h("hr") : h("button", {
      type: "button",
      disabled: it.disabled || null,
      onclick: () => { closeMenus(); it.run(); },
    }, h("span", {}, it.label), it.key ? h("kbd", {}, it.key) : null)));
  positionMenu(menu, null, at);
}

// ===============================
// 色
// ===============================
/** "#rgb" "#rrggbb" "#rrggbbaa" → { hex: "#rrggbb", alpha: 0..1 } */
function splitColor(c) {
  const s = safeColor(c, "#000000");
  let m = /^#([0-9a-f]{3,4})$/i.exec(s);
  if (m) {
    const d = m[1].split("").map((x) => x + x);
    return { hex: `#${d.slice(0, 3).join("")}`, alpha: d[3] ? parseInt(d[3], 16) / 255 : 1 };
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) return { hex: `#${m[1]}`, alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  if (s === "transparent") return { hex: "#000000", alpha: 0 };
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    const hx = (v) => Math.round(Math.min(255, Math.max(0, v || 0))).toString(16).padStart(2, "0");
    return { hex: `#${hx(r)}${hx(g)}${hx(b)}`, alpha: Math.min(1, Math.max(0, a)) };
  }
  return { hex: "#000000", alpha: 1 };
}

function joinColor(hex, alpha) {
  if (alpha >= 1) return hex.toLowerCase();
  return `${hex}${Math.round(Math.max(0, alpha) * 255).toString(16).padStart(2, "0")}`.toLowerCase();
}

/** 色（不透明度つき）。スポイトがあるブラウザではスポイトのボタンも出す */
function colorControl(get, set) {
  const picker = h("input", { type: "color" });
  const alpha = h("input", { type: "range", min: 0, max: 100, class: "alpha" });
  const text = h("input", { type: "text", class: "hex", maxlength: 9 });
  const emit = (live) => set(joinColor(picker.value, Number(alpha.value) / 100), { live });
  picker.addEventListener("input", () => emit(true));
  picker.addEventListener("change", () => emit(false));
  alpha.addEventListener("input", () => emit(true));
  alpha.addEventListener("change", () => emit(false));
  text.addEventListener("change", () => {
    const v = text.value.trim();
    if (safeColor(v, "") !== "") set(v);
  });
  const parts = [picker, text, alpha];
  if ("EyeDropper" in window) {
    parts.push(h("button", {
      type: "button", class: "icon-btn", title: "スポイト",
      onclick: async () => {
        try {
          const r = await new window.EyeDropper().open();
          set(joinColor(r.sRGBHex, Number(alpha.value) / 100 || 1));
        } catch (e) { /* キャンセル */ }
      },
    }, "💧"));
  }
  const el = h("span", { class: "color-ctl" }, ...parts);
  return {
    el,
    sync() {
      const v = get();
      const { hex, alpha: a } = splitColor(v);
      if (!focused(picker)) picker.value = hex;
      if (!focused(alpha)) alpha.value = String(Math.round(a * 100));
      if (!focused(text)) text.value = safeColor(v, "#000000");
    },
  };
}

export function colorField(o) {
  const c = colorControl(o.get, o.set);
  return { el: field(o.label, c.el, { ...o, wide: o.wide ?? true }), sync: c.sync };
}

/**
 * 塗り（なし／単色／線形グラデーション／円形グラデーション）
 * @param {{label: string, get: () => object, set: (paint: object, opts?: object) => void, allowNone?: boolean}} o
 */
export function paintField(o) {
  const type = h("select", {},
    o.allowNone !== false ? h("option", { value: "none" }, "なし") : null,
    h("option", { value: "solid" }, "単色"),
    h("option", { value: "linear" }, "グラデーション（線形）"),
    h("option", { value: "radial" }, "グラデーション（円形）"));
  const body = h("div", { class: "paint-body" });
  const preview = h("span", { class: "paint-preview" });
  let controls = [];
  let builtFor = null;

  const current = () => o.get() || { type: "none" };

  type.addEventListener("change", () => {
    const p = current();
    const first = p.type === "solid" ? p.color : p.stops?.[0]?.color || "#7c5cff";
    const last = p.stops?.[p.stops.length - 1]?.color || "#ff5c8a";
    if (type.value === "none") o.set({ type: "none" });
    else if (type.value === "solid") o.set(solid(first));
    else {
      const g = p.stops ? { ...p, type: type.value } : { ...linear(90, first, last), type: type.value };
      o.set(g);
    }
  });

  function build(p) {
    body.textContent = "";
    controls = [];
    builtFor = `${p.type}:${p.stops?.length ?? 0}`;
    if (p.type === "solid") {
      const c = colorControl(() => current().color, (v, opts) => o.set({ ...current(), color: v }, opts));
      controls.push(c);
      body.appendChild(c.el);
    } else if (p.type === "linear" || p.type === "radial") {
      (p.stops || []).forEach((s, i) => {
        const c = colorControl(
          () => current().stops?.[i]?.color,
          (v, opts) => {
            const g = current();
            const stops = g.stops.map((st, j) => (j === i ? { ...st, color: v } : st));
            o.set({ ...g, stops }, opts);
          }
        );
        const pos = h("input", { type: "range", min: 0, max: 100, class: "stop-pos", title: "位置" });
        const setPos = (live) => {
          const g = current();
          const stops = g.stops.map((st, j) => (j === i ? { ...st, offset: Number(pos.value) / 100 } : st));
          o.set({ ...g, stops }, { live });
        };
        pos.addEventListener("input", () => setPos(true));
        pos.addEventListener("change", () => setPos(false));
        const del = h("button", {
          type: "button", class: "icon-btn", title: "この色を消す",
          disabled: p.stops.length <= 2 || null,
          onclick: () => {
            const g = current();
            o.set({ ...g, stops: g.stops.filter((_, j) => j !== i) });
          },
        }, "×");
        controls.push(c, { sync: () => { if (!focused(pos)) pos.value = String(Math.round((current().stops?.[i]?.offset ?? 0) * 100)); } });
        body.appendChild(h("div", { class: "stop-row" }, c.el, pos, del));
      });
      const add = h("button", {
        type: "button", class: "small-btn",
        onclick: () => {
          const g = current();
          if (g.stops.length >= 6) return;
          o.set({ ...g, stops: [...g.stops, { offset: 1, color: "#ffffff" }].sort((a, b) => a.offset - b.offset) });
        },
      }, "+ 色を追加");
      body.appendChild(add);
      if (p.type === "linear") {
        const ang = numberField({
          label: "角度", unit: "°", min: -360, max: 360,
          get: () => current().angle ?? 0,
          set: (v, opts) => o.set({ ...current(), angle: v }, opts),
        });
        controls.push(ang);
        body.appendChild(ang.el);
      }
    }
  }

  const head = h("div", { class: "paint-head" }, preview, type);
  const el = h("div", { class: "fld wide paint" }, h("span", { class: "fld-label" }, o.label), head, body);
  return {
    el,
    sync() {
      const p = current();
      type.value = p.type || "none";
      if (builtFor !== `${p.type}:${p.stops?.length ?? 0}`) build(p);
      controls.forEach((c) => c.sync());
      preview.style.background = p.type === "none" ? "" : p.type === "solid" ? safeColor(p.color) : (
        `linear-gradient(90deg, ${(p.stops || []).map((s) => `${safeColor(s.color)} ${Math.round(s.offset * 100)}%`).join(",")})`);
      preview.classList.toggle("none", p.type === "none");
    },
  };
}

/** 折りたたみ見出し付きのまとまり */
export function section(title, items, { open = true, id } = {}) {
  const key = id ? `ld-sec-${id}` : null;
  const saved = key ? prefs.get(key) : null;
  const isOpen = saved === null ? open : saved === "1";
  const body = h("div", { class: "sec-body" }, items.map((i) => i.el ?? i));
  const head = h("button", { type: "button", class: "sec-head" }, title);
  const el = h("section", { class: `sec${isOpen ? " open" : ""}` }, head, body);
  head.addEventListener("click", () => {
    el.classList.toggle("open");
    if (key) prefs.set(key, el.classList.contains("open") ? "1" : "0");
  });
  return { el, sync() { items.forEach((i) => i.sync?.()); } };
}

/**
 * タブ。押したタブの中身だけを出し、どれを開いていたかを覚えておく（次に開いたときも同じタブ）。
 * @param {HTMLElement} bar data-tab を持つボタンの並び
 * @param {Record<string, HTMLElement|null>} bodies タブの名前 → 中身（null なら出し分けは onShow に任せる）
 * @param {string} key 覚えておく名前
 * @param {(name: string) => void} [onShow]
 * @returns {(name: string) => void} タブを切り替える
 */
export function bindTabs(bar, bodies, key, onShow) {
  const show = (name) => {
    for (const b of bar.querySelectorAll("button[data-tab]")) b.classList.toggle("active", b.dataset.tab === name);
    for (const [n, body] of Object.entries(bodies)) if (body) body.hidden = n !== name;
    prefs.set(key, name);
    onShow?.(name);
  };
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) show(b.dataset.tab);
  });
  const saved = prefs.get(key);
  show(saved && Object.hasOwn(bodies, saved) ? saved : Object.keys(bodies)[0]);
  return show;
}

/** 横並び */
export function row(...items) {
  return { el: h("div", { class: "fld-row" }, items.map((i) => i.el ?? i)), sync() { items.forEach((i) => i.sync?.()); } };
}

/** クリップボードに写す。使えない環境（http・権限なし）では、選んでコピーできる欄を出す */
export async function copyText(text, doneMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast(doneMessage);
  } catch (e) {
    prompt("コピーしてください", text);
  }
}

/** JSON をファイルとして保存させる（書き出し） */
export function downloadJson(fileName, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: fileName });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** 画面下に一瞬出す知らせ */
export function toast(text, kind = "info") {
  const t = h("div", { class: `toast ${kind}` }, text);
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2600);
}

/** ダイアログ（OK/キャンセル） */
export function modal(title, content, { okText = "OK", cancelText = "キャンセル", wide = false } = {}) {
  return new Promise((resolve) => {
    const close = (v) => { back.remove(); resolve(v); };
    const box = h("div", { class: `modal${wide ? " wide" : ""}` },
      h("h2", {}, title),
      h("div", { class: "modal-body" }, content),
      h("div", { class: "modal-actions" },
        cancelText ? h("button", { type: "button", class: "btn", onclick: () => close(false) }, cancelText) : null,
        okText ? h("button", { type: "button", class: "btn primary", onclick: () => close(true) }, okText) : null));
    const back = h("div", { class: "modal-back", onpointerdown: (e) => { if (e.target === back) close(false); } }, box);
    document.body.appendChild(back);
    back.addEventListener("keydown", (e) => { if (e.key === "Escape") close(false); });
    box.querySelector("input,select,textarea,button.primary")?.focus();
  });
}

const icons = {
  select: '<path d="M5 3l14 8-6 2-3 6z"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 013 0V12m0-1V4.5a1.5 1.5 0 013 0V12m0-.5v-5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1a6 6 0 01-5-2.7L3.3 15a1.5 1.5 0 012.4-1.8L8 15"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="1.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="7.5"/>',
  polygon: '<path d="M12 3l9 16H3z"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  line: '<path d="M5 19L19 5"/>',
  pen: '<path d="M12 19l7-7 3 3-7 7zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18zM2 2l7.6 7.6"/><circle cx="11" cy="11" r="2"/>',
  pencil: '<path d="M17 3l4 4L8 20H4v-4z"/>',
  undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M9.9 5.1A10 10 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6A17 17 0 002 12s3.6 7 10 7a10 10 0 005.4-1.6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.7-1.5"/>',
};

export function icon(name, size = 18) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", size);
  s.setAttribute("height", size);
  s.setAttribute("class", "ico");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.8");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  // アイコンは上の固定の文字列だけ（外から来た文字は入らない）
  s.innerHTML = icons[name] || "";
  return s;
}
