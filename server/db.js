// server/db.js
// 利用者・ログイン・デザインを入れるデータベース（Node 標準の SQLite。追加のインストールは要らない）。
//
// 1つのファイル（data/livedesign.db）に全部入る。サーバーに置くときは data/ ごとバックアップする。
// 表を足したり列を変えたりするときは MIGRATIONS の末尾に足す（既にあるものは書き換えない）。
import { DatabaseSync } from "node:sqlite";
import { DB_FILE } from "./config.js";

export const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");

const MIGRATIONS = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     email TEXT UNIQUE,
     password_hash TEXT,
     display_name TEXT NOT NULL,
     avatar_url TEXT NOT NULL DEFAULT '',
     tiktok_username TEXT NOT NULL DEFAULT '',
     overlay_key TEXT NOT NULL UNIQUE,
     api_key TEXT NOT NULL UNIQUE,
     plan TEXT NOT NULL DEFAULT 'free',
     created_at INTEGER NOT NULL
   );
   CREATE TABLE identities (
     provider TEXT NOT NULL,
     provider_user_id TEXT NOT NULL,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     PRIMARY KEY (provider, provider_user_id)
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE scenes (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     data TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX scenes_user ON scenes(user_id);
   CREATE TABLE user_state (
     user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     data TEXT NOT NULL
   );`,
  // クリエイターモードのギミック（ゲーム・エフェクト・サウンド…）
  `CREATE TABLE gimmicks (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     data TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX gimmicks_user ON gimmicks(user_id);`,
];

// どこまで適用したかは user_version に覚えておく
const applied = db.prepare("PRAGMA user_version").get().user_version;
for (let i = applied; i < MIGRATIONS.length; i++) {
  db.exec("BEGIN");
  try {
    db.exec(MIGRATIONS[i]);
    db.exec(`PRAGMA user_version = ${i + 1}`);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const cache = new Map();
/** 同じ SQL は準備し直さない */
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

export const one = (sql, ...params) => stmt(sql).get(...params) ?? null;
export const all = (sql, ...params) => stmt(sql).all(...params);
export const run = (sql, ...params) => stmt(sql).run(...params);

/** まとめて成功するか、まとめて無かったことにする */
export function transaction(fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** 読めるか（/healthz が見る） */
export function isDatabaseHealthy() {
  try {
    return one("SELECT 1 AS ok")?.ok === 1;
  } catch (err) {
    return false;
  }
}

/** 止めるとき。WAL の中身を本体に書き戻してから閉じる（バックアップを data/ ごと取れるように） */
export function closeDatabase() {
  cache.clear();
  try {
    db.close();
  } catch (err) {
    // すでに閉じている
  }
}
