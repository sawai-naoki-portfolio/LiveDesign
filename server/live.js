// server/live.js
// TikTok LIVE の接続。
//
// TikFinity と同じく、繋ぐ先は利用者が入れた **@ID だけ**で決める。TikTok のパスワードもログインも
// 要らず、誰でも見られる LIVE のコメントやギフトを読むだけなので、自分以外の公開 LIVE でも読める
// （モデレーターが配信者の代わりに操作する、など）。@ID が本人のものかは確かめない。
//
// 繋ぐのは「@ID を設定していて、その人の画面（スタジオか OBS のオーバーレイ）が開いているあいだ」だけ。
// 同じ @ID を入れた人が何人いても、TikTok への接続は **@ID ごとに1本**にまとめて、届いたイベントを
// 全員のスタジオに配る（人数分つなぐと、運営の Euler API キーの上限をすぐ使い切る）。
// 配信がまだ始まっていなければ、間隔を広げながら待って繋ぎ直す（配信を始めれば数十秒で勝手に繋がる）。
//
// 受けたイベントは studioIngest(userId, …) でその人のスタジオに渡す。
import express from "express";
import { app, broadcastTo, clientCount, sameOriginOnly } from "./net.js";
import { studioIngest, resetStudioSession } from "./studio.js";
import { findUserById, authEvents, requireUser } from "./auth.js";
import { DEMO_MODE, MAX_LIVE_CONNECTIONS, EULER_API_KEY } from "./config.js";
import { createConnection } from "../lib/tiktok.js";
import {
  getGiftName, getGiftCoin, getGiftPictureUrl, isStreakInProgress,
} from "../lib/live-events.js";
import { unrefTimer } from "../lib/timers.js";

const timings = {
  // 配信が始まるのを待つ間隔（だんだん広げる）
  retryStepsMs: [10_000, 20_000, 40_000, 80_000, 160_000],
  retryMaxMs: 180_000,
  // 配信の途中で切れたときは、すぐに繋ぎ直す
  reconnectAfterDropMs: 5_000,
  // 同時に繋ぐ数の上限に当たっているときに、空きを見に行く間隔
  busyRetryMs: 60_000,
  // 画面を閉じてから抜けるまで（OBS のシーン切り替えのたびに繋ぎ直しにならないように）
  stopGraceMs: 60_000,
};

/** テストから待ち時間を縮める */
export function setLiveTimings(t) {
  Object.assign(timings, t);
}

let factory = (username) => createConnection(username, { apiKey: EULER_API_KEY, enableExtendedGiftInfo: false });

/** テストから偽の接続を差し込む */
export function setConnectionFactory(fn) {
  factory = fn;
}

/**
 * @ID ひとつ分の接続。読んでいる人（subscribers）が居なくなったら切る。
 * @typedef {object} Room
 * @property {string} key       小文字にした @ID（TikTok の @ID は大文字小文字を区別しない）
 * @property {string} username  接続に使う @ID
 * @property {Set<string>} subscribers  読んでいる利用者
 * @property {"connecting"|"connected"|"waiting"|"busy"} state
 * @property {string} error
 * @property {number} attempts
 * @property {any} connection
 * @property {any} retryTimer
 * @property {string|null} lastRoomId
 * @property {number} nextRetryAt
 * @property {boolean} stopped
 */
/** @type {Map<string, Room>} 小文字の @ID → 接続 */
const rooms = new Map();
/** @type {Map<string, Room>} 利用者 → 読んでいる接続 */
const memberOf = new Map();
/** @type {Map<string, any>} 画面を閉じた人が抜けるまでのタイマー */
const leaveTimers = new Map();

const keyOf = (username) => String(username || "").toLowerCase();

const liveConnectionCount = () => [...rooms.values()].filter((r) => r.state === "connected").length;

/** 画面に出す接続の様子 */
export function connectionStatus(userId) {
  const user = findUserById(userId);
  if (DEMO_MODE) return { state: "demo", username: user?.tiktokUsername ?? "" };
  if (!user?.tiktokUsername) return { state: "unset", username: "" };
  const room = memberOf.get(userId);
  if (!room) return { state: "idle", username: user.tiktokUsername };
  return { state: room.state, username: user.tiktokUsername, error: room.error, nextRetryAt: room.nextRetryAt || 0 };
}

function emitStatus(userId) {
  broadcastTo(userId, { type: "connectionStatus", ...connectionStatus(userId) });
}

function emitRoom(room) {
  for (const userId of room.subscribers) emitStatus(userId);
}

