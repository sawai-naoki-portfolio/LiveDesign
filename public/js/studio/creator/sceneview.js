// public/js/studio/creator/sceneview.js
// 真ん中の「シーン」：ギミックのステージ。止めているときはオブジェクトを並べて動かし、
// ▶ 再生すると本番（OBS）と同じエンジンで動かす（Unity のシーンビューとゲームビューを1つにしたもの）。
import { cstore, onC, change, live, endLive, selectC, findIn, emitC } from "./state.js";
import { h } from "../editor/ui.js";
import { createPlayer } from "../shared/gimmick/player.js";
import { normalizeObject } from "../shared/gimmick/defaults.js";
import { clone, uid } from "../shared/model.js";

const HANDLES = ["nw", "ne", "sw", "se"];

/**
 * @param {HTMLElement} root
 * @param {{onLog: (text: string, level: string) => void, getAudio: () => object, playUrl: (url: string, v: number) => void}} opts
 */
export function initSceneView(root, opts) {
  const stage = h("div", { class: "cr-stage" });
  const canvasHost = h("div", { class: "cr-canvas-host" });
  const sel = h("div", { class: "cr-sel", hidden: true }, HANDLES.map((k) => h("span", { class: `cr-handle ${k}`, dataset: { handle: k } })));
  const label = h("div", { class: "cr-sel-label" });
  sel.appendChild(label);
  const stats = h("div", { class: "cr-stats" });
  stage.append(canvasHost, sel);
  const wrap = h("div", { class: "cr-stage-wrap" }, stage, stats);
  root.appendChild(wrap);

  let player = null;
  let traceFn = null;

  function g() { return cstore.gimmick; }

  function makePlayer(mode) {
    player?.destroy();
    player = createPlayer(canvasHost, clone(g()), {
      mode,
      onLog: opts.onLog,
      getAudio: opts.getAudio,
      playUrl: opts.playUrl,
      onFrame: mode === "play" ? showStats : null,
      onTrace: mode === "play" ? (id, gid) => traceFn?.(id, gid) : null,
    });
    stage.classList.toggle("playing", mode === "play");
  }

  function layout() {
    const gm = g();
    // ブループリントを開いている間（シーンが隠れている）は大きさを測れないので合わせない
    if (!gm || !wrap.clientWidth || !wrap.clientHeight) return;
    const W = gm.width;
    const H = gm.height;
    const avail = { w: Math.max(100, wrap.clientWidth - 48), h: Math.max(100, wrap.clientHeight - 48) };
    if (cstore.zoom === "fit" || !cstore.zoomSet) cstore.zoom = Math.min(2, avail.w / W, avail.h / H);
    stage.style.width = `${W * cstore.zoom}px`;
    stage.style.height = `${H * cstore.zoom}px`;
    stage.classList.toggle("checker", gm.background === "transparent");
    syncSelection();
    emitC("view");
  }

  function showStats(world) {
    if ((world.time * 10 | 0) % 3) return; // 毎フレーム書き換えない
    stats.textContent = `⏱ ${world.time.toFixed(1)}秒　オブジェクト ${world.entities.length}　パーティクル ${world.particles.length}`;
  }

  // ===============================
  // 選択枠
  // ===============================
  function syncSelection() {
    const s = cstore.selection;
    const o = s?.type === "object" && cstore.play === "stopped" ? findIn(g(), "object", s.id) : null;
    sel.hidden = !o;
    if (!o) return;
    const z = cstore.zoom;
    const n = normalizeObject(o);
    Object.assign(sel.style, {
      left: `${n.x * z}px`, top: `${n.y * z}px`, width: `${n.w * z}px`, height: `${n.h * z}px`,
      transform: n.rotation ? `rotate(${n.rotation}deg)` : "",
    });
    label.textContent = `${n.prefab ? "📦 " : ""}${n.name}${n.tag ? `  #${n.tag}` : ""}`;
  }

  // ===============================
  // マウス
  // ===============================
  function toStage(ev) {
    const r = stage.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / cstore.zoom, y: (ev.clientY - r.top) / cstore.zoom };
  }

  function hit(p) {
    const list = g().objects;
    for (let i = list.length - 1; i >= 0; i--) {
      const o = normalizeObject(list[i]);
      if (p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h) return list[i];
    }
    return null;
  }

  stage.addEventListener("pointerdown", (ev) => {
    if (cstore.play !== "stopped" || ev.button !== 0) return;
    const p0 = toStage(ev);
    const handle = ev.target.dataset?.handle;
    let target = handle ? findIn(g(), "object", cstore.selection?.id) : hit(p0);
    if (!target) {
      selectC(null);
      return;
    }
    // Alt を押しながらドラッグで複製（アーティストモードと同じ）
    if (ev.altKey && !handle) {
      const copy = clone(target);
      copy.id = uid("obj");
      copy.name = `${target.name} のコピー`;
      change((gm) => { gm.objects.push(copy); });
      target = copy;
    }
    selectC("object", target.id);
    const id = target.id;
    const start = normalizeObject(target);
    stage.setPointerCapture(ev.pointerId);
    const move = (e) => {
      const p = toStage(e);
      const dx = p.x - p0.x;
      const dy = p.y - p0.y;
      live((gm) => {
        const o = gm.objects.find((x) => x.id === id);
        if (!o) return;
        if (!handle) {
          o.x = Math.round(start.x + dx);
          o.y = Math.round(start.y + dy);
          return;
        }
        let { x, y, w, h: hh } = start;
        if (handle.includes("e")) w = start.w + dx;
        if (handle.includes("s")) hh = start.h + dy;
        if (handle.includes("w")) { w = start.w - dx; x = start.x + dx; }
        if (handle.includes("n")) { hh = start.h - dy; y = start.y + dy; }
        if (e.shiftKey) {
          const k = Math.max(w / start.w, hh / start.h);
          w = start.w * k;
          hh = start.h * k;
          if (handle.includes("w")) x = start.x + start.w - w;
          if (handle.includes("n")) y = start.y + start.h - hh;
        }
        o.x = Math.round(x);
        o.y = Math.round(y);
        o.w = Math.max(4, Math.round(w));
        o.h = Math.max(4, Math.round(hh));
        if (o.look?.shape === "text" && e.shiftKey) o.look.fontSize = Math.max(4, Math.round(start.look.fontSize * (o.h / start.h)));
      });
    };
    const up = () => {
      stage.removeEventListener("pointermove", move);
      stage.removeEventListener("pointerup", up);
      endLive();
    };
    stage.addEventListener("pointermove", move);
    stage.addEventListener("pointerup", up);
  });

  stage.addEventListener("dblclick", (ev) => {
    if (cstore.play !== "stopped") return;
    const o = hit(toStage(ev));
    if (o && o.look?.shape === "text") emitC("focusField", "look.text");
  });

  // ===============================
  // 再生・停止
  // ===============================
  let lastPlay = "stopped";
  onC((kind, detail) => {
    if (kind === "play") {
      if (cstore.play === "playing" && lastPlay === "stopped") makePlayer("play");
      if (cstore.play === "stopped" && lastPlay !== "stopped") { makePlayer("edit"); stats.textContent = ""; }
      player?.setPaused(cstore.play === "paused");
      lastPlay = cstore.play;
      syncSelection();
    }
    if (kind === "gimmick") {
      // 編集中はその場で描き直す。再生中は止めるまで今の中身で動かし続ける（Unity と同じ）
      if (cstore.play === "stopped") {
        if (detail?.sizeChanged || !player) layout();
        player?.setDef(clone(g()));
      }
      if (g().width * cstore.zoom !== parseFloat(stage.style.width)) layout();
      syncSelection();
    }
    if (kind === "selection") syncSelection();
  });

  new ResizeObserver(() => layout()).observe(wrap);

  makePlayer("edit");
  layout();

  return {
    get player() { return player; },
    /** ブループリントのノードが動いたら呼ぶ（エディタで光らせる） */
    onTrace(fn) { traceFn = fn; },
    layout,
    zoomTo(z) {
      cstore.zoomSet = z !== "fit";
      cstore.zoom = z === "fit" ? "fit" : Math.max(0.1, Math.min(4, z));
      layout();
    },
    /** コンソールの「合図を送る」・テストのイベント */
    signal(name, payload) { return player?.mode === "play" ? player.world.signal(name, payload) : 0; },
    liveEvent(ev) { if (player?.mode === "play") player.liveEvent(ev); },
    stepOnce() { if (player?.mode === "play") player.stepOnce(); },
  };
}
