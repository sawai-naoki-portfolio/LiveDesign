// server/assets.js
// 利用者がアップロードした素材（画像・音・動画）。data/assets/<利用者ID>/ に置き、/studio-assets/ で配る。
//
//   ・REST（一覧・アップロード・削除）は assetsRouter。server/studio.js が /api/studio/assets に、
//     ログインの確認のあとで付ける（本文が大きいので、本文の上限はここで決める）
//   ・配るのは /studio-assets/ だけ（data/ のほかの物は配らない）
//   ・アカウントを消したら、その人のフォルダごと消す
import fs from "fs/promises";
import { existsSync, mkdirSync, readdirSync, renameSync } from "fs";
import path from "path";
import crypto from "crypto";
import express from "express";
import { app } from "./net.js";
import { ASSETS_DIR, STORAGE_QUOTA_BYTES } from "./config.js";
import { authEvents } from "./auth.js";

const MAX_ASSET_BYTES = 25 * 1024 * 1024;
// data URL（base64）は元の大きさの約 4/3 になる
const UPLOAD_JSON_LIMIT = `${Math.ceil((MAX_ASSET_BYTES * 1.4) / 1024 / 1024)}mb`;
const USER_ID_RE = /^u[A-Za-z0-9_-]{8,40}$/;

// 素材として受け付ける形式。SVG は中にスクリプトを書けるので受けない
// （同じオリジンから配ると、そのままこのサービスの権限で動いてしまう）。
const ASSET_TYPES = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "image/avif": "avif", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav",
  "audio/x-wav": "wav", "audio/wave": "wav", "audio/ogg": "ogg", "video/webm": "webm",
  "video/mp4": "mp4",
};
const ASSET_KIND_BY_EXT = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", avif: "image",
  mp3: "audio", wav: "audio", ogg: "audio", webm: "video", mp4: "video",
};

function assetsDirOf(userId) {
  if (!USER_ID_RE.test(userId)) throw new Error("bad user id");
  return path.join(ASSETS_DIR, userId);
}

const assetUrl = (userId, file) => `/studio-assets/${userId}/${encodeURIComponent(file)}`;

/** 素材のファイル名。日本語のファイル名はそのまま活かす（素材一覧で見分けるため） */
function assetFileName(name, ext) {
  const base = String(name ?? "asset").replace(/\.[^.]*$/, "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "asset";
  return `${base}-${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}.${ext}`;
}

async function listAssets(userId) {
  const dir = assetsDirOf(userId);
  let files = [];
  try { files = await fs.readdir(dir); } catch (e) { return []; }
  const assets = await Promise.all(files.map(async (name) => {
    const kind = ASSET_KIND_BY_EXT[name.split(".").pop().toLowerCase()];
    if (!kind) return null;
    try {
      const stat = await fs.stat(path.join(dir, name));
      return { name, kind, size: stat.size, updatedAt: stat.mtimeMs, url: assetUrl(userId, name) };
    } catch (e) {
      return null; // 一覧を作っている間に消された
    }
  }));
  return assets.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}

const totalSize = (assets) => assets.reduce((sum, a) => sum + a.size, 0);

/** 届いた素材の名前が、その人の素材フォルダ直下にあるファイルを指しているか。指していればその場所 */
function resolveAssetName(userId, name) {
  const base = path.basename(String(name ?? ""));
  if (!base || base !== name || base.startsWith(".")) return null;
  return path.join(assetsDirOf(userId), base);
}

/** data URL（data:image/png;base64,…）を読む。受け付けない形式なら null */
function decodeDataUrl(dataUrl) {
  const s = String(dataUrl ?? "");
  const comma = s.indexOf(",");
  const m = /^data:([\w/+.-]+);base64$/.exec(s.slice(0, comma));
  const ext = m && ASSET_TYPES[m[1].toLowerCase()];
  return ext ? { ext, buf: Buffer.from(s.slice(comma + 1), "base64") } : null;
}

// ===============================
// REST（ログインした本人のもの。ログインの確認は付ける側が済ませる）
// ===============================
export const assetsRouter = express.Router();
assetsRouter.use(express.json({ limit: UPLOAD_JSON_LIMIT }));

assetsRouter.get("/", async (req, res) => {
  const assets = await listAssets(req.user.id);
  res.setHeader("X-Storage-Used", String(totalSize(assets)));
  res.setHeader("X-Storage-Quota", String(STORAGE_QUOTA_BYTES));
  res.json(assets);
});

assetsRouter.post("/", async (req, res) => {
  const file = decodeDataUrl(req.body?.data);
  if (!file) return res.status(415).json({ error: "対応していない形式です（PNG/JPEG/GIF/WebP/AVIF/MP3/WAV/OGG/WebM/MP4）" });
  const { ext, buf } = file;
  if (buf.length === 0) return res.status(400).json({ error: "empty" });
  if (buf.length > MAX_ASSET_BYTES) return res.status(413).json({ error: "ファイルが大きすぎます（25MBまで）" });
  if (totalSize(await listAssets(req.user.id)) + buf.length > STORAGE_QUOTA_BYTES) {
    return res.status(413).json({ error: `素材の容量（${Math.round(STORAGE_QUOTA_BYTES / 1024 / 1024)}MB）を超えます。使っていない素材を消してください` });
  }

  const name = assetFileName(req.body?.name, ext);
  const dir = assetsDirOf(req.user.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), buf);
  res.status(201).json({ name, kind: ASSET_KIND_BY_EXT[ext], size: buf.length, url: assetUrl(req.user.id, name) });
});

assetsRouter.delete("/:name", async (req, res) => {
  const full = resolveAssetName(req.user.id, req.params.name);
  try {
    if (!full) throw new Error("bad name");
    await fs.unlink(full);
  } catch (e) {
    return res.status(404).json({ error: "not found" });
  }
  res.json({ ok: true });
});

// ===============================
// 配る（OBS がログインせずに読むので、URL を知っていれば読める）
// ===============================
app.use("/studio-assets", express.static(ASSETS_DIR, {
  dotfiles: "deny",
  setHeaders(res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'");
  },
}));

// ===============================
// アカウント
// ===============================
authEvents.on("deleted", (userId) => {
  fs.rm(assetsDirOf(userId), { recursive: true, force: true })
    .catch((err) => console.warn("⚠ 素材のフォルダを消せませんでした:", err?.message || err));
});

/** 1人用だった頃の素材フォルダの中身を、その人の素材フォルダへ移す（一度きりなので、終わるまで待つ） */
export function adoptLegacyAssets(userId, fromDir) {
  if (!existsSync(fromDir)) return;
  const dest = assetsDirOf(userId);
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(fromDir)) renameSync(path.join(fromDir, name), path.join(dest, name));
}
