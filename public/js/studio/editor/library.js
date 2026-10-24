// public/js/studio/editor/library.js
// 左の「素材」（テキスト・図形・フレーム・配信ウィジェット・ギミック）と「アップロード」パネル。
// 素材はクリックでキャンバスの中央に、ドラッグで落とした場所に置ける（Canva と同じ）。
import { store } from "./state.js";
import { addElement } from "./ops.js";
import { api } from "./api.js";
import { getAssets, onAssets, refreshAssets, uploadFiles, imageSize } from "./assets.js";
import { h, toast, modal, copyText } from "./ui.js";
import { LIBRARY } from "./templates.js";
import { SAMPLE_VALUES } from "./constants.js";
import { createRenderer } from "../shared/render.js";
import { createElement, scaleAbout, isVideoUrl } from "../shared/model.js";
import { createLive } from "../shared/runtime.js";
import { onGimmick } from "../shared/gimmick/registry.js";
import { gimmickList, gimmickThumb, placeGimmick, openInCreator } from "./gimmicks.js";
import { GIMMICK_KIND_LABELS } from "../shared/gimmick/defaults.js";

const previewLive = createLive();

/** 大きすぎる部品はシーンに収まるよう縮める */
function fitToScene(el) {
  const s = store.scene;
  if (!s) return el;
  const f = Math.min(1, (s.width * 0.9) / el.w, (s.height * 0.9) / el.h);
  if (f < 1) {
    const ox = el.x;
    const oy = el.y;
    scaleAbout(el, ox, oy, f, f);
  }
  return el;
}

export function placeLibraryItem(catIndex, itemIndex, at) {
  const item = LIBRARY[catIndex]?.items[itemIndex];
  if (!item) return;
  const el = fitToScene(item.make());
  addElement(el, at ? { at } : { center: true });
}

/** 素材（アップロードした画像・動画）を置く */
export async function placeAsset(url, at) {
  const size = isVideoUrl(url) ? { w: 640, h: 360 } : await imageSize(url);
  const s = store.scene;
  const f = Math.min(1, (s.width * 0.6) / size.w, (s.height * 0.6) / size.h);
  const el = createElement("image", {
    name: decodeURIComponent(url.split("/").pop()).replace(/-[a-z0-9]+\.\w+$/, ""),
    src: url, w: Math.round(size.w * f), h: Math.round(size.h * f), fit: "contain",
  });
  addElement(el, at ? { at } : { center: true });
}

function thumb(item) {
  const el = item.make();
  const box = h("div", { class: "lib-thumb" });
  const inner = h("div", { class: "lib-thumb-scene" });
  box.appendChild(inner);
  const scene = { width: el.w, height: el.h, background: "transparent", elements: [{ ...el, x: 0, y: 0 }] };
  const r = createRenderer(inner, { mode: "thumb", getLive: () => previewLive, getCtx: () => SAMPLE_VALUES });
  r.render(scene);
  // タイルの大きさに合わせて縮める
  requestAnimationFrame(() => {
    const W = box.clientWidth || 96;
    const H = box.clientHeight || 72;
    const s = Math.min(W / el.w, H / el.h) * 0.9;
    inner.style.transform = `translate(${(W - el.w * s) / 2}px, ${(H - el.h * s) / 2}px) scale(${s})`;
  });
  return box;
}

/** クリエイターモードで作ったギミック。作り直されたら並べ直す */
function gimmickSection() {
  const grid = h("div", { class: "lib-grid widgets" });
  const sec = h("section", { class: "lib-sec lib-gimmicks" },
    h("h3", {}, "🛠 ギミック（クリエイターモード）"), grid,
    h("button", { type: "button", class: "small-btn block", onclick: () => openInCreator() }, "＋ クリエイターモードで作る ↗"));
  function render() {
    grid.textContent = "";
    const list = gimmickList();
    if (!list.length) {
      grid.appendChild(h("p", { class: "hint" }, "ゲーム・エフェクト・サウンドなどのギミックは、クリエイターモードで作るとここに並びます。"));
      return;
    }
    for (const g of list) {
      const label = `${(GIMMICK_KIND_LABELS[g.kind] || "").split(" ")[0]} ${g.name}`;
      const tile = h("button", {
        type: "button", class: "lib-tile", draggable: "true", title: g.description || g.name,
        dataset: { label: `${g.name} ギミック ${GIMMICK_KIND_LABELS[g.kind] || ""}` },
        onclick: () => placeGimmick(g.id),
      }, h("div", { class: "lib-thumb" }, gimmickThumb(g, 0, 0)), h("span", { class: "lib-label" }, label));
      tile.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/x-studio-gimmick", g.id));
      grid.appendChild(tile);
    }
  }
  render();
  let timer = null;
  onGimmick(() => { clearTimeout(timer); timer = setTimeout(render, 300); });
  return sec;
}

