// public/js/studio/studio.js
// /studio … スタジオの入口。モードが2つある：
//   🎨 アーティストモード … 配信画面をデザインして、イベントで動かす（editor/）
//   🛠 クリエイターモード … アーティストモードで使うギミック（ゲーム・エフェクト・サウンド）を作る（creator/）
//
//   /studio                 一覧とテンプレート（editor/home.js。?mode=creator でクリエイターモード側）
//   /studio?id=<id>         そのデザインを編集する（アーティストモード）
//   /studio?gimmick=<id>    そのギミックを編集する（クリエイターモード。creator/creator.js）
//
// 画面の部品はそれぞれのファイルにある：
//   editor/canvas.js     キャンバスと道具        editor/inspector.js  プロパティ（デザイン）
//   editor/layers.js     レイヤー                editor/rules.js      イベント → アクション
//   editor/library.js    素材・アップロード      editor/testpanel.js  イベントを流して試す
//   editor/state.js      状態・履歴・自動保存    editor/ops.js        整列・グループなどの操作
import {
  store, on, emit, change, select, selected, setTool, undo, redo, canUndo, canRedo, flushSave, resetHistory,
} from "./editor/state.js";
import * as ops from "./editor/ops.js";
import { api } from "./editor/api.js";
import { initCanvas } from "./editor/canvas.js";
import { initInspector } from "./editor/inspector.js";
import { initLayers } from "./editor/layers.js";
import { initLibrary, initUploads, placeLibraryItem, placeAsset } from "./editor/library.js";
import { initRules } from "./editor/rules.js";
import { initTestPanel } from "./editor/testpanel.js";
import { refreshAssets, uploadFiles } from "./editor/assets.js";
import { showHome } from "./editor/home.js";
import { loadGimmicks, placeGimmick } from "./editor/gimmicks.js";
import { loadMe, overlayUrl, setConnection } from "./editor/me.js";
import {
  h, icon, toast, openContextMenu, isTyping, copyText, setCustomVarNames, bindTabs,
} from "./editor/ui.js";
import { paintSaveState } from "./editor/document.js";
import { createFontLoader } from "./shared/render.js";
import { createLive, createRuntime } from "./shared/runtime.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const sceneId = params.get("id");
const gimmickId = params.get("gimmick");

const TOOLS = [
  ["select", "select", "選択", "V"],
  ["hand", "hand", "手のひら（スペースを押しながらでも）", "H"],
  ["text", "text", "テキスト", "T"],
  ["rect", "rect", "四角形（Shift で正方形）", "R"],
  ["ellipse", "ellipse", "円（Shift で正円）", "O"],
  ["polygon", "polygon", "三角形", "Y"],
  ["star", "star", "星", "S"],
  ["line", "line", "直線（Shift で 45° 刻み）", "L"],
  ["pen", "pen", "ペン（クリックで角・ドラッグで曲線・始点で閉じる）", "P"],
  ["pencil", "pencil", "鉛筆（手書き）", "B"],
];
const TOOL_KEYS = Object.fromEntries(TOOLS.map(([id, , , key]) => [key.toLowerCase(), id]));

const TOOL_HINTS = {
  select: "クリックで選択・Shift で追加・ドラッグで範囲選択・Alt+ドラッグで複製・ダブルクリックで文字やパスを編集",
  hand: "ドラッグで表示を動かす。Ctrl+ホイールで拡大縮小",
  text: "クリックした所に文字を置く（ドラッグで枠の大きさを決める）",
  rect: "ドラッグで描く。Shift で正方形、Alt で中心から",
  ellipse: "ドラッグで描く。Shift で正円、Alt で中心から",
  polygon: "ドラッグで描く。角の数はプロパティで変えられます",
  star: "ドラッグで描く。へこみ具合はプロパティで変えられます",
  line: "ドラッグで線を引く。Shift で 45° 刻み",
  pen: "クリックで角の点、ドラッグでなめらかな点。始点をクリックで閉じる／Enter・ダブルクリックで終了／Backspace で1つ戻す",
  pencil: "ドラッグで自由に描く（なめらかに整えます）",
};

// ===============================
// ライブ（サーバーから届く値）
// ===============================
const live = createLive();
// 開発者ツールから状態を覗けるように（ブラウザ上の自動テストもこれを見る。画面の部品どうしはこれを使わない）
window.__studioLive = live;
window.__studioStore = store;
const status = { server: false, connection: null };
let canvas = null;

const runtime = createRuntime({
  live,
  getRenderer: () => canvas?.renderer,
  getScene: () => store.scene,
  getParticleLayer: () => $("particles"),
  getAudio: () => ({ enabled: store.sound, volume: 1 }),
});

