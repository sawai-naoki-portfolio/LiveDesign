// lib/auth/password.js
// パスワードの保存と照合。Node 標準の scrypt を使う（追加のインストール不要）。
// 保存する形：scrypt$N$r$p$塩(base64)$ハッシュ(base64)
// 形に強さ（N・r・p）を書いておくので、あとで強くしても古いパスワードを照合できる。
import crypto from "crypto";
import { promisify } from "util";

const scrypt = promisify(crypto.scrypt);
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(String(password), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** 登録できるパスワードか。駄目なら理由を返す */
export function passwordProblem(password) {
  const s = String(password ?? "");
  if (s.length < PASSWORD_MIN) return `パスワードは${PASSWORD_MIN}文字以上にしてください`;
  if (s.length > PASSWORD_MAX) return `パスワードは${PASSWORD_MAX}文字以内にしてください`;
  return null;
}

/** 推測されない合鍵（URL に入れても困らない文字だけ） */
export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}