export function initLibrary(panel) {
  panel.textContent = "";
  const search = h("input", { type: "search", class: "lib-search", placeholder: "素材を探す（例：ハート、タイマー、ギミック）" });
  panel.appendChild(search);
  const sections = [gimmickSection()];
  panel.appendChild(sections[0]);
  LIBRARY.forEach((cat, ci) => {
    const grid = h("div", { class: `lib-grid${cat.widgets ? " widgets" : ""}` });
    cat.items.forEach((item, ii) => {
      const tile = h("button", {
        type: "button", class: "lib-tile", draggable: "true", title: item.label,
        dataset: { label: item.label },
        onclick: () => placeLibraryItem(ci, ii),
      }, thumb(item), h("span", { class: "lib-label" }, item.label));
      tile.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/x-studio-lib", `${ci}:${ii}`));
      grid.appendChild(tile);
    });
    const sec = h("section", { class: "lib-sec" }, h("h3", {}, cat.title), grid);
    sections.push(sec);
    panel.appendChild(sec);
  });
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    for (const sec of sections) {
      let any = false;
      for (const tile of sec.querySelectorAll(".lib-tile")) {
        const hit = !q || tile.dataset.label.toLowerCase().includes(q) || sec.querySelector("h3").textContent.includes(q);
        tile.hidden = !hit;
        any = any || hit;
      }
      sec.hidden = !any;
    }
  });
}

const fmtSize = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`);

export function initUploads(panel) {
  const input = h("input", { type: "file", multiple: true, accept: "image/*,audio/*,video/webm,video/mp4", hidden: true });
  const drop = h("div", { class: "upload-drop" },
    h("strong", {}, "ここにファイルを落とす"),
    h("span", {}, "画像（PNG/JPEG/GIF/WebP）・効果音（MP3/WAV/OGG）・動画（WebM/MP4）"),
    h("button", { type: "button", class: "btn primary", onclick: () => input.click() }, "ファイルを選ぶ"));
  const grid = h("div", { class: "asset-grid" });
  panel.append(drop, input, grid);

  async function upload(files) {
    if (!files.length) return;
    drop.classList.add("busy");
    const res = await uploadFiles(files);
    drop.classList.remove("busy");
    const bad = res.filter((r) => r.error);
    if (bad.length) toast(`${bad[0].name}: ${bad[0].error}`, "error");
    else toast(`${res.length} 件を追加しました`);
  }
  input.addEventListener("change", () => { upload([...input.files]); input.value = ""; });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    drop.classList.remove("over");
    upload([...e.dataTransfer.files]);
  });

  let playing = null;
  function render() {
    grid.textContent = "";
    const list = getAssets();
    if (!list.length) grid.appendChild(h("p", { class: "hint pad" }, "まだ素材がありません"));
    for (const a of list) {
      let preview;
      if (a.kind === "image") preview = h("img", { src: a.url, alt: "", loading: "lazy" });
      else if (a.kind === "video") preview = h("video", { src: a.url, muted: true, loop: true, autoplay: true, playsinline: true });
      else {
        preview = h("button", {
          type: "button", class: "asset-audio",
          onclick: (e) => {
            e.stopPropagation();
            if (playing) { playing.pause(); playing = null; return; }
            playing = new Audio(a.url);
            playing.play().catch(() => { });
            playing.addEventListener("ended", () => { playing = null; });
          },
        }, "▶");
      }
      const card = h("div", { class: `asset-card ${a.kind}`, draggable: a.kind !== "audio" ? "true" : null, title: a.name },
        preview,
        h("span", { class: "asset-name" }, a.name),
        h("span", { class: "asset-size" }, fmtSize(a.size)),
        h("button", {
          type: "button", class: "asset-del", title: "削除",
          onclick: async (e) => {
            e.stopPropagation();
            const ok = await modal("素材を削除", h("p", {}, `「${a.name}」を削除します。この素材を使っているデザインからは見えなくなります。`), { okText: "削除" });
            if (!ok) return;
            try { await api.deleteAsset(a.name); } catch (err) { toast(err.message, "error"); }
            refreshAssets();
          },
        }, "×"));
      if (a.kind !== "audio") {
        card.addEventListener("click", () => placeAsset(a.url));
        card.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/x-studio-asset", a.url));
      } else {
        card.addEventListener("click", () => copyText(a.url, "音の URL をコピーしました（ルールの「音を鳴らす」で選べます）"));
      }
      grid.appendChild(card);
    }
  }
  onAssets(render);
  render();
  return { upload };
}
