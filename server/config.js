// server/config.js
// 起動時に一度だけ決まる設定。**定数だけ**を置く場所で、他のモジュールに依存しない。
// 値は環境変数（.env）から読む。一覧と説明は .env.example にある。
// process.env を読むのはこのファイルだけ（どこで何を設定しているかを1か所で見られるように）。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const env = (name, fallback = "") => (process.env[name] ?? fallback).trim();
const int = (name, fallback) => {
  const n = Number.parseInt(env(name), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// TikTok に繋がず、画面を開いている利用者それぞれにダミーのイベントを流す（開発・見本用）
export const DEMO_MODE = env("DEMO_MODE") === "true";

// ===============================
// 場所
// ===============================
// 基準はこのファイルの場所。process.cwd() だと別のフォルダから起動したときに見失う。
export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLIC_DIR = path.join(ROOT, "public"); // ブラウザに配るもの（この中だけが公開範囲）

// 実行時に読み書きするもの。DATA_DIR を指定すると保存先ごと移せる（テストが一時フォルダへ逃がすのに使う）。
// サーバーに置くときは、ここをバックアップする。
export const DATA_DIR = env("DATA_DIR") || path.join(ROOT, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const DB_FILE = env("DB_FILE") || path.join(DATA_DIR, "livedesign.db");
// 利用者がアップロードした素材（data/assets/<利用者ID>/）
export const ASSETS_DIR = path.join(DATA_DIR, "assets");
// 1人用だった頃の保存先。最初に登録した人がそのまま引き継ぐ
export const LEGACY_STUDIO_DIR = path.join(DATA_DIR, "studio");

// ===============================
// ネットワーク
// ===============================
export const HTTP_PORT = int("PORT", 3000);
// 既定ではこの PC からだけ繋がる。サーバーに置くとき（Docker など）は HOST=0.0.0.0 にする。
export const HTTP_HOST = env("HOST") || "127.0.0.1";

// 外から見たこのサービスの URL（例：https://livedesign.example.com）。
// ログインの戻り先（OAuth）と、よそのページからの書き込みを断る判定に使う。
// 空なら http://localhost:<PORT> とみなす（手元で動かすとき）。
export const PUBLIC_URL = (env("PUBLIC_URL") || `http://localhost:${HTTP_PORT}`).replace(/\/+$/, "");

// リバースプロキシ（Caddy・nginx・Cloudflare など）の後ろに置くとき true。
// 利用者の IP（ログインの回数制限）を X-Forwarded-For から読む
export const TRUST_PROXY = env("TRUST_PROXY") === "true";

// ===============================
// ログイン
// ===============================
// https で公開しているときは Cookie に Secure を付ける（http で付けるとブラウザが捨てる）
export const COOKIE_SECURE = env("COOKIE_SECURE") ? env("COOKIE_SECURE") === "true" : PUBLIC_URL.startsWith("https://");
export const SESSION_TTL_MS = int("SESSION_DAYS", 30) * 24 * 60 * 60 * 1000;
// closed にすると新規登録を止める（招待制にしたいとき・荒らしが来たとき）
export const REGISTRATION_OPEN = env("REGISTRATION") !== "closed";

// Google でログイン（https://console.cloud.google.com/apis/credentials）
export const GOOGLE_CLIENT_ID = env("GOOGLE_CLIENT_ID");
export const GOOGLE_CLIENT_SECRET = env("GOOGLE_CLIENT_SECRET");
// TikTok でログイン（https://developers.tiktok.com/ の Login Kit。EULER_API_KEY とは別物）
export const TIKTOK_CLIENT_KEY = env("TIKTOK_CLIENT_KEY");
export const TIKTOK_CLIENT_SECRET = env("TIKTOK_CLIENT_SECRET");
// user.info.profile の権限があれば足す（ログインした人の @ID を自動で入れられる）
export const TIKTOK_SCOPES = env("TIKTOK_SCOPES") || "user.info.basic";

// ===============================
// TikTok LIVE
// ===============================
// イベントを受けるための署名キー（https://www.eulerstream.com/）。利用者ごとではなく、サービス全体で1つ
export const EULER_API_KEY = env("EULER_API_KEY");

// ===============================
// 利用者ごとの上限
// ===============================
// 誰でも登録できるサービスなので、1人がサーバーを使い切れないようにする
export const MAX_SCENES_PER_USER = int("MAX_SCENES_PER_USER", 50);
// クリエイターモードのギミックの数
export const MAX_GIMMICKS_PER_USER = int("MAX_GIMMICKS_PER_USER", 50);
export const STORAGE_QUOTA_BYTES = int("STORAGE_QUOTA_MB", 500) * 1024 * 1024;
// 同時に保つ TikTok LIVE の接続の数（同じ @ID は1本。運営の Euler API キーの上限に合わせる）
export const MAX_LIVE_CONNECTIONS = int("MAX_LIVE_CONNECTIONS", 300);

// ===============================
// 起動時の確認
// ===============================
const isLoopback = (host) => ["127.0.0.1", "::1", "localhost"].includes(host);

/** 設定の見落とし（起動のときにログへ出す） */
export function configWarnings() {
  const out = [];
  if (!DEMO_MODE && !EULER_API_KEY) {
    out.push("EULER_API_KEY が空です。TikTok LIVE への接続がすぐに回数制限にかかります（.env.example を参照）");
  }
  if (!isLoopback(HTTP_HOST) && !COOKIE_SECURE) {
    out.push("外から繋がる設定ですが、ログインの Cookie に Secure が付いていません（PUBLIC_URL を https にしてください）");
  }
  return out;
}