// 文字の「{ } 差し込み値」の一覧に、自分で作ったカウンターとタイマーも出す
setCustomVarNames(() => [...Object.keys(live.vars.counters || {}), ...Object.keys(live.vars.timers || {})]);

// ===============================
// 起動
// ===============================
// ログインが切れた（ほかの端末でパスワードを変えた・アカウントを消した）
function backToLogin() {
  location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  return true;
}

/**
 * ホーム（デザインを開いていない画面）も、開いている間は TikTok LIVE に繋いでおく
 * （TikFinity のダッシュボードと同じ）。接続の様子もここで受け取る。
 */
function watchConnection() {
  connectServer({
    onRejected: backToLogin,
    onMessage(msg) {
      if (msg.type === "state") setConnection(msg.connection);
      if (msg.type === "connectionStatus") setConnection(msg);
    },
  });
}

async function main() {
  await loadMe(); // ログインが切れていればログイン画面へ（api.js）
  if (gimmickId) {
    const { startCreator } = await import("./creator/creator.js");
    await startCreator($("creator"), gimmickId);
    return;
  }
  if (!sceneId) {
    showHome($("home"));
    watchConnection();
    return;
  }
  let scene;
  try {
    scene = await api.getScene(sceneId);
  } catch (e) {
    toast("デザインが見つかりませんでした", "error");
    showHome($("home"));
    return;
  }
  // 古いシーンにも新しい項目があるように、ルートの形だけ揃える
  scene.elements = scene.elements || [];
  scene.rules = scene.rules || [];
  // 置いてあるギミック枠が中身を引けるよう、描く前に読んでおく
  await loadGimmicks();
  store.scene = scene;
  resetHistory();
  $("app").hidden = false;
  document.title = `${scene.name} - LiveDesign Studio`;

  buildTopbar();
  buildToolrail();
  buildTabs();

  canvas = initCanvas({
    viewport: $("viewport"), world: $("world"), artboard: $("artboard"), ui: $("ui"),
    getLive: () => live,
    getCtx: () => runtime.globalCtx(),
    playSound: (url, v) => runtime.playSound(url, v),
    getAudio: () => ({ enabled: store.sound, volume: 1 }),
    onContextMenu: showContextMenu,
    onDrop: handleDrop,
  });
  window.__studioCanvas = canvas;

  initLibrary($("tab-library"));
  initUploads($("tab-uploads"));
  initLayers($("tab-layers"));
  initInspector($("tab-design"), { canvas, getLive: () => live });
  initRules($("tab-rules"));
  const test = initTestPanel($("tab-test"), { getLive: () => live, getStatus: () => status });
  refreshAssets();

  on((kind) => {
    if (kind === "scene") {
      syncSceneChrome();
      test.render();
    }
    if (kind === "save") showSaveState();
    if (kind === "tool") syncTools();
    if (kind === "view") $("zoomLabel").textContent = `${Math.round(store.zoom * 100)}%`;
    if (kind === "scene" || kind === "selection") syncUndo();
  });

  connectServer({
    onRejected: backToLogin,
    onMessage(msg) {
      status.server = true;
      if (msg.type === "state") status.connection = msg.connection;
      if (msg.type === "connectionStatus") status.connection = msg;
      // 自分の保存が返ってきたもの・別のシーンのものは無視する
      if (msg.type === "studioScene" || msg.type === "studioSceneDeleted") return;
      if (msg.type === "studioAction" && !store.livePreview) return;
      runtime.handle(msg);
      if (["state", "studioVars", "connectionStatus"].includes(msg.type)) test.render();
    },
    onDisconnect() {
      status.server = false;
      test.render();
    },
  });

  emit("scene");
  emit("tool");
  emit("selection");
  requestAnimationFrame(() => canvas.fit());
  showSaveState();
}

// ===============================
// 上のバー
// ===============================
function buildTopbar() {
  const name = $("sceneName");
  name.value = store.scene.name;
  name.addEventListener("change", () => change((s) => { s.name = name.value.trim() || "無題のデザイン"; }));
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") name.blur(); });

  $("btnHome").addEventListener("click", async () => { await flushSave(); location.href = "/studio"; });
  $("btnUndo").append(icon("undo"));
  $("btnRedo").append(icon("redo"));
  $("btnUndo").addEventListener("click", undo);
  $("btnRedo").addEventListener("click", redo);
  $("zoomIn").addEventListener("click", () => canvas.zoomAt(store.zoom * 1.25));
  $("zoomOut").addEventListener("click", () => canvas.zoomAt(store.zoom / 1.25));
  $("zoomLabel").addEventListener("click", (e) => {
    const b = e.currentTarget.getBoundingClientRect();
    openContextMenu([
      { label: "画面に合わせる", key: "Ctrl+0", run: () => canvas.fit() },
      { label: "25%", run: () => canvas.zoomAt(0.25) },
      { label: "50%", run: () => canvas.zoomAt(0.5) },
      { label: "100%", key: "Ctrl+1", run: () => canvas.zoomAt(1) },
      { label: "200%", run: () => canvas.zoomAt(2) },
    ], { x: b.left, y: b.bottom });
  });
  const snap = $("snapToggle");
  snap.checked = store.snap;
  snap.addEventListener("change", () => { store.snap = snap.checked; });
  $("btnCopyUrl").addEventListener("click", () => {
    copyText(overlayUrl(store.scene.id), `OBS 用 URL をコピーしました（${store.scene.width}×${store.scene.height} で貼ってください）`);
  });
  $("btnPreview").addEventListener("click", async () => {
    await flushSave();
    window.open(overlayUrl(store.scene.id), "_blank");
  });
}