/** 画面の数や @ID が変わったら呼ぶ。読むべきなら @ID の接続に加わり、要らなくなったら少し待って抜ける */
export function syncUser(userId) {
  if (DEMO_MODE) return;
  const user = findUserById(userId);
  const username = user?.tiktokUsername || "";
  let room = memberOf.get(userId);
  if (room && room.key !== keyOf(username)) {
    // @ID を変えた・消した・アカウントを消した
    leave(userId);
    room = null;
  }
  const want = !!username && clientCount(userId) > 0;
  if (want) {
    clearTimeout(leaveTimers.get(userId));
    leaveTimers.delete(userId);
    if (!room) join(userId, username);
  } else if (room && !leaveTimers.has(userId)) {
    leaveTimers.set(userId, unrefTimer(setTimeout(() => {
      leave(userId);
      emitStatus(userId);
    }, timings.stopGraceMs)));
  }
  emitStatus(userId);
}

/** 「今すぐ繋ぐ」ボタン（待っている間隔を飛ばす） */
function retryNow(userId) {
  const room = memberOf.get(userId);
  if (!room || room.state === "connected" || room.state === "connecting") return false;
  clearTimeout(room.retryTimer);
  attempt(room);
  return true;
}

function join(userId, username) {
  const key = keyOf(username);
  let room = rooms.get(key);
  const created = !room;
  if (created) {
    room = {
      key, username, subscribers: new Set(), state: "connecting", error: "", attempts: 0, connection: null,
      retryTimer: null, lastRoomId: null, nextRetryAt: 0, stopped: false,
    };
    rooms.set(key, room);
  }
  room.subscribers.add(userId);
  memberOf.set(userId, room);
  if (created) attempt(room);
}

function leave(userId) {
  clearTimeout(leaveTimers.get(userId));
  leaveTimers.delete(userId);
  const room = memberOf.get(userId);
  if (!room) return;
  memberOf.delete(userId);
  room.subscribers.delete(userId);
  if (room.subscribers.size === 0) stopRoom(room);
}

function stopRoom(room) {
  room.stopped = true;
  clearTimeout(room.retryTimer);
  dropConnection(room);
  if (rooms.get(room.key) === room) rooms.delete(room.key);
}

function dropConnection(room) {
  const connection = room.connection;
  room.connection = null;
  if (!connection) return;
  try { connection.removeAllListeners?.(); } catch (e) { /* 片付けの失敗は気にしない */ }
  connection.on?.("error", () => { }); // 切る途中のエラーで落ちないように
  try { connection.disconnect?.(); } catch (e) { /* 既に切れている */ }
}

function scheduleRetry(room, delay) {
  if (room.stopped) return;
  clearTimeout(room.retryTimer);
  room.nextRetryAt = Date.now() + delay;
  room.retryTimer = unrefTimer(setTimeout(() => attempt(room), delay));
}

