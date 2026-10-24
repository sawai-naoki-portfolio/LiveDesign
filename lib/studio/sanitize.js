// lib/studio/sanitize.js
// ブラウザから届く文書（デザイン・ギミック）を、保存できる形に整える小道具。scene.js と gimmick.js が使う。
//
// 文書は REST で丸ごと届き、ブラウザからは誰でも送れる前提なので、保存する前に形を整える。
// ここで見るのは「壊れていない・大きすぎない・型が合っている」ことだけ。
import crypto from "crypto";

/** 文書（デザイン・ギミック）の ID。URL とデータベースの鍵になるので小文字英数とハイフンだけ */
export const DOCUMENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** 文書の中の部品（要素・ルール・ノード…）の ID */
export const PART_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

// 形だけ整えて通す値の上限
export const STRING_LIMIT = 4000;
const ARRAY_LIMIT = 2000;
const KEYS_LIMIT = 80;
const DEPTH_LIMIT = 6;

// __proto__ などを鍵にされると、後で読む側のオブジェクトの形が変わる。
const SAFE_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

export const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** 数にして範囲に収める。数として読めなければ fallback */
export function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 文字列なら max 文字までに切る。文字列でなければ fallback */
export const str = (v, max, fallback = "") => (typeof v === "string" ? v.slice(0, max) : fallback);

/** 鍵として使ってよい名前か（種類ごとの設定の鍵） */
export const isSafeKey = (k) => SAFE_KEY.test(k);

/**
 * 種類ごとの細かい設定（塗り・文字・ウィジェットの設定…）を、形だけ整えて通す。
 * 値はプリミティブ・配列・オブジェクトのみ、深さと件数に上限を付ける。
 */
export function sanitizeLoose(value, depth = 0) {
  if (depth > DEPTH_LIMIT) return undefined;
  if (typeof value === "string") return value.slice(0, STRING_LIMIT);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.slice(0, ARRAY_LIMIT)
      .map((v) => sanitizeLoose(v, depth + 1))
      .filter((v) => v !== undefined);
  }
  if (isPlainObject(value)) {
    const out = {};
    let count = 0;
    for (const [k, v] of Object.entries(value)) {
      if (!isSafeKey(k) || count >= KEYS_LIMIT) continue;
      const clean = sanitizeLoose(v, depth + 1);
      if (clean === undefined) continue;
      out[k] = clean;
      count++;
    }
    return out;
  }
  return undefined;
}

/** 新しい文書の ID（作った順に並び、ほかの利用者のものと重ならない） */
export function newDocumentId() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(5).toString("hex")}`;
}

/** 部品の ID が壊れている・重なっているときに振り直す ID */
export const freshPartId = (prefix) => `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
