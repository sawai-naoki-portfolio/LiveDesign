// public/js/studio/editor/assets.js
// アップロードした素材（画像・音・動画）の一覧。素材パネル・プロパティ・ルールの欄で共有する。
import { api } from "./api.js";

let assets = [];
const listeners = new Set();

export const getAssets = (kind) => (kind ? assets.filter((a) => a.kind === kind || (kind === "visual" && a.kind !== "audio")) : assets);

export function onAssets(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function refreshAssets() {
  try {
    assets = await api.listAssets();
  } catch (e) {
    assets = [];
  }
  listeners.forEach((fn) => fn(assets));
  return assets;
}

/** 素材を送って一覧を更新する。送れたものを返す */
export async function uploadFiles(files) {
  const done = [];
  for (const file of files) {
    try {
      done.push(await api.uploadAsset(file));
    } catch (e) {
      done.push({ error: e.message, name: file.name });
    }
  }
  await refreshAssets();
  return done;
}

/** 画像の本来の大きさ（置くときの大きさを決める） */
export function imageSize(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 400, h: img.naturalHeight || 400 });
    img.onerror = () => resolve({ w: 400, h: 400 });
    img.src = url;
  });
}