/** 配信が始まっていないだけなら「待っています」、それ以外はエラーとして見せる */
function describeError(err) {
  const msg = String(err?.message || err || "");
  if (/offline|isn't online|not online|not live|ended|room id|roomid/i.test(msg)) return "";
  if (/not found|doesn't exist|does not exist|user_not_found/i.test(msg)) {
    return "この @ID のアカウントが見つかりません（表示名ではなく、プロフィールの @ のあとの文字か確かめてください）";
  }
  if (/rate|limit|429/i.test(msg)) return "接続が混み合っています。少し待ってから繋ぎ直します";
  return `接続できませんでした（${msg.slice(0, 120)}）`;
}

async function attempt(room) {
  if (room.stopped) return;
  const busy = liveConnectionCount() >= MAX_LIVE_CONNECTIONS;
  if (busy) {
    room.state = "busy";
    room.error = "接続が混み合っています。空きができしだい繋ぎます";
    scheduleRetry(room, timings.busyRetryMs);
    emitRoom(room);
    return;
  }
  room.state = "connecting";
  room.error = "";
  emitRoom(room);

  dropConnection(room);
  let connection;
  try {
    connection = factory(room.username);
  } catch (err) {
    return failed(room, err);
  }
  room.connection = connection;
  registerHandlers(connection, room);
  try {
    await connection.connect();
  } catch (err) {
    if (room.connection !== connection) return; // その間に止めた・繋ぎ直した
    dropConnection(room);
    failed(room, err);
  }
}

function failed(room, err) {
  if (room.stopped) return;
  room.attempts++;
  room.state = "waiting";
  room.error = describeError(err);
  scheduleRetry(room, timings.retryStepsMs[room.attempts - 1] ?? timings.retryMaxMs);
  emitRoom(room);
}

// ===============================
// 配信の切り替わり
// ===============================
// 「今回の配信」の数字とランキングは、次の配信へ繋ぎ直すと前回のものが残ってしまう。
// 接続のたびに消すと回線が一瞬切れただけで消えるので、**配信（roomId）が変わったときだけ**、
// その @ID を読んでいる全員の分を消す。
function handleRoomChange(room, roomId) {
  if (roomId === undefined || roomId === null || roomId === "") return false;
  const id = String(roomId);
  const changed = room.lastRoomId !== null && room.lastRoomId !== id;
  room.lastRoomId = id;
  if (changed) for (const userId of room.subscribers) resetStudioSession(userId);
  return changed;
}

// EventEmitter のリスナーで投げた例外は誰も捕まえないので、1件の失敗でプロセスごと落ちる
function guard(label, fn) {
  return (data) => {
    try {
      fn(data);
    } catch (err) {
      console.error(`${label}の処理に失敗しました:`, err?.message || err);
    }
  };
}

/**
 * 接続にイベントの受け口を付ける。届いたものは、その @ID を読んでいる全員に配る。
 * @param {import("events").EventEmitter} connection
 * @param {Room} room
 */
function registerHandlers(connection, room) {
  // 止めた・繋ぎ直したあとに古い接続から届いたものは捨てる
  const current = () => !room.stopped && room.connection === connection;
  const ingest = (type, user, data) => {
    if (!current()) return;
    for (const userId of room.subscribers) studioIngest(userId, type, user, data);
  };

  connection.on("connected", (state) => {
    if (!current()) return;
    room.state = "connected";
    room.attempts = 0;
    room.error = "";
    handleRoomChange(room, state?.roomId);
    emitRoom(room);
  });

  connection.on("disconnected", () => {
    if (!current()) return;
    room.state = "waiting";
    room.attempts = 0;
    dropConnection(room);
    scheduleRetry(room, timings.reconnectAfterDropMs);
    emitRoom(room);
  });

  // リスナーが無いと EventEmitter が例外を投げてプロセスごと落ちる。
  // 繋ぐ途中の失敗（配信していない）は待っている人の数だけ毎回起きるので、ログには残さない。
  // 残すのは繋がったあとのエラーだけで、1行にする（ライブラリはスタックごと渡してくる）
  connection.on("error", (err) => {
    if (current() && room.state === "connected") {
      console.error(`TikTok 接続エラー（@${room.username}）: ${String(err?.info || err?.message || err).slice(0, 200)}`);
    }
  });

  connection.on("chat", guard("コメント", (data) => {
    const text = data?.comment || data?.content;
    if (text && data?.user) ingest("chat", data.user, { text });
  }));

  connection.on("member", guard("入室", (data) => {
    if (data?.user) ingest("join", data.user);
  }));

  connection.on("gift", guard("ギフト", (data) => {
    // 連打ギフトは連打中も何度も届く。途中で数えると額が二重に積み上がる
    if (isStreakInProgress(data)) return;
    ingest("gift", data?.user, {
      gift: { name: getGiftName(data), pictureUrl: getGiftPictureUrl(data), coin: getGiftCoin(data), count: data?.repeatCount || 1 },
    });
  }));

  connection.on("follow", guard("フォロー", (data) => {
    if (data?.user) ingest("follow", data.user);
  }));

  connection.on("share", guard("シェア", (data) => {
    if (data?.user) ingest("share", data.user);
  }));

  // いいねはタップの塊ごとに来る。塊の数と配信の累計の両方を渡す
  connection.on("like", guard("いいね", (data) => {
    ingest("like", data?.user, { likes: data?.count ?? data?.likeCount, totalLikes: data?.total ?? data?.totalLikeCount });
  }));

  // 宝箱（エンベロープ）。user ではなく envelopeInfo に人物情報が入る
  connection.on("envelope", guard("宝箱", (data) => {
    const info = data?.envelopeInfo;
    if (!info) return;
    ingest("envelope", {
      userId: info.sendUserId, nickName: info.sendUserName, profilePictureUrl: info.sendUserAvatar?.urlList?.[0] || "",
    }, { coins: Number(info.diamondCount) || 0 });
  }));
}

// @ID を変えた・アカウントを消したら、繋ぎ直す・切る
authEvents.on("updated", (user, changed) => { if (changed.includes("tiktokUsername")) syncUser(user.id); });
authEvents.on("deleted", (userId) => syncUser(userId));

// ===============================
// /api/live（接続の様子と「今すぐ繋ぐ」）
// ===============================
const router = express.Router();
router.use(sameOriginOnly, requireUser);
router.get("/status", (req, res) => res.json(connectionStatus(req.user.id)));
router.post("/retry", (req, res) => res.json({ ok: retryNow(req.user.id), ...connectionStatus(req.user.id) }));
app.use("/api/live", router);