function syncSceneChrome() {
  const name = $("sceneName");
  if (document.activeElement !== name) name.value = store.scene.name;
  document.title = `${store.scene.name} - LiveDesign Studio`;
  const p = $("particles");
  p.style.width = `${store.scene.width}px`;
  p.style.height = `${store.scene.height}px`;
  $("artboard").classList.toggle("checker", store.scene.background === "transparent");
  ensureFonts(store.scene);
}

const ensureFonts = createFontLoader();

const showSaveState = () => paintSaveState($("saveState"), store.saveState, flushSave);

function syncUndo() {
  $("btnUndo").disabled = !canUndo();
  $("btnRedo").disabled = !canRedo();
}

// ===============================
// 道具のバー
// ===============================
function buildToolrail() {
  const rail = $("toolrail");
  for (const [id, ico, label, key] of TOOLS) {
    rail.appendChild(h("button", {
      type: "button", class: "tool", dataset: { tool: id }, title: `${label}（${key}）`,
      onclick: () => setTool(id),
    }, icon(ico, 20)));
  }
}

function syncTools() {
  for (const b of document.querySelectorAll(".tool")) b.classList.toggle("active", b.dataset.tool === store.tool);
  $("hintbar").textContent = TOOL_HINTS[store.tool] || "";
}

// ===============================
// タブ
// ===============================
function buildTabs() {
  for (const bar of document.querySelectorAll("[data-tabs]")) {
    const names = [...bar.querySelectorAll("button[data-tab]")].map((b) => b.dataset.tab);
    bindTabs(bar, Object.fromEntries(names.map((name) => [name, $(`tab-${name}`)])), `ld-tab-${bar.dataset.tabs}`);
  }
}

// ===============================
// 右クリック
// ===============================
function showContextMenu(e, hitId) {
  const has = store.selection.length > 0;
  const els = selected();
  const single = els.length === 1 ? els[0] : null;
  openContextMenu([
    has ? { label: "複製", key: "Ctrl+D", run: () => ops.duplicateSelection() } : null,
    has ? { label: "コピー", key: "Ctrl+C", run: () => ops.copySelection() } : null,
    { label: "貼り付け", key: "Ctrl+V", run: () => ops.paste() },
    has ? { label: "削除", key: "Delete", run: () => ops.deleteSelection() } : null,
    has ? "-" : null,
    has ? { label: "最前面へ", key: "Ctrl+Shift+]", run: () => ops.arrange("front") } : null,
    has ? { label: "前面へ", key: "Ctrl+]", run: () => ops.arrange("forward") } : null,
    has ? { label: "背面へ", key: "Ctrl+[", run: () => ops.arrange("backward") } : null,
    has ? { label: "最背面へ", key: "Ctrl+Shift+[", run: () => ops.arrange("back") } : null,
    has ? "-" : null,
    els.length > 1 ? { label: "グループ化", key: "Ctrl+G", run: () => ops.groupSelection() } : null,
    els.some((x) => x.type === "group") ? { label: "グループ解除", key: "Ctrl+Shift+G", run: () => ops.ungroupSelection() } : null,
    single?.type === "path" ? { label: "点を編集", key: "Enter", run: () => canvas.enterNodeEdit(single.id) } : null,
    single?.type === "text" ? { label: "文字を編集", key: "Enter", run: () => canvas.startTextEdit(single.id) } : null,
    has ? { label: "キャンバスの中央へ", run: () => { ops.align("center"); ops.align("middle"); } } : null,
    has ? { label: els[0].locked ? "ロック解除" : "ロック", key: "Ctrl+Shift+L", run: () => ops.toggleFlag("locked") } : null,
    has ? { label: "非表示", key: "Ctrl+Shift+H", run: () => ops.toggleFlag("visible") } : null,
    !has ? { label: "すべて選択", key: "Ctrl+A", run: () => ops.selectAll() } : null,
  ].filter((x, i, arr) => x && !(x === "-" && arr[i - 1] === "-")), { x: e.clientX, y: e.clientY });
  void hitId;
}

