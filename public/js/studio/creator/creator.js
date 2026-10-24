// public/js/studio/creator/creator.js
// クリエイターモード（/studio?gimmick=<id>）：アーティストモードで使うギミックを作るエディタ。
// Unity / Unreal Engine の画面の並びにならっている：
//
//   ┌ 上：名前・保存・元に戻す・▶ 再生 ⏸ 一時停止 ⏹ 停止 ──────────────────────────┐
//   │ 左：ヒエラルキー │ 真ん中：🎬 シーン ／ 🧩 ブループリント      │ 右：インスペクター │
//   │     アセット     │ 下：コンソール（ログ・合図やギフトを流して試す） │                    │
//   └──────────────────────────────────────────────────────────────────────────┘
//
// 部品はそれぞれのファイルにある：
//   creator/state.js      状態・履歴・自動保存     creator/sceneview.js  ステージと再生
//   creator/hierarchy.js  オブジェクト・アセット   creator/inspector.js  プロパティ
//   creator/graph.js      ブループリント（ノード） creator/console.js    ログとテスト
// 動かす中身（エンジン）は shared/gimmick/ にあり、OBS のオーバーレイと同じものを使う。
import {
  cstore, onC, change, undo, redo, canUndo, canRedo, flushSaveC, selectC, setPlay, findIn,
} from "./state.js";
import { initSceneView } from "./sceneview.js";
import { initHierarchy } from "./hierarchy.js";
import { initCreatorInspector } from "./inspector.js";
import { initGraphEditor } from "./graph.js";
import { ensureFunctionGraph } from "./functions.js";
import { initConsole } from "./console.js";
import { api } from "../editor/api.js";
import { refreshAssets } from "../editor/assets.js";
import { h, icon, toast, openContextMenu, isTyping, bindTabs } from "../editor/ui.js";
import { paintSaveState } from "../editor/document.js";
import { GIMMICK_KIND_LABELS } from "../shared/gimmick/defaults.js";
import { downloadGimmick } from "./io.js";
import { clone, uid } from "../shared/model.js";

/**
 * @param {HTMLElement} root
 * @param {string} id
 */
