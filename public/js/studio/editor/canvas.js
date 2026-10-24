// public/js/studio/editor/canvas.js
// キャンバス：表示（拡大・スクロール）、道具（選択・図形・テキスト・直線・ペン・鉛筆・手のひら）、
// 選択枠と変形ハンドル（移動・拡大縮小・回転）、スマートガイド、パスの点の編集、文字の直接編集。
//
// 座標は2種類ある。
//   画面座標  … ビューポートの左上からのピクセル（ハンドルの大きさはこちらで一定にする）
//   シーン座標 … デザインの中の座標（保存されるのはこちら）
// screen = scene * zoom + pan
import { store, on, emit, change, live, endLive, select, selected, setTool } from "./state.js";
import { addElement, duplicateSelection } from "./ops.js";
import { isTyping } from "./ui.js";
import { createRenderer } from "../shared/render.js";
import {
  clone, createElement, findElement, aabb, unionBox, corners, rotatePoint, translate, scaleAbout,
  rotateAbout, normalizeAngle, pathElementFromNodes, nodesBounds, pathData, solid, NONE, flatten,
} from "../shared/model.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const HANDLE = 9;          // ハンドルの大きさ（画面px）
const SNAP_PX = 6;         // 吸着する距離（画面px）
const DRAG_THRESHOLD = 3;  // これ未満はクリック扱い（画面px）

const HANDLES = [
  [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
];
const RESIZE_CURSORS = ["nwse-resize", "ns-resize", "nesw-resize", "ew-resize"];

function svg(tag, attrs = {}) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  return n;
}

/** ハンドルの向き（と要素の回転）から、出すカーソルを決める */
function cursorFor(hx, hy, rotation) {
  const base = Math.atan2(hy, hx) * 180 / Math.PI + rotation;
  const idx = Math.round((((base % 180) + 180) % 180) / 45) % 4;
  return [RESIZE_CURSORS[3], RESIZE_CURSORS[0], RESIZE_CURSORS[1], RESIZE_CURSORS[2]][idx];
}

