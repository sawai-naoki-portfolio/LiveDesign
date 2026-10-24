// server/workspace.js
// 利用者ごとの作業場（デザイン・カウンターとタイマー・ルールの判定・今回の配信の数字）。
//
// 作業場は、その人が画面を開いたり REST を呼んだりしたときにデータベースから読み、
// しばらく誰も見ていなければ書き出してメモリから外す（登録者が増えても、使っている人の分だけ持つ）。
// ほかの利用者の作業場には触れない。配るのも broadcastTo(userId) でその人の画面だけ。
import { one, all, run } from "./db.js";
import { broadcastTo, clientCount } from "./net.js";
import { sanitizeScene } from "../lib/studio/scene.js";
import { sanitizeGimmick } from "../lib/studio/gimmick.js";
import { createRuleEngine } from "../lib/studio/rules.js";
import { createStudioVars } from "../lib/studio/variables.js";
import { unrefTimer } from "../lib/timers.js";

const IDLE_MS = 10 * 60 * 1000;    // 誰も見ていない作業場をメモリから外すまで
const VARS_SAVE_MS = 5000;         // カウンターの書き出しをまとめる間隔
const TOP_LIMIT = 20;

/**
 * 利用者ごとに保存する文書。どちらも「id・持ち主・中身（JSON）・更新時刻」の同じ形の表に入る。
 * 表の名前は SQL に入れるので、ここに書いた決まった値だけを使う（外から来た値は使わない）。
 *   scenes   … アーティストモードのデザイン
 *   gimmicks … クリエイターモードのギミック
 */
const DOCUMENT_KINDS = {
  scenes: { table: "scenes", sanitize: sanitizeScene },
  gimmicks: { table: "gimmicks", sanitize: sanitizeGimmick },
};

/** @type {Map<string, ReturnType<typeof load>>} */
const workspaces = new Map();

function loadDocuments(userId, { table, sanitize }) {
  const docs = new Map();
  for (const row of all(`SELECT id, data, updated_at FROM ${table} WHERE user_id = ?`, userId)) {
    try {
      const doc = sanitize(JSON.parse(row.data), row.id);
      doc.updatedAt = row.updated_at;
      docs.set(row.id, doc);
    } catch (e) {
      console.warn(`⚠ ${table} を読めませんでした: ${row.id}`, e.message);
    }
  }
  return docs;
}

function load(userId) {
  const vars = createStudioVars();
  const state = one("SELECT data FROM user_state WHERE user_id = ?", userId);
  if (state) {
    try { vars.restore(JSON.parse(state.data)); } catch (e) { /* 壊れていれば空から */ }
  }
  return {
    userId,
    scenes: loadDocuments(userId, DOCUMENT_KINDS.scenes),
    gimmicks: loadDocuments(userId, DOCUMENT_KINDS.gimmicks),
    vars,
    engine: createRuleEngine(),
    recentChats: [],
    recentEvents: [],
    /** 今回の配信のギフト額ランキング */
    supporters: new Map(),
    varsTimer: null,
    saveTimer: null,
    varsDirty: false,
    lastActive: Date.now(),
    eventSeq: 0,
  };
}

/** その人の作業場（無ければ読む） */
export function getWorkspace(userId) {
  let w = workspaces.get(userId);
  if (!w) {
    w = load(userId);
    workspaces.set(userId, w);
  }
  w.lastActive = Date.now();
  return w;
}

// ===============================
// 文書（デザイン・ギミック）の保存
// ===============================
/**
 * 届いた中身を整えて保存する。整えた文書を返す。
 * @param {object} w 作業場
 * @param {"scenes"|"gimmicks"} kind
 * @param {unknown} raw ブラウザから届いた中身（信用しない）
 * @param {string} id 保存先の ID（本文の id は使わない）
 */
export function saveDocument(w, kind, raw, id) {
  const { table, sanitize } = DOCUMENT_KINDS[kind];
  const doc = sanitize(raw, id);
  // ほかの人の ID だったときは書き換えない（changes が 0 になる）
  const { changes } = run(
    `INSERT INTO ${table} (id, user_id, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
     WHERE ${table}.user_id = excluded.user_id`,
    doc.id, w.userId, JSON.stringify(doc), doc.updatedAt,
  );
  if (changes === 0) throw new Error(`${table} の ID が重なりました: ${doc.id}`);
  w[kind].set(doc.id, doc);
  return doc;
}

export function deleteDocument(w, kind, id) {
  run(`DELETE FROM ${DOCUMENT_KINDS[kind].table} WHERE id = ? AND user_id = ?`, id, w.userId);
  w[kind].delete(id);
}

// ===============================
// カウンターとタイマー
// ===============================
/** 変わったカウンターとタイマーを書き出す。書けなければ false（変わった印は残し、次にまた試す） */
function saveVars(w) {
  clearTimeout(w.saveTimer);
  w.saveTimer = null;
  if (!w.varsDirty) return true;
  try {
    run(
      "INSERT INTO user_state (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data",
      w.userId, JSON.stringify(w.vars.serialize()),
    );
    w.varsDirty = false;
    return true;
  } catch (err) {
    console.warn("⚠ カウンターを保存できませんでした:", err?.message || err);
    return false;
  }
}

/** カウンターやタイマーが変わった。少し待ってまとめて書き出す */
export function markVarsDirty(w) {
  w.varsDirty = true;
  if (w.saveTimer) return;
  w.saveTimer = unrefTimer(setTimeout(() => saveVars(w), VARS_SAVE_MS));
}

function topSupporters(w) {
  return [...w.supporters.values()]
    .sort((a, b) => b.coins - a.coins)
    .slice(0, TOP_LIMIT)
    .map(({ name, avatar, coins }) => ({ name, avatar, coins }));
}

export function varsPayload(w) {
  return { ...w.vars.snapshot(), top: topSupporters(w) };
}

// いいねは数秒ごとに塊で来るので、そのたびに配ると重い。少しだけまとめる
export function scheduleVarsBroadcast(w) {
  if (w.varsTimer) return;
  w.varsTimer = unrefTimer(setTimeout(() => flushVars(w), 150));
}

export function flushVars(w) {
  clearTimeout(w.varsTimer);
  w.varsTimer = null;
  broadcastTo(w.userId, { type: "studioVars", vars: varsPayload(w) });
}

// ===============================
// 片付け
// ===============================
/** 書き出していないカウンターを全部書く（終了時） */
export function flushAllWorkspaces() {
  for (const w of workspaces.values()) saveVars(w);
}

/** アカウントを消したとき（書き出さずに捨てる。データベースからは既に消えている） */
export function dropWorkspace(userId) {
  const w = workspaces.get(userId);
  if (!w) return;
  clearTimeout(w.saveTimer);
  clearTimeout(w.varsTimer);
  workspaces.delete(userId);
}

// 誰も見ていない作業場を書き出してメモリから外す。書き出せなかったものは次の回にまた試す
unrefTimer(setInterval(() => {
  const now = Date.now();
  for (const w of [...workspaces.values()]) {
    if (clientCount(w.userId) > 0 || now - w.lastActive < IDLE_MS) continue;
    if (!saveVars(w)) continue;
    clearTimeout(w.varsTimer);
    workspaces.delete(w.userId);
  }
}, 60 * 1000));