export async function startCreator(root, id) {
  let g;
  try {
    g = await api.getGimmick(id);
  } catch (e) {
    toast("ギミックが見つかりませんでした", "error");
    location.href = "/studio?mode=creator";
    return;
  }
  for (const k of ["variables", "objects", "sounds", "effects"]) g[k] = Array.isArray(g[k]) ? g[k] : [];
  g.graph = g.graph && typeof g.graph === "object" ? g.graph : {};
  for (const k of ["nodes", "links", "comments"]) g.graph[k] = Array.isArray(g.graph[k]) ? g.graph[k] : [];
  g.functions = Array.isArray(g.functions) ? g.functions.filter((f) => f && typeof f === "object" && f.id) : [];
  for (const f of g.functions) ensureFunctionGraph(f);
  cstore.graphId = null;
  cstore.gimmick = g;
  document.title = `${g.name} - クリエイターモード - LiveDesign Studio`;
  document.body.classList.add("creator-mode");
  root.hidden = false;
  refreshAssets();

  // ===============================
  // 画面の骨組み
  // ===============================
  const nameInput = h("input", { type: "text", class: "scene-name", value: g.name, "aria-label": "ギミックの名前" });
  const kindSel = h("select", { class: "cr-kind", "aria-label": "種類" }, Object.entries(GIMMICK_KIND_LABELS).map(([k, v]) => h("option", { value: k }, v)));
  const saveState = h("span", { class: "save-state" });
  const btnUndo = h("button", { type: "button", class: "icon-btn", title: "元に戻す（Ctrl+Z）", onclick: undo }, icon("undo"));
  const btnRedo = h("button", { type: "button", class: "icon-btn", title: "やり直し（Ctrl+Shift+Z）", onclick: redo }, icon("redo"));
  const btnPlay = h("button", { type: "button", class: "cr-play-btn play", title: "再生（Ctrl+Enter）" }, "▶");
  const btnPause = h("button", { type: "button", class: "cr-play-btn", title: "一時停止" }, "⏸");
  const btnStep = h("button", { type: "button", class: "cr-play-btn", title: "コマ送り（一時停止中）" }, "⏭");
  const btnStop = h("button", { type: "button", class: "cr-play-btn stop", title: "停止して最初に戻す（Esc）" }, "⏹");
  const zoomLabel = h("button", { type: "button", class: "zoom-label", title: "表示倍率" }, "100%");

  const topbar = h("header", { class: "topbar cr-topbar" },
    h("button", { type: "button", class: "btn ghost", title: "一覧へ", onclick: async () => { await flushSaveC(); location.href = "/studio?mode=creator"; } }, "◀ 一覧"),
    h("span", { class: "mode-chip creator" }, "🛠 クリエイター"),
    nameInput, kindSel, saveState,
    h("span", { class: "spacer" }),
    btnUndo, btnRedo,
    h("span", { class: "cr-play" }, btnPlay, btnPause, btnStep, btnStop),
    h("span", { class: "spacer" }),
    h("span", { class: "zoom" }, zoomLabel),
    h("button", { type: "button", class: "btn", title: "JSON で書き出す（バックアップ・人に渡す）", onclick: () => downloadGimmick(cstore.gimmick) }, "⤓ 書き出し"),
    h("button", {
      type: "button", class: "btn primary", title: "アーティストモードのデザイン一覧を開く",
      onclick: async () => { await flushSaveC(); window.open("/studio?mode=artist", "_blank"); },
    }, "🎨 アーティストモードで使う ↗"));

  const leftTabs = h("div", { class: "tabs" }, h("button", { type: "button", dataset: { tab: "hier" } }, "ヒエラルキー"), h("button", { type: "button", dataset: { tab: "assets" } }, "アセット"));
  const hierBody = h("div", { class: "tab-body cr-list" });
  const assetsBody = h("div", { class: "tab-body cr-list" });
  const left = h("aside", { class: "side left" }, leftTabs, hierBody, assetsBody);

  const centerTabs = h("div", { class: "tabs cr-center-tabs" },
    h("button", { type: "button", dataset: { tab: "scene" } }, "🎬 シーン"),
    h("button", { type: "button", dataset: { tab: "graph" } }, "🧩 ブループリント"),
    h("button", { type: "button", dataset: { tab: "split" }, title: "シーンとブループリントを並べる（再生中に、動いたノードが光るのを見ながら確かめられます）" }, "◫ 並べる"));
  const sceneBody = h("div", { class: "cr-scene" });
  const centerBody = h("div", { class: "cr-center-body" });
  const graphBody = h("div", { class: "cr-graph" });
  const consoleBody = h("div", { class: "cr-console" });
  const center = h("section", { class: "cr-center" }, centerTabs, centerBody, consoleBody);

  const inspBody = h("div", { class: "tab-body" });
  const right = h("aside", { class: "side right" }, h("div", { class: "tabs" }, h("button", { type: "button", class: "active" }, "インスペクター")), inspBody);

  root.append(topbar, h("div", { class: "main cr-main" }, left, center, right));

  // ===============================
  // 部品
  // ===============================
  let consoleApi = null;
  const sceneView = initSceneView(sceneBody, {
    onLog: (text, level) => consoleApi?.log(text, level),
    getAudio: () => ({ enabled: cstore.sound, volume: 1 }),
    playUrl: (url, v) => {
      try {
        const a = new Audio(url);
        a.volume = Math.max(0, Math.min(1, v));
        a.play().catch(() => { });
      } catch (e) { /* 鳴らせない */ }
    },
  });
  initHierarchy(hierBody, assetsBody);
  initCreatorInspector(inspBody);
  const graphEditor = initGraphEditor(graphBody, {
    isPlaying: () => cstore.play !== "stopped",
    fire: (nodeId) => !!sceneView.player?.world.fireNode(nodeId, { user: "テスト視聴者", count: 1, coins: 1, gift: "ローズ", comment: "テスト", args: "" }),
  });
  sceneView.onTrace((id, gid) => graphEditor.trace(id, gid));
  consoleApi = initConsole(consoleBody, {
    start: () => setPlay("playing"),
    signal: (name, payload) => sceneView.signal(name, payload),
    liveEvent: (ev) => sceneView.liveEvent(ev),
  });

  const showLeft = bindTabs(leftTabs, { hier: hierBody, assets: assetsBody }, "ld-cr-left");
  centerBody.append(sceneBody, graphBody);
  let centerTab = "scene";
  const showCenter = bindTabs(centerTabs, { scene: sceneBody, graph: graphBody, split: null }, "ld-cr-center", (name) => {
    centerTab = name;
    // 「並べる」はシーンとブループリントの両方を出す
    sceneBody.hidden = name === "graph";
    graphBody.hidden = name === "scene";
    centerBody.classList.toggle("split", name === "split");
    requestAnimationFrame(() => {
      if (name !== "graph") sceneView.layout();
      if (name !== "scene") graphEditor.shown();
    });
  });

  // 関数・マクロを開いたら、ブループリントが見えるようにする
  onC((kind) => {
    if (kind === "graphOpened" && centerTab === "scene") showCenter("graph");
  });

  // 左で選んだものに合わせて、右と真ん中を切り替える
  onC((kind) => {
    if (kind !== "selection") return;
    const s = cstore.selection;
    if (s?.type === "sound" || s?.type === "effect" || s?.type === "variable") showLeft("assets");
    if (s?.type === "object") showLeft("hier");
  });

  // ===============================
  // 上のバー
  // ===============================
  nameInput.addEventListener("change", () => change((gm) => { gm.name = nameInput.value.trim() || "無題のギミック"; }));
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nameInput.blur(); });
  kindSel.value = g.kind;
  kindSel.addEventListener("change", () => change((gm) => { gm.kind = kindSel.value; }));

  const play = () => {
    if (cstore.play === "paused") { setPlay("playing"); return; }
    if (cstore.play === "playing") return;
    // ブループリントだけを見ていたら、並べて表示にする（動いたノードが光るのを見ながら確かめられる）
    if (centerTab === "graph") showCenter("split");
    setPlay("playing");
  };
  btnPlay.addEventListener("click", play);
  btnPause.addEventListener("click", () => { if (cstore.play === "playing") setPlay("paused"); });
  btnStep.addEventListener("click", () => { if (cstore.play === "paused") sceneView.stepOnce(); });
  btnStop.addEventListener("click", () => { if (cstore.play !== "stopped") setPlay("stopped"); });

  zoomLabel.addEventListener("click", (e) => {
    const b = e.currentTarget.getBoundingClientRect();
    openContextMenu([
      { label: "画面に合わせる", key: "Ctrl+0", run: () => sceneView.zoomTo("fit") },
      { label: "50%", run: () => sceneView.zoomTo(0.5) },
      { label: "100%", key: "Ctrl+1", run: () => sceneView.zoomTo(1) },
      { label: "200%", run: () => sceneView.zoomTo(2) },
    ], { x: b.left, y: b.bottom });
  });

  function syncChrome() {
    const gm = cstore.gimmick;
    if (document.activeElement !== nameInput) nameInput.value = gm.name;
    if (document.activeElement !== kindSel) kindSel.value = gm.kind;
    document.title = `${gm.name} - クリエイターモード - LiveDesign Studio`;
    btnUndo.disabled = !canUndo();
    btnRedo.disabled = !canRedo();
  }
  function syncPlay() {
    btnPlay.classList.toggle("active", cstore.play === "playing");
    btnPause.classList.toggle("active", cstore.play === "paused");
    btnPause.disabled = cstore.play !== "playing";
    btnStep.disabled = cstore.play !== "paused";
    btnStop.disabled = cstore.play === "stopped";
    root.classList.toggle("is-playing", cstore.play !== "stopped");
  }
  const syncSave = () => paintSaveState(saveState, cstore.saveState, flushSaveC);
  onC((kind) => {
    if (kind === "gimmick" || kind === "selection") syncChrome();
    if (kind === "play") syncPlay();
    if (kind === "save") syncSave();
    if (kind === "view") zoomLabel.textContent = `${Math.round((Number(cstore.zoom) || 1) * 100)}%`;
  });
  syncChrome();
  syncPlay();
  syncSave();

  // ===============================
  // 本番の配信のイベントも流す（再生中だけ）
  // ===============================
  if (typeof window.connectServer === "function") {
    window.connectServer({
      onRejected() { location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`; return true; },
      onMessage(msg) {
        if (msg.type === "studioEvent" && msg.event && cstore.play !== "stopped") sceneView.liveEvent(msg.event);
      },
    });
  }

  // ===============================
  // キーボード
  // ===============================
  window.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "s") { e.preventDefault(); flushSaveC(); return; }
    if (mod && e.key === "Enter") { e.preventDefault(); cstore.play === "stopped" ? play() : setPlay("stopped"); return; }
    if (isTyping()) return;
    if (mod && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === "y") { e.preventDefault(); redo(); return; }
    if (mod && k === "0") { e.preventDefault(); sceneView.zoomTo("fit"); return; }
    if (mod && k === "1") { e.preventDefault(); sceneView.zoomTo(1); return; }
    const s = cstore.selection;
    if (e.key === "Escape") {
      if (cstore.play !== "stopped") setPlay("stopped");
      else selectC(null);
      return;
    }
    if (s?.type !== "object" || cstore.play !== "stopped") return;
    if (mod && k === "d") {
      e.preventDefault();
      const src = findIn(cstore.gimmick, "object", s.id);
      if (!src) return;
      const copy = { ...clone(src), id: uid("obj"), name: `${src.name} のコピー`, x: (src.x || 0) + 20, y: (src.y || 0) + 20 };
      change((gm) => { gm.objects.push(copy); });
      selectC("object", copy.id);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      change((gm) => { gm.objects = gm.objects.filter((o) => o.id !== s.id); });
      selectC(null);
      return;
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (arrows) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      change((gm) => {
        const o = gm.objects.find((x) => x.id === s.id);
        if (!o) return;
        o.x = (o.x || 0) + arrows[0] * d;
        o.y = (o.y || 0) + arrows[1] * d;
      }, { coalesce: `nudge:${s.id}` });
    }
  });

  // 開発者ツールやブラウザ上の自動テストから覗けるように
  window.__creatorStore = cstore;
  window.__creatorView = sceneView;
}