/** ラマー・ダグラス・ポーカーで点を間引く（鉛筆の手ぶれを減らす） */
function simplify(points, eps) {
  if (points.length < 3) return points;
  const dist = (p, a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
  };
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = dist(points[i], points[0], points[points.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [points[0], points[points.length - 1]];
  return [...simplify(points.slice(0, idx + 1), eps).slice(0, -1), ...simplify(points.slice(idx), eps)];
}

/** 点列をなめらかなベジェのノードにする（Catmull-Rom） */
function smoothNodes(points, closed = false) {
  const n = points.length;
  const at = (i) => (closed ? points[(i + n) % n] : points[Math.max(0, Math.min(n - 1, i))]);
  return points.map((p, i) => {
    const prev = at(i - 1);
    const next = at(i + 1);
    const t = 1 / 6;
    return {
      x: p.x, y: p.y,
      ix: p.x - (next.x - prev.x) * t, iy: p.y - (next.y - prev.y) * t,
      ox: p.x + (next.x - prev.x) * t, oy: p.y + (next.y - prev.y) * t,
      s: true,
    };
  });
}

/** path 要素の座標を、シーン座標のノードから作り直す（直線ツールのドラッグ中） */
function setPathNodes(el, nodes, closed) {
  const tmp = pathElementFromNodes(nodes, closed);
  el.x = tmp.x; el.y = tmp.y; el.w = tmp.w; el.h = tmp.h;
  el.path = tmp.path;
}

// path 要素のノード座標（viewBox 内）⇔ シーン座標
function pathToScene(el, nx, ny) {
  const sx = el.w / (el.path.w || 1);
  const sy = el.h / (el.path.h || 1);
  return rotatePoint(el.x + nx * sx, el.y + ny * sy, el.x + el.w / 2, el.y + el.h / 2, el.rotation || 0);
}
function sceneToPath(el, px, py) {
  const p = rotatePoint(px, py, el.x + el.w / 2, el.y + el.h / 2, -(el.rotation || 0));
  return { x: (p.x - el.x) / (el.w / (el.path.w || 1)), y: (p.y - el.y) / (el.h / (el.path.h || 1)) };
}

/** ノード編集のあと、枠をノードにぴったり合わせ直す（見た目は動かさない） */
function rebasePath(el) {
  const nodes = el.path.nodes;
  if (!nodes.length) return;
  const b = nodesBounds(nodes);
  const sx = el.w / (el.path.w || 1);
  const sy = el.h / (el.path.h || 1);
  for (const p of nodes) {
    p.x -= b.x; p.y -= b.y;
    p.ix = (p.ix ?? p.x + b.x) - b.x; p.iy = (p.iy ?? p.y + b.y) - b.y;
    p.ox = (p.ox ?? p.x + b.x) - b.x; p.oy = (p.oy ?? p.y + b.y) - b.y;
  }
  const w = Math.max(1, b.w * sx);
  const h = Math.max(1, b.h * sy);
  const oldC = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  const unrot = { x: el.x + b.x * sx + w / 2, y: el.y + b.y * sy + h / 2 };
  const c = rotatePoint(unrot.x, unrot.y, oldC.x, oldC.y, el.rotation || 0);
  el.path.w = b.w;
  el.path.h = b.h;
  el.w = w;
  el.h = h;
  el.x = c.x - w / 2;
  el.y = c.y - h / 2;
}

/**
 * @param {object} o
 * @param {HTMLElement} o.viewport
 * @param {HTMLElement} o.world
 * @param {HTMLElement} o.artboard
 * @param {SVGSVGElement} o.ui
 * @param {() => object} o.getLive
 * @param {() => object} o.getCtx
 * @param {(url: string, v?: number) => void} o.playSound
 * @param {(e: MouseEvent, hitId: string|null) => void} o.onContextMenu
 * @param {(data: DataTransfer, at: {x: number, y: number}) => void} o.onDrop ファイル・素材・部品を落とした
 */
export function initCanvas(o) {
  const { viewport, world, artboard, ui } = o;
  const renderer = createRenderer(artboard, {
    mode: "editor", getLive: o.getLive, getCtx: o.getCtx, playSound: o.playSound, getAudio: o.getAudio,
  });

  let session = null;     // ドラッグ中の操作
  let hoverId = null;
  let guides = [];        // スマートガイド（シーン座標の線）
  let marquee = null;     // 範囲選択の矩形（シーン座標）
  let pen = null;         // ペンで描いている途中 { nodes, dragging, cursor }
  let pencil = null;      // 鉛筆で描いている途中の点列
  let nodeSel = -1;       // ノード編集で選んでいる点
  let spaceDown = false;

  // ===============================
  // 座標
  // ===============================
  const vpRect = () => viewport.getBoundingClientRect();
  function toScene(clientX, clientY) {
    const r = vpRect();
    return { x: (clientX - r.left - store.panX) / store.zoom, y: (clientY - r.top - store.panY) / store.zoom };
  }
  const sx = (x) => x * store.zoom + store.panX;
  const sy = (y) => y * store.zoom + store.panY;

  // ===============================
  // 表示
  // ===============================
  function applyView() {
    world.style.transform = `translate(${store.panX}px, ${store.panY}px) scale(${store.zoom})`;
  }

  function fit() {
    if (!store.scene) return;
    const r = vpRect();
    const pad = 64;
    const z = Math.min((r.width - pad * 2) / store.scene.width, (r.height - pad * 2) / store.scene.height);
    store.zoom = Math.max(0.05, Math.min(4, z));
    store.panX = (r.width - store.scene.width * store.zoom) / 2;
    store.panY = (r.height - store.scene.height * store.zoom) / 2;
    emit("view");
  }

  function zoomAt(z, clientX, clientY) {
    const r = vpRect();
    const cx = clientX ?? r.left + r.width / 2;
    const cy = clientY ?? r.top + r.height / 2;
    const before = toScene(cx, cy);
    store.zoom = Math.max(0.05, Math.min(8, z));
    store.panX = cx - r.left - before.x * store.zoom;
    store.panY = cy - r.top - before.y * store.zoom;
    emit("view");
  }

  let frame = 0;
  let needRender = false;
  function schedule(renderScene) {
    needRender = needRender || renderScene;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (needRender && store.scene) {
        // 文字を直接編集している間は、その要素を描き直さない（カーソルが飛ぶ）
        renderer.render(store.scene);
      }
      needRender = false;
      applyView();
      drawUi();
    });
  }

  on((kind) => {
    if (kind === "scene") schedule(true);
    else if (kind === "selection" || kind === "view" || kind === "tool") schedule(false);
    if (kind === "tool") {
      if (store.tool !== "pen" && pen) finishPen(false);
      viewport.dataset.tool = store.tool;
    }
  });

  // ===============================
  // 当たり判定
  // ===============================
  /** その点にある、選べる要素の id（グループの中に入っていなければ一番外側） */
  function hitTest(clientX, clientY, { deep = false, skip = 0 } = {}) {
    const hits = document.elementsFromPoint(clientX, clientY)
      .filter((n) => n.closest && artboard.contains(n))
      .map((n) => n.closest(".sd-el"))
      .filter(Boolean);
    const seen = new Set();
    const candidates = [];
    for (const node of hits) {
      if (seen.has(node)) continue;
      seen.add(node);
      // 外側へたどって、選ぶ単位を決める
      const chain = [];
      for (let n = node; n && n !== artboard; n = n.parentElement) {
        if (n.classList?.contains("sd-el")) chain.push(n.dataset.id);
      }
      let id;
      if (deep) id = chain[0];
      else if (store.enteredGroup && chain.includes(store.enteredGroup)) {
        id = chain[chain.indexOf(store.enteredGroup) - 1] ?? store.enteredGroup;
      } else id = chain[chain.length - 1];
      const el = id && findElement(store.scene.elements, id)?.el;
      if (!el || el.locked || candidates.includes(id)) continue;
      candidates.push(id);
    }
    return candidates[skip % Math.max(1, candidates.length)] ?? null;
  }

  // ===============================
  // 選択枠とハンドル
  // ===============================
  /** 選択範囲の枠。1つなら回転した枠、複数なら外接矩形 */
  function selectionFrame() {
    const els = selected();
    if (els.length === 0) return null;
    if (els.length === 1 && els[0].type !== "group") {
      const el = els[0];
      return { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation || 0, single: el };
    }
    const b = unionBox(els.map(aabb));
    return { ...b, rotation: 0, single: els.length === 1 ? els[0] : null };
  }

  function framePoint(f, fx, fy) {
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    return rotatePoint(cx + (fx * f.w) / 2, cy + (fy * f.h) / 2, cx, cy, f.rotation);
  }

  function polygonOf(points) {
    return points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  }

  function drawUi() {
    ui.textContent = "";
    if (!store.scene) return;

    // アートボードの外は配信に映らないので暗くする（はみ出した部分は見えるが、切れることが分かる）
    const W = viewport.clientWidth;
    const H = viewport.clientHeight;
    const ax = sx(0);
    const ay = sy(0);
    const aw = store.scene.width * store.zoom;
    const ah = store.scene.height * store.zoom;
    ui.appendChild(svg("path", {
      d: `M0 0H${W}V${H}H0Z M${ax} ${ay}V${ay + ah}H${ax + aw}V${ay}Z`, "fill-rule": "evenodd", class: "ui-outside",
    }));

    // アートボードの外枠
    ui.appendChild(svg("rect", {
      x: sx(0), y: sy(0), width: store.scene.width * store.zoom, height: store.scene.height * store.zoom,
      class: "ui-artboard",
    }));

    // 入っているグループ
    if (store.enteredGroup) {
      const g = findElement(store.scene.elements, store.enteredGroup)?.el;
      if (g) ui.appendChild(svg("polygon", { points: polygonOf(corners(g)), class: "ui-group" }));
    }

    // ホバー
    if (hoverId && !store.selection.includes(hoverId) && !session) {
      const el = findElement(store.scene.elements, hoverId)?.el;
      if (el) ui.appendChild(svg("polygon", { points: polygonOf(corners(el)), class: "ui-hover" }));
    }

    // 選択中の要素それぞれの枠（複数選択のとき）
    const els = selected();
    if (els.length > 1) {
      for (const el of els) ui.appendChild(svg("polygon", { points: polygonOf(corners(el)), class: "ui-sel-item" }));
    }

    const f = selectionFrame();
    if (f && !store.nodeEdit) {
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => framePoint(f, a, b));
      ui.appendChild(svg("polygon", { points: polygonOf(pts), class: "ui-sel" }));

      const locked = els.some((e) => e.locked);
      if (!locked && !store.editingText && !session?.noHandles) {
        // 回転ハンドル（上辺の少し上）
        const top = framePoint(f, 0, -1);
        const cx = f.x + f.w / 2;
        const cy = f.y + f.h / 2;
        const dir = rotatePoint(0, -1, 0, 0, f.rotation);
        const rp = { x: top.x + (dir.x * 28) / store.zoom, y: top.y + (dir.y * 28) / store.zoom };
        ui.appendChild(svg("line", { x1: sx(top.x), y1: sy(top.y), x2: sx(rp.x), y2: sy(rp.y), class: "ui-rot-line" }));
        ui.appendChild(svg("circle", {
          cx: sx(rp.x), cy: sy(rp.y), r: 6, class: "ui-handle ui-rot", "data-handle": "rotate",
        }));
        // 小さすぎるときは辺のハンドルを出さない（角だけで十分。重なって掴めない）
        const small = f.w * store.zoom < 30 || f.h * store.zoom < 30;
        HANDLES.forEach(([hx, hy]) => {
          if (small && (hx === 0 || hy === 0)) return;
          const p = framePoint(f, hx, hy);
          const r = svg("rect", {
            x: sx(p.x) - HANDLE / 2, y: sy(p.y) - HANDLE / 2, width: HANDLE, height: HANDLE,
            class: "ui-handle", "data-handle": `${hx},${hy}`,
            transform: f.rotation ? `rotate(${f.rotation} ${sx(p.x)} ${sy(p.y)})` : null,
          });
          r.style.cursor = cursorFor(hx, hy, f.rotation);
          ui.appendChild(r);
        });
        void cx; void cy;
      }

      // 大きさの表示
      if (session && ["resize", "move", "create"].includes(session.kind)) {
        const b = unionBox(els.map(aabb));
        const label = session.kind === "move"
          ? `X ${Math.round(b.x)}  Y ${Math.round(b.y)}`
          : `${Math.round(f.w)} × ${Math.round(f.h)}`;
        const ly = sy(b.y + b.h) + 18;
        const t = svg("text", { x: sx(b.x + b.w / 2), y: ly, class: "ui-size" });
        t.textContent = label;
        ui.appendChild(t);
      }
      if (session?.kind === "rotate" && f.single) {
        const t = svg("text", { x: sx(f.x + f.w / 2), y: sy(f.y + f.h / 2), class: "ui-size" });
        t.textContent = `${Math.round(f.single.rotation || 0)}°`;
        ui.appendChild(t);
      }
    }

    // スマートガイド
    for (const g of guides) {
      if (g.axis === "x") ui.appendChild(svg("line", { x1: sx(g.at), x2: sx(g.at), y1: sy(g.from), y2: sy(g.to), class: "ui-guide" }));
      else ui.appendChild(svg("line", { y1: sy(g.at), y2: sy(g.at), x1: sx(g.from), x2: sx(g.to), class: "ui-guide" }));
    }

    // 範囲選択
    if (marquee) {
      ui.appendChild(svg("rect", {
        x: sx(marquee.x), y: sy(marquee.y), width: marquee.w * store.zoom, height: marquee.h * store.zoom,
        class: "ui-marquee",
      }));
    }

    drawPen();
    drawPencil();
    drawNodeEdit();
  }

  function drawPen() {
    if (!pen || pen.nodes.length === 0) return;
    const screenNodes = pen.nodes.map((p) => ({
      x: sx(p.x), y: sy(p.y), ix: sx(p.ix), iy: sy(p.iy), ox: sx(p.ox), oy: sy(p.oy),
    }));
    ui.appendChild(svg("path", { d: pathData(screenNodes, false), class: "ui-pen-path" }));
    const last = screenNodes[screenNodes.length - 1];
    if (pen.cursor && !pen.dragging) {
      const c = { x: sx(pen.cursor.x), y: sy(pen.cursor.y) };
      ui.appendChild(svg("path", {
        d: `M${last.x} ${last.y} C${last.ox} ${last.oy} ${c.x} ${c.y} ${c.x} ${c.y}`, class: "ui-pen-rubber",
      }));
    }
    screenNodes.forEach((p, i) => {
      if (p.ox !== p.x || p.oy !== p.y) {
        ui.appendChild(svg("line", { x1: p.ix, y1: p.iy, x2: p.ox, y2: p.oy, class: "ui-node-arm" }));
        ui.appendChild(svg("circle", { cx: p.ox, cy: p.oy, r: 3.5, class: "ui-node-handle" }));
        ui.appendChild(svg("circle", { cx: p.ix, cy: p.iy, r: 3.5, class: "ui-node-handle" }));
      }
      ui.appendChild(svg("rect", {
        x: p.x - 4, y: p.y - 4, width: 8, height: 8,
        class: `ui-node${i === 0 && pen.nodes.length > 2 ? " close-target" : ""}`,
      }));
    });
  }

  function drawPencil() {
    if (!pencil || pencil.length < 2) return;
    ui.appendChild(svg("polyline", {
      points: pencil.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" "), class: "ui-pen-path",
    }));
  }

  function drawNodeEdit() {
    if (!store.nodeEdit) return;
    const el = findElement(store.scene.elements, store.nodeEdit)?.el;
    if (!el || el.type !== "path") return;
    const toS = (x, y) => { const p = pathToScene(el, x, y); return { x: sx(p.x), y: sy(p.y) }; };
    ui.appendChild(svg("polygon", { points: polygonOf(corners(el)), class: "ui-sel-item" }));
    el.path.nodes.forEach((n, i) => {
      const a = toS(n.x, n.y);
      const hi = toS(n.ix ?? n.x, n.iy ?? n.y);
      const ho = toS(n.ox ?? n.x, n.oy ?? n.y);
      for (const [hp, part] of [[hi, "i"], [ho, "o"]]) {
        if (Math.hypot(hp.x - a.x, hp.y - a.y) < 0.5) continue;
        ui.appendChild(svg("line", { x1: a.x, y1: a.y, x2: hp.x, y2: hp.y, class: "ui-node-arm" }));
        ui.appendChild(svg("circle", {
          cx: hp.x, cy: hp.y, r: 4.5, class: "ui-node-handle ui-handle", "data-node": i, "data-part": part,
        }));
      }
      ui.appendChild(svg("rect", {
        x: a.x - 5, y: a.y - 5, width: 10, height: 10,
        class: `ui-node ui-handle${i === nodeSel ? " selected" : ""}`, "data-node": i, "data-part": "a",
      }));
    });
  }

  // ===============================
  // スマートガイド
  // ===============================
  function snapTargets(excludeIds) {
    const xs = [0, store.scene.width / 2, store.scene.width];
    const ys = [0, store.scene.height / 2, store.scene.height];
    const container = store.enteredGroup
      ? findElement(store.scene.elements, store.enteredGroup)?.el.children ?? store.scene.elements
      : store.scene.elements;
    const exclude = new Set(excludeIds);
    for (const el of container) {
      if (exclude.has(el.id) || el.visible === false) continue;
      const b = aabb(el);
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
    return { xs, ys };
  }

  /** 動かした箱の辺・中心を、近くの線に吸い寄せる量 */
  function snapBox(box, targets, axes = { x: true, y: true }, edges = null) {
    guides = [];
    if (!store.snap) return { dx: 0, dy: 0 };
    const th = SNAP_PX / store.zoom;
    const result = { dx: 0, dy: 0 };
    const scan = (axis) => {
      const own = edges?.[axis] ?? (axis === "x"
        ? [box.x, box.x + box.w / 2, box.x + box.w]
        : [box.y, box.y + box.h / 2, box.y + box.h]);
      const lines = axis === "x" ? targets.xs : targets.ys;
      let best = null;
      for (const v of own) {
        for (const t of lines) {
          const d = t - v;
          if (Math.abs(d) <= th && (best === null || Math.abs(d) < Math.abs(best.d))) best = { d, t };
        }
      }
      if (!best) return;
      result[axis === "x" ? "dx" : "dy"] = best.d;
      guides.push(axis === "x"
        ? { axis: "x", at: best.t, from: Math.min(0, box.y), to: Math.max(store.scene.height, box.y + box.h) }
        : { axis: "y", at: best.t, from: Math.min(0, box.x), to: Math.max(store.scene.width, box.x + box.w) });
    };
    if (axes.x) scan("x");
    if (axes.y) scan("y");
    return result;
  }

  // ===============================
  // 操作の始まり
  // ===============================
  function startsOf(ids) {
    const m = new Map();
    for (const id of ids) {
      const el = findElement(store.scene.elements, id)?.el;
      if (el) m.set(id, clone(el));
    }
    return m;
  }

  /** ドラッグ開始時の形に戻す（拡大・回転は毎回ここから計算し直すので誤差がたまらない） */
  function resetTo(start) {
    const el = findElement(store.scene.elements, start.id)?.el;
    if (!el) return null;
    for (const k of Object.keys(el)) if (!(k in start)) delete el[k];
    Object.assign(el, clone(start));
    return el;
  }

  function beginMove(e, p) {
    let ids = store.selection.filter((id) => !findElement(store.scene.elements, id)?.el.locked);
    if (ids.length === 0) return;
    if (e.altKey) {
      duplicateSelection(0);
      ids = [...store.selection];
    }
    const starts = startsOf(ids);
    session = {
      kind: "move", p0: p, ids, starts, applied: { x: 0, y: 0 },
      box0: unionBox([...starts.values()].map(aabb)),
      targets: snapTargets(ids), moved: false, client0: { x: e.clientX, y: e.clientY },
    };
  }

  function beginResize(handle, p) {
    const f = selectionFrame();
    if (!f) return;
    const [hx, hy] = handle.split(",").map(Number);
    session = {
      kind: "resize", p0: p, hx, hy, frame: f, starts: startsOf(store.selection),
      targets: snapTargets(store.selection),
    };
  }

  function beginRotate(p) {
    const f = selectionFrame();
    if (!f) return;
    const c = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
    session = {
      kind: "rotate", c, a0: Math.atan2(p.y - c.y, p.x - c.x), starts: startsOf(store.selection),
      single: f.single && f.single.type !== "group" ? f.single.id : null,
    };
  }

  // ===============================
  // 操作の途中
  // ===============================
  function moveTo(p, e) {
    let dx = p.x - session.p0.x;
    let dy = p.y - session.p0.y;
    if (!session.moved && Math.hypot(e.clientX - session.client0.x, e.clientY - session.client0.y) < DRAG_THRESHOLD) return;
    session.moved = true;
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0;
    }
    if (!(e.ctrlKey || e.metaKey)) {
      const b = { ...session.box0, x: session.box0.x + dx, y: session.box0.y + dy };
      const s = snapBox(b, session.targets, { x: !e.shiftKey || dx !== 0, y: !e.shiftKey || dy !== 0 });
      dx += s.dx;
      dy += s.dy;
    } else guides = [];
    dx = Math.round(dx * 100) / 100;
    dy = Math.round(dy * 100) / 100;
    live(() => {
      for (const id of session.ids) {
        const el = findElement(store.scene.elements, id)?.el;
        if (el) translate(el, dx - session.applied.x, dy - session.applied.y);
      }
      session.applied = { x: dx, y: dy };
    });
  }

  function resizeTo(p, e) {
    const { frame: f, hx, hy } = session;
    const keepAspect = e.shiftKey !== (
      // 角のハンドルは、画像・グループ・複数選択・テキストでは縦横比を保つのが既定
      hx !== 0 && hy !== 0 && (!f.single || ["image", "group", "text"].includes(f.single.type)));
    const alt = e.altKey;
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    const lp = rotatePoint(p.x, p.y, cx, cy, -f.rotation);
    let lx = lp.x - cx;
    let ly = lp.y - cy;

    // 回転していなければ、掴んだ辺をガイドに吸い寄せる
    if (!f.rotation && store.snap && !(e.ctrlKey || e.metaKey)) {
      const edge = { x: [cx + lx], y: [cy + ly] };
      const s = snapBox({ x: cx + lx, y: cy + ly, w: 0, h: 0 }, session.targets, { x: hx !== 0, y: hy !== 0 }, edge);
      lx += s.dx;
      ly += s.dy;
    } else guides = [];

    const ax = alt ? 0 : (-hx * f.w) / 2;
    const ay = alt ? 0 : (-hy * f.h) / 2;
    let nw = f.w;
    let nh = f.h;
    if (hx) nw = Math.max(1, alt ? Math.abs(lx) * 2 : (lx - ax) * hx);
    if (hy) nh = Math.max(1, alt ? Math.abs(ly) * 2 : (ly - ay) * hy);
    if (keepAspect) {
      const r = f.w / f.h;
      if (hx && hy) {
        if (nw / nh > r) nh = nw / r; else nw = nh * r;
      } else if (hx) nh = nw / r;
      else if (hy) nw = nh * r;
    }
    const ncx = alt ? 0 : hx ? ax + (hx * nw) / 2 : 0;
    const ncy = alt ? 0 : hy ? ay + (hy * nh) / 2 : 0;
    const c = rotatePoint(cx + ncx, cy + ncy, cx, cy, f.rotation);
    const nb = { x: c.x - nw / 2, y: c.y - nh / 2, w: nw, h: nh };

    live(() => {
      if (f.single && f.single.type !== "group") {
        const el = resetTo(session.starts.get(f.single.id));
        if (!el) return;
        // テキストを角で拡大したら文字も大きくする（Canva と同じ）
        if (el.type === "text" && hx && hy && keepAspect) {
          el.font.size = Math.max(4, Math.round(el.font.size * (nw / f.w) * 10) / 10);
        }
        Object.assign(el, { x: nb.x, y: nb.y, w: nb.w, h: nb.h });
        return;
      }
      const ssx = nw / f.w;
      const ssy = nh / f.h;
      for (const start of session.starts.values()) {
        const el = resetTo(start);
        if (!el) continue;
        scaleAbout(el, f.x, f.y, ssx, ssy);
        translate(el, nb.x - f.x, nb.y - f.y);
      }
    });
  }

  function rotateTo(p, e) {
    const a = Math.atan2(p.y - session.c.y, p.x - session.c.x);
    let delta = ((a - session.a0) * 180) / Math.PI;
    live(() => {
      if (session.single) {
        const start = session.starts.get(session.single);
        const el = resetTo(start);
        if (!el) return;
        let r = normalizeAngle((start.rotation || 0) + delta);
        if (e.shiftKey) r = normalizeAngle(Math.round(r / 15) * 15);
        else if (Math.abs(r % 90) < 2 || Math.abs(r % 90) > 88) r = normalizeAngle(Math.round(r / 90) * 90);
        el.rotation = r;
        return;
      }
      if (e.shiftKey) delta = Math.round(delta / 15) * 15;
      for (const start of session.starts.values()) {
        const el = resetTo(start);
        if (el) rotateAbout(el, session.c.x, session.c.y, delta);
      }
    });
  }

  // ===============================
  // 作る道具
  // ===============================
  const SHAPE_TOOLS = {
    rect: () => createElement("rect", { name: "四角形" }),
    ellipse: () => createElement("ellipse", { name: "円" }),
    polygon: () => createElement("polygon", { name: "三角形", sides: 3 }),
    star: () => createElement("polygon", { name: "星", sides: 5, star: true, fill: solid("#ffc93c") }),
    text: () => createElement("text", { name: "テキスト", w: 480, h: 110 }),
  };

  function beginCreate(p, e) {
    session = { kind: "create", p0: p, client0: { x: e.clientX, y: e.clientY }, el: null, tool: store.tool };
  }

  function createTo(p, e) {
    if (!session.el && Math.hypot(e.clientX - session.client0.x, e.clientY - session.client0.y) < DRAG_THRESHOLD) return;
    let x0 = session.p0.x;
    let y0 = session.p0.y;
    let w = p.x - x0;
    let h = p.y - y0;
    if (e.shiftKey) {
      const m = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * m;
      h = Math.sign(h || 1) * m;
    }
    if (e.altKey) { x0 -= w; y0 -= h; w *= 2; h *= 2; }
    const box = {
      x: Math.round(Math.min(x0, x0 + w)), y: Math.round(Math.min(y0, y0 + h)),
      w: Math.max(1, Math.round(Math.abs(w))), h: Math.max(1, Math.round(Math.abs(h))),
    };
    live((scene) => {
      if (!session.el) {
        session.el = SHAPE_TOOLS[session.tool]();
        const target = store.enteredGroup && findElement(scene.elements, store.enteredGroup)?.el;
        (target?.children ?? scene.elements).push(session.el);
        store.selection = [session.el.id];
      }
      const el = findElement(scene.elements, session.el.id)?.el;
      Object.assign(el, box);
    });
  }

  function endCreate(p) {
    const tool = session.tool;
    if (session.el) {
      endLive();
      select(session.el.id);
      if (tool === "text") startTextEdit(session.el.id);
    } else {
      const el = SHAPE_TOOLS[tool]();
      addElement(el, { at: p });
      if (tool === "text") requestAnimationFrame(() => startTextEdit(el.id));
    }
    setTool("select");
  }

  function beginLine(p, e) {
    session = { kind: "line", p0: p, client0: { x: e.clientX, y: e.clientY }, el: null };
  }

  function lineTo(p, e) {
    if (!session.el && Math.hypot(e.clientX - session.client0.x, e.clientY - session.client0.y) < DRAG_THRESHOLD) return;
    let { x, y } = p;
    if (e.shiftKey) {
      const a = Math.atan2(y - session.p0.y, x - session.p0.x);
      const d = Math.hypot(x - session.p0.x, y - session.p0.y);
      const snapped = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
      x = session.p0.x + Math.cos(snapped) * d;
      y = session.p0.y + Math.sin(snapped) * d;
    }
    const nodes = [{ x: session.p0.x, y: session.p0.y }, { x, y }];
    live((scene) => {
      if (!session.el) {
        session.el = pathElementFromNodes(nodes, false, { name: "線", stroke: { paint: solid("#ffffff"), width: 8 } });
        scene.elements.push(session.el);
        store.selection = [session.el.id];
      }
      setPathNodes(findElement(scene.elements, session.el.id).el, nodes, false);
    });
  }

  // ---- ペン（Illustrator 風：クリックで角、ドラッグでなめらかな点、始点クリックで閉じる） ----
  function penDown(p, e) {
    if (!pen) pen = { nodes: [], dragging: false, cursor: p };
    const first = pen.nodes[0];
    if (first && pen.nodes.length > 2 && Math.hypot(sx(first.x) - sx(p.x), sy(first.y) - sy(p.y)) < 10) {
      finishPen(true);
      return;
    }
    const last = pen.nodes[pen.nodes.length - 1];
    // ダブルクリックの2回目のクリックで同じ点が重なったら足さない
    if (last && Math.hypot(sx(last.x) - sx(p.x), sy(last.y) - sy(p.y)) < 3) return;
    pen.nodes.push({ x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y });
    pen.dragging = true;
    session = { kind: "pen", alt: e.altKey };
    schedule(false);
  }

  function penMove(p, e) {
    if (!pen) return;
    pen.cursor = p;
    if (pen.dragging) {
      const n = pen.nodes[pen.nodes.length - 1];
      n.ox = p.x; n.oy = p.y;
      if (!e.altKey) { n.ix = 2 * n.x - p.x; n.iy = 2 * n.y - p.y; }
      n.s = !e.altKey;
    }
    schedule(false);
  }

  function finishPen(closed) {
    const draft = pen;
    pen = null;
    session = null;
    if (draft && draft.nodes.length >= 2) {
      const el = pathElementFromNodes(draft.nodes, closed, {
        name: closed ? "シェイプ" : "パス",
        fill: closed ? solid("#7c5cff") : NONE,
        stroke: { paint: solid("#ffffff"), width: 4 },
      });
      // pathElementFromNodes は s（なめらか）を落とすので戻す
      el.path.nodes.forEach((n, i) => { if (draft.nodes[i].s) n.s = true; });
      addElement(el);
    }
    schedule(false);
  }

  // ---- 鉛筆 ----
  function pencilEnd() {
    const pts = pencil;
    pencil = null;
    session = null;
    if (!pts || pts.length < 2) { schedule(false); return; }
    const simple = simplify(pts, Math.max(0.8, 2 / store.zoom));
    const nodes = simple.length > 2 ? smoothNodes(simple) : simple.map((q) => ({ ...q }));
    const el = pathElementFromNodes(nodes, false, {
      name: "手書き", fill: NONE, stroke: { paint: solid("#ffffff"), width: 6, cap: "round", join: "round" },
    });
    el.path.nodes.forEach((n) => { n.s = true; });
    addElement(el);
  }

  // ---- パスの点の編集 ----
  function beginNodeDrag(index, part, p, e) {
    const el = findElement(store.scene.elements, store.nodeEdit)?.el;
    if (!el) return;
    if (part === "a" && e.altKey) {
      // Alt+クリックで角 ⇔ なめらか
      change((scene) => {
        const n = findElement(scene.elements, el.id).el.path.nodes[index];
        const nodes = findElement(scene.elements, el.id).el.path.nodes;
        const corner = (n.ix ?? n.x) === n.x && (n.iy ?? n.y) === n.y && (n.ox ?? n.x) === n.x && (n.oy ?? n.y) === n.y;
        if (corner) {
          const prev = nodes[index - 1] ?? nodes[index + 1];
          const next = nodes[index + 1] ?? nodes[index - 1];
          const dx = (next.x - prev.x) / 6;
          const dy = (next.y - prev.y) / 6;
          Object.assign(n, { ix: n.x - dx, iy: n.y - dy, ox: n.x + dx, oy: n.y + dy, s: true });
        } else {
          Object.assign(n, { ix: n.x, iy: n.y, ox: n.x, oy: n.y, s: false });
        }
      });
      return;
    }
    nodeSel = index;
    session = { kind: "node", index, part, start: clone(el.path.nodes[index]), p0: sceneToPath(el, p.x, p.y), id: el.id };
    schedule(false);
  }

  function nodeDragTo(p, e) {
    live((scene) => {
      const el = findElement(scene.elements, session.id)?.el;
      if (!el) return;
      const lp = sceneToPath(el, p.x, p.y);
      const n = el.path.nodes[session.index];
      const s = session.start;
      if (session.part === "a") {
        const dx = lp.x - session.p0.x;
        const dy = lp.y - session.p0.y;
        Object.assign(n, {
          x: s.x + dx, y: s.y + dy,
          ix: (s.ix ?? s.x) + dx, iy: (s.iy ?? s.y) + dy, ox: (s.ox ?? s.x) + dx, oy: (s.oy ?? s.y) + dy,
        });
        return;
      }
      const [k, other] = session.part === "o" ? ["o", "i"] : ["i", "o"];
      n[`${k}x`] = lp.x;
      n[`${k}y`] = lp.y;
      if (s.s && !e.altKey) {
        // なめらかな点は反対側の腕を一直線に保つ（長さはそのまま）
        const len = Math.hypot((s[`${other}x`] ?? s.x) - s.x, (s[`${other}y`] ?? s.y) - s.y);
        const ang = Math.atan2(lp.y - n.y, lp.x - n.x) + Math.PI;
        n[`${other}x`] = n.x + Math.cos(ang) * len;
        n[`${other}y`] = n.y + Math.sin(ang) * len;
      } else if (e.altKey) n.s = false;
    });
  }

  function deleteSelectedNode() {
    if (!store.nodeEdit || nodeSel < 0) return false;
    change((scene) => {
      const el = findElement(scene.elements, store.nodeEdit)?.el;
      if (!el || el.path.nodes.length <= 2) return;
      el.path.nodes.splice(nodeSel, 1);
      rebasePath(el);
    });
    nodeSel = -1;
    return true;
  }

  function enterNodeEdit(id) {
    store.nodeEdit = id;
    nodeSel = -1;
    select(id);
  }

  function exitNodeEdit() {
    if (!store.nodeEdit) return;
    store.nodeEdit = null;
    nodeSel = -1;
    emit("selection");
  }

  // ---- 文字の直接編集 ----
  function startTextEdit(id) {
    const n = renderer.node(id);
    const el = findElement(store.scene.elements, id)?.el;
    if (!n?.textInner || !el || el.locked) return;
    store.editingText = id;
    select(id);
    const inner = n.textInner;
    inner.textContent = el.text ?? "";
    try { inner.contentEditable = "plaintext-only"; } catch (e) { inner.contentEditable = "true"; }
    if (inner.contentEditable !== "plaintext-only") inner.contentEditable = "true";
    inner.classList.add("editing");
    inner.focus();
    const range = document.createRange();
    range.selectNodeContents(inner);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const finish = () => {
      inner.removeEventListener("blur", finish);
      inner.removeEventListener("keydown", onKey);
      inner.contentEditable = "false";
      inner.classList.remove("editing");
      const text = inner.innerText.replace(/\n$/, "");
      store.editingText = null;
      n.sig = null; // 差し込み値を描き直させる
      change((scene) => {
        const target = findElement(scene.elements, id)?.el;
        if (target) target.text = text;
      });
      schedule(true);
    };
    const onKey = (ev) => {
      ev.stopPropagation();
      if (ev.key === "Escape" || (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey))) {
        ev.preventDefault();
        inner.blur();
      }
    };
    inner.addEventListener("blur", finish);
    inner.addEventListener("keydown", onKey);
    schedule(false);
  }

  // ===============================
  // ポインター
  // ===============================
  viewport.addEventListener("pointerdown", (e) => {
    if (store.editingText) {
      const n = renderer.node(store.editingText);
      if (n?.textInner?.contains(e.target)) return; // 文字の中のクリックはカーソル移動
      n?.textInner?.blur();
    }
    if (e.button === 2) return; // 右クリックは contextmenu で
    viewport.setPointerCapture(e.pointerId);
    const p = toScene(e.clientX, e.clientY);

    // 手のひら（中ボタン・スペース・手のひらツール）
    if (e.button === 1 || spaceDown || store.tool === "hand") {
      e.preventDefault();
      session = { kind: "pan", x0: e.clientX, y0: e.clientY, panX: store.panX, panY: store.panY };
      viewport.classList.add("panning");
      return;
    }

    const handle = e.target.closest?.("[data-handle], [data-node]");
    if (handle?.dataset.node !== undefined && store.nodeEdit) {
      beginNodeDrag(Number(handle.dataset.node), handle.dataset.part, p, e);
      return;
    }
    if (handle?.dataset.handle === "rotate") { beginRotate(p); return; }
    if (handle?.dataset.handle) { beginResize(handle.dataset.handle, p); return; }

    switch (store.tool) {
      case "pen": penDown(p, e); return;
      case "pencil": pencil = [p]; session = { kind: "pencil" }; return;
      case "line": beginLine(p, e); return;
      case "rect": case "ellipse": case "polygon": case "star": case "text":
        beginCreate(p, e); return;
      default: break;
    }

    // 選択ツール
    if (store.nodeEdit) exitNodeEdit();
    const hit = hitTest(e.clientX, e.clientY, { deep: e.ctrlKey || e.metaKey });
    if (hit) {
      if (e.shiftKey) {
        select(hit, { toggle: true });
        return;
      }
      if (!store.selection.includes(hit)) select(hit);
      beginMove(e, p);
      return;
    }
    // 何もない所：グループから出て、範囲選択を始める
    if (store.enteredGroup) store.enteredGroup = null;
    if (!e.shiftKey) select([]);
    session = { kind: "marquee", p0: p, base: e.shiftKey ? [...store.selection] : [] };
  });

  viewport.addEventListener("pointermove", (e) => {
    const p = toScene(e.clientX, e.clientY);
    if (!session) {
      if (store.tool === "pen") { penMove(p, e); return; }
      if (store.tool === "select") {
        const h = hitTest(e.clientX, e.clientY);
        if (h !== hoverId) { hoverId = h; schedule(false); }
      }
      return;
    }
    switch (session.kind) {
      case "pan":
        store.panX = session.panX + (e.clientX - session.x0);
        store.panY = session.panY + (e.clientY - session.y0);
        emit("view");
        break;
      case "move": moveTo(p, e); break;
      case "resize": resizeTo(p, e); break;
      case "rotate": rotateTo(p, e); break;
      case "create": createTo(p, e); break;
      case "line": lineTo(p, e); break;
      case "pen": penMove(p, e); break;
      case "node": nodeDragTo(p, e); break;
      case "pencil": {
        const last = pencil[pencil.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * store.zoom > 2) pencil.push(p);
        schedule(false);
        break;
      }
      case "marquee": {
        const x = Math.min(session.p0.x, p.x);
        const y = Math.min(session.p0.y, p.y);
        marquee = { x, y, w: Math.abs(p.x - session.p0.x), h: Math.abs(p.y - session.p0.y) };
        const list = store.enteredGroup
          ? findElement(store.scene.elements, store.enteredGroup)?.el.children ?? []
          : store.scene.elements;
        const hits = list.filter((el) => {
          if (el.locked || el.visible === false) return false;
          const b = aabb(el);
          return b.x < x + marquee.w && b.x + b.w > x && b.y < y + marquee.h && b.y + b.h > y;
        }).map((el) => el.id);
        store.selection = [...new Set([...session.base, ...hits])];
        emit("selection");
        break;
      }
      default: break;
    }
  });

  function endSession(e) {
    if (!session) return;
    const s = session;
    const p = toScene(e.clientX, e.clientY);
    switch (s.kind) {
      case "pan": viewport.classList.remove("panning"); break;
      case "move": case "resize": case "rotate": case "line": endLive(); break;
      case "node": {
        live((scene) => { const el = findElement(scene.elements, s.id)?.el; if (el) rebasePath(el); });
        endLive();
        break;
      }
      case "create": endCreate(p); break;
      case "pen":
        if (pen) pen.dragging = false;
        session = null;
        schedule(false);
        return;
      case "pencil": pencilEnd(); return;
      case "marquee": marquee = null; break;
      default: break;
    }
    if (s.kind === "line") setTool("select");
    session = null;
    guides = [];
    schedule(false);
  }
  viewport.addEventListener("pointerup", endSession);
  viewport.addEventListener("pointercancel", endSession);

  viewport.addEventListener("dblclick", (e) => {
    if (store.tool === "pen" && pen) { finishPen(false); return; }
    if (store.tool !== "select") return;
    const hit = hitTest(e.clientX, e.clientY);
    const el = hit && findElement(store.scene.elements, hit)?.el;
    if (!el) return;
    if (el.type === "group") {
      // グループの中へ入って、その下の子を選ぶ
      store.enteredGroup = el.id;
      const child = hitTest(e.clientX, e.clientY);
      select(child && child !== el.id ? child : []);
      return;
    }
    if (el.type === "text") startTextEdit(el.id);
    else if (el.type === "path") enterNodeEdit(el.id);
  });

  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(store.zoom * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    } else {
      store.panX -= e.shiftKey ? e.deltaY : e.deltaX;
      store.panY -= e.shiftKey ? 0 : e.deltaY;
      emit("view");
    }
  }, { passive: false });

  viewport.addEventListener("pointerleave", () => {
    if (hoverId) { hoverId = null; schedule(false); }
  });

  viewport.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const hit = hitTest(e.clientX, e.clientY);
    if (hit && !store.selection.includes(hit)) select(hit);
    o.onContextMenu(e, hit);
  });

  viewport.addEventListener("dragover", (e) => { e.preventDefault(); viewport.classList.add("drop"); });
  viewport.addEventListener("dragleave", () => viewport.classList.remove("drop"));
  viewport.addEventListener("drop", (e) => {
    e.preventDefault();
    viewport.classList.remove("drop");
    o.onDrop(e.dataTransfer, toScene(e.clientX, e.clientY));
  });

  // スペースを押している間は手のひら
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.repeat && !isTyping()) {
      spaceDown = true;
      viewport.classList.add("hand");
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") { spaceDown = false; viewport.classList.remove("hand"); }
  });

  new ResizeObserver(() => schedule(false)).observe(viewport);

  return {
    renderer,
    fit,
    zoomAt,
    toScene,
    startTextEdit,
    enterNodeEdit,
    exitNodeEdit,
    deleteSelectedNode,
    /** Esc / Enter でペンを仕上げる。何かしたら true */
    finishDrawing(closed = false) {
      if (pen) { finishPen(closed); return true; }
      return false;
    },
    undoPenPoint() {
      if (!pen || pen.nodes.length === 0) return false;
      pen.nodes.pop();
      if (pen.nodes.length === 0) pen = null;
      schedule(false);
      return true;
    },
    get isDrawing() { return !!pen; },
    redraw: () => schedule(true),
    /** 選択範囲の中心（シーン座標） */
    viewCenter() {
      const r = vpRect();
      return toScene(r.left + r.width / 2, r.top + r.height / 2);
    },
    elementsAt: () => flatten(store.scene?.elements || []),
  };
}