// ===============================
// ドロップ・貼り付け
// ===============================
async function addFiles(files, at) {
  if (!files.length) return;
  toast("アップロード中…");
  const res = await uploadFiles(files);
  for (const r of res) {
    if (r.error) toast(`${r.name}: ${r.error}`, "error");
    else if (r.kind === "image" || r.kind === "video") await placeAsset(r.url, at);
    else toast(`「${r.name}」を素材に追加しました（ルールの効果音で選べます）`);
  }
}

function handleDrop(dt, at) {
  const files = [...(dt?.files || [])];
  if (files.length) { addFiles(files, at); return; }
  const lib = dt?.getData("text/x-studio-lib");
  if (lib) {
    const [ci, ii] = lib.split(":").map(Number);
    placeLibraryItem(ci, ii, at);
    return;
  }
  const asset = dt?.getData("text/x-studio-asset");
  if (asset) { placeAsset(asset, at); return; }
  const gimmick = dt?.getData("text/x-studio-gimmick");
  if (gimmick) placeGimmick(gimmick, at);
}

document.addEventListener("paste", (e) => {
  if (!store.scene || isTyping()) return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
  if (files.length) {
    e.preventDefault();
    addFiles(files, canvas.viewCenter());
  }
});

// ===============================
// キーボード
// ===============================
window.addEventListener("keydown", (e) => {
  if (!store.scene || !canvas) return;
  if (isTyping()) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); flushSave(); }
    return;
  }
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();

  if (mod) {
    const handled = {
      z: () => (e.shiftKey ? redo() : undo()),
      y: () => redo(),
      c: () => ops.copySelection(),
      x: () => ops.cutSelection(),
      d: () => ops.duplicateSelection(),
      g: () => (e.shiftKey ? ops.ungroupSelection() : ops.groupSelection()),
      a: () => ops.selectAll(),
      s: () => flushSave(),
      "]": () => ops.arrange(e.shiftKey ? "front" : "forward"),
      "[": () => ops.arrange(e.shiftKey ? "back" : "backward"),
      "}": () => ops.arrange("front"),
      "{": () => ops.arrange("back"),
      0: () => canvas.fit(),
      1: () => canvas.zoomAt(1),
      "=": () => canvas.zoomAt(store.zoom * 1.25),
      "+": () => canvas.zoomAt(store.zoom * 1.25),
      "-": () => canvas.zoomAt(store.zoom / 1.25),
      h: () => e.shiftKey && ops.toggleFlag("visible"),
      l: () => e.shiftKey && ops.toggleFlag("locked"),
    }[k];
    if (k === "v") return; // 貼り付けは paste イベント（画像）と下の処理の両方で見る
    if (handled) { e.preventDefault(); handled(); }
    return;
  }

  switch (e.key) {
    case "Delete":
    case "Backspace":
      e.preventDefault();
      if (canvas.deleteSelectedNode()) return;
      if (canvas.isDrawing) { canvas.undoPenPoint(); return; }
      ops.deleteSelection();
      return;
    case "Escape":
      if (canvas.finishDrawing(false)) return;
      if (store.nodeEdit) { canvas.exitNodeEdit(); return; }
      if (store.enteredGroup) {
        const g = store.enteredGroup;
        store.enteredGroup = null;
        select(g);
        return;
      }
      if (store.tool !== "select") { setTool("select"); return; }
      select([]);
      return;
    case "Enter": {
      if (canvas.finishDrawing(false)) return;
      const els = selected();
      if (els.length !== 1) return;
      e.preventDefault();
      if (els[0].type === "path") canvas.enterNodeEdit(els[0].id);
      else if (els[0].type === "text") canvas.startTextEdit(els[0].id);
      else if (els[0].type === "group") { store.enteredGroup = els[0].id; select(els[0].children[0]?.id ?? []); }
      return;
    }
    case "ArrowLeft": case "ArrowRight": case "ArrowUp": case "ArrowDown": {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      ops.nudge(e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0, e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0);
      return;
    }
    default:
      break;
  }
  if (TOOL_KEYS[k] && !e.altKey) setTool(TOOL_KEYS[k]);
});

// Ctrl+V：画像が無ければ、要素のコピーを貼る
window.addEventListener("keydown", (e) => {
  if (!store.scene || isTyping()) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
    setTimeout(() => {
      // paste イベントで画像を処理していなければ要素を貼る
      if (!pastedImage) ops.paste();
      pastedImage = false;
    }, 0);
  }
});
let pastedImage = false;
document.addEventListener("paste", (e) => {
  if ([...(e.clipboardData?.files || [])].some((f) => f.type.startsWith("image/"))) pastedImage = true;
}, true);

main();
