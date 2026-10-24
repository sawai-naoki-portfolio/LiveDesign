// public/js/studio/overlay.js
// /overlay?id=<シーンID>&k=<合鍵> … OBS のブラウザソース・TikTok LIVE Studio のリンクに貼る画面。
// OBS はログインできないので、URL の合鍵（k）で誰のデザインかを決める。
//
//   ?fit=0   画面に合わせて縮めない（等倍で左上に置く）
//   ?mute=1  音とお読み上げを出さない（同じデザインを2つ貼るときの片方など）
//   ?bg=1    確認用の暗い市松模様を敷く（スタジオの「新しいタブで開く」で付く）
//
// エディタで保存するとサーバーから studioScene が届き、OBS を触らずにその場で描き直す。
// 接続が切れて繋ぎ直したときは、切れている間に保存されたかもしれないので取り直す。
import { createRenderer, createFontLoader } from "./shared/render.js";
import { createLive, createRuntime } from "./shared/runtime.js";
import { putGimmicks } from "./shared/gimmick/registry.js";

const params = new URLSearchParams(location.search);
const sceneId = params.get("id") || "";
const overlayKey = params.get("k") || "";
const fit = params.get("fit") !== "0";
const muted = params.get("mute") === "1";
// 普通のブラウザで開くと白い背景に白い文字が消えて見えるので、確認用に暗い市松模様を敷ける。
// 既定では敷かない。TikTok LIVE Studio のリンクソースは OBS と違って window.obsstudio が無く、
// 「OBS でなければ敷く」にすると配信画面が市松模様で覆われてしまうため。
const previewBg = params.get("bg") === "1";
document.body.classList.toggle("sd-preview-bg", previewBg);

const stage = document.getElementById("stage");
const sceneRoot = document.getElementById("scene");
const particles = document.getElementById("particles");
const message = document.getElementById("message");

const live = createLive();
let scene = null;

const runtime = createRuntime({
  live,
  getRenderer: () => renderer,
  getScene: () => scene,
  getParticleLayer: () => particles,
  getAudio: () => ({ enabled: !muted, volume: 1 }),
});

const renderer = createRenderer(sceneRoot, {
  mode: "overlay",
  getLive: () => live,
  getCtx: () => runtime.globalCtx(),
  playSound: (url, volume) => runtime.playSound(url, volume),
  getAudio: () => ({ enabled: !muted, volume: 1 }),
});

// 開発者ツール・ブラウザ上の自動テストから覗けるように
window.__overlayRenderer = renderer;

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

const ensureFonts = createFontLoader();

function layout() {
  if (!scene) return;
  stage.style.width = `${scene.width}px`;
  stage.style.height = `${scene.height}px`;
  const scale = fit ? Math.min(window.innerWidth / scene.width, window.innerHeight / scene.height) : 1;
  stage.style.transform = scale > 0 && Number.isFinite(scale) && scale !== 1 ? `scale(${scale})` : "";
}

function apply(next) {
  // 置いてあるギミックの中身はシーンに添えて届く（描く前に置き場へ入れる）
  putGimmicks(next.gimmicks || {});
  scene = next;
  document.title = `${scene.name} - LiveDesign`;
  ensureFonts(scene);
  renderer.render(scene);
  layout();
  showMessage("");
}

async function loadScene() {
  try {
    const res = await fetch(`/api/public/scenes/${encodeURIComponent(sceneId)}?k=${encodeURIComponent(overlayKey)}`);
    if (res.status === 404) {
      showMessage("このデザインは見つかりません。削除されたか、URL の合鍵が作り直されています。スタジオから URL をコピーし直してください。");
      return;
    }
    if (!res.ok) throw new Error(String(res.status));
    apply(await res.json());
  } catch (e) {
    showMessage("デザインを読み込めませんでした。サーバーが起動しているか確認してください。");
  }
}

window.addEventListener("resize", layout);

// URL の id と合鍵が欠けているのは、たいてい貼るときに途中で切れたとき
if (!sceneId || !overlayKey) {
  showMessage("URL が途中で切れています。スタジオでデザインの「OBS URL」をコピーし直して、最後まで全部貼ってください。");
} else connectServer({
  query: `k=${encodeURIComponent(overlayKey)}`,
  onRejected() {
    showMessage("この URL では表示できません（合鍵が違うか、作り直されました）。スタジオから URL をコピーし直してください。");
    return true;
  },
  onMessage(msg) {
    if (msg.type === "studioScene" && msg.scene?.id === sceneId) {
      apply(msg.scene);
      return;
    }
    if (msg.type === "studioSceneDeleted" && msg.id === sceneId) {
      showMessage("このデザインは削除されました。");
      return;
    }
    // 接続のたびに state が来る。繋ぎ直しのあいだに保存されたかもしれないので取り直す
    if (msg.type === "state") loadScene();
    runtime.handle(msg);
  },
});
