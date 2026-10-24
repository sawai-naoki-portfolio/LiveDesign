// server/net.js
// HTTP と WebSocket の口。**運び屋に徹する**モジュールで、ログインやスタジオの中身は知らない。
//
// 利用者が何人いても、配るのは「その利用者の画面」にだけ。WebSocket の接続ごとに
// 持ち主（userId）を覚え、broadcastTo(userId, …) で送る。誰の接続かを決める関数
// （Cookie のログインか、オーバーレイの合鍵か）は server/auth.js が setClientAuthenticator で渡す。
import path from "path";
import express from "express";
import { WebSocketServer } from "ws";
import { PUBLIC_DIR, HTTP_PORT, HTTP_HOST, PUBLIC_URL, TRUST_PROXY } from "./config.js";

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", TRUST_PROXY);

// 画面（HTML）で動かしてよいもの。スクリプトは自分のファイルだけ（HTML に直接書いたものや
// よそのものは動かさない）。画像・音・動画は素材とアイコン・ギフトの画像（TikTok の CDN）のため
// https を許し、フォントは Google Fonts から読む。
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' https: data: blob:",
  "media-src 'self' https: data: blob:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

// どのページにも付ける守り。オーバーレイ（OBS が開く）以外の画面は、よそのページに
// 埋め込ませない（見えない枠に重ねてボタンを押させる、クリックジャッキングの対策）。
// 素材（/studio-assets）は配る側（server/assets.js）が、もっと狭い CSP を付ける。
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  if (req.path.startsWith("/studio-assets")) return next();
  if (req.path.startsWith("/overlay")) {
    res.setHeader("Content-Security-Policy", PAGE_CSP);
  } else {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", `${PAGE_CSP}; frame-ancestors 'none'`);
  }
  next();
});

// 公開するのは public/ の中だけ。フォルダの境界がそのまま公開範囲になる。
app.use(express.static(PUBLIC_DIR, { index: false }));

/** public/ の HTML を返す */
export function sendPage(res, name) {
  res.sendFile(path.join(PUBLIC_DIR, `${name}.html`));
}

// ===============================
// よそのページからの書き込みを断る
// ===============================
// ブラウザは、別のサイトからでも Cookie 付きでこのサービスへ送信できてしまう（CSRF）。
// Origin が自分のページと一致しない書き込みは断り、本文は JSON に限る
// （text/plain はプリフライト無しで送れるため）。
const PUBLIC_ORIGIN = new URL(PUBLIC_URL).origin;

function isAllowedOrigin(origin, host) {
  if (!origin) return true; // ブラウザ以外（curl・自作ツール）。Cookie を持たないので CSRF にならない
  try {
    const o = new URL(origin);
    return o.origin === PUBLIC_ORIGIN || o.host === host;
  } catch (e) {
    return false;
  }
}

export function sameOriginOnly(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD") return next();
  if (!isAllowedOrigin(req.headers.origin, req.headers.host)) return res.status(403).json({ error: "origin" });
  if (["POST", "PUT", "PATCH"].includes(req.method) && req.headers["content-length"] !== "0" && !req.is("application/json")) {
    return res.status(415).json({ error: "json only" });
  }
  next();
}

// ===============================
// 失敗したとき
// ===============================
const CLIENT_ERRORS = {
  400: "送られた内容の形が正しくありません",
  413: "送られた内容が大きすぎます",
};

// 処理の中で投げた例外（と、壊れた JSON・大きすぎる本文）。中身（スタックトレース）は
// 画面に返さず、サーバーのログにだけ残す。
function handleError(err, req, res, next) {
  const status = Number(err?.status ?? err?.statusCode) || 500;
  if (status >= 500) console.error(`${req.method} ${req.originalUrl} で失敗しました:`, err?.stack || err);
  if (res.headersSent) return next(err);
  res.status(status).json({ error: status >= 500 ? "サーバーで問題が起きました" : CLIENT_ERRORS[status] ?? "リクエストを処理できません" });
}

// ===============================
// WebSocket
// ===============================
// 画面からサーバーへは REST で送るので、WebSocket は配るだけ（受け取ったものは使わない）。
// 届いたものを溜めないよう、1通の大きさは小さく切る。
const WS_MAX_PAYLOAD = 4 * 1024;
// 応答の無い接続（OBS の PC がスリープした・回線が切れた）を見つけて切る間隔。
// 放っておくと「画面を開いている」扱いのまま、TikTok の接続を持ち続けてしまう。
const WS_HEARTBEAT_MS = 30_000;

let httpServer = null;
let wss = null;
let heartbeat = null;
/** @type {Map<string, Set<import("ws").WebSocket>>} 利用者ごとの接続 */
const clientsByUser = new Map();

/** 接続してきたのが誰か。null なら断る */
let authenticate = async () => null;
/** 接続してきた画面に最初に返す state */
let buildState = () => ({ type: "state" });
/** 利用者の画面の数が変わったとき（TikTok の接続を始める・止めるのに使う） */
let presenceListener = () => { };

export function setClientAuthenticator(fn) { authenticate = fn; }
export function onClientConnect(fn) { buildState = fn; }
export function onPresenceChange(fn) { presenceListener = fn; }

export function clientCount(userId) {
  return clientsByUser.get(userId)?.size ?? 0;
}

/** 画面を開いている利用者の一覧（デモのイベントを流す先） */
export function activeUserIds() {
  return [...clientsByUser.keys()];
}

export function broadcastTo(userId, obj) {
  const set = clientsByUser.get(userId);
  if (!set) return;
  const msg = JSON.stringify(obj);
  for (const client of set) if (client.readyState === 1) client.send(msg);
}

/** その利用者の接続を全部切る（ログアウト・アカウント削除・合鍵の作り直し） */
export function closeClientsOf(userId, { role } = {}) {
  for (const client of clientsByUser.get(userId) ?? []) {
    if (!role || client.role === role) client.close(4401, "reauth");
  }
}

// 接続の出入りは、ソケットのイベントの中から呼ばれる。ここで投げた例外は誰も受け止めず
// プロセスごと落ちるので、知らせる先の失敗はログに留める。
function notifyPresence(userId) {
  try {
    presenceListener(userId, clientCount(userId));
  } catch (err) {
    console.error("画面の出入りの処理に失敗しました:", err?.message || err);
  }
}

function track(ws) {
  let set = clientsByUser.get(ws.userId);
  if (!set) {
    set = new Set();
    clientsByUser.set(ws.userId, set);
  }
  set.add(ws);
  notifyPresence(ws.userId);
}

function untrack(ws) {
  const set = clientsByUser.get(ws.userId);
  if (!set?.delete(ws)) return;
  if (set.size === 0) clientsByUser.delete(ws.userId);
  notifyPresence(ws.userId);
}

async function acceptClient(ws, req) {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("error", (err) => console.error("WebSocket エラー:", err.message));

  let who = null;
  try {
    who = await authenticate(req);
  } catch (err) {
    console.error("接続の確認に失敗しました:", err?.message || err);
  }
  if (!who) {
    ws.close(4401, "unauthorized");
    return;
  }
  if (ws.readyState !== 1) return; // 確かめている間に閉じられた
  ws.userId = who.userId;
  ws.role = who.role;
  track(ws);
  ws.on("close", () => untrack(ws));
  try {
    ws.send(JSON.stringify(buildState(who)));
  } catch (err) {
    console.error("state の送信に失敗しました:", err?.message || err);
  }
}

function checkHeartbeats() {
  for (const ws of wss?.clients ?? []) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* 閉じかけている */ }
  }
}

/** サーバーを起動して待ち受けを始める */
export function startServer() {
  // ここまでに登録した道のどれにも当たらなかったもの
  app.use("/api", (req, res) => res.status(404).json({ error: "not found" }));
  app.use(handleError);

  httpServer = app.listen(HTTP_PORT, HTTP_HOST, () => {
    console.log(`🎨 ${PUBLIC_URL}/`);
  });

  wss = new WebSocketServer({
    server: httpServer,
    maxPayload: WS_MAX_PAYLOAD,
    // ブラウザの WebSocket は同一オリジンポリシーの対象外。よそのページからは繋がせない
    verifyClient: ({ req }) => isAllowedOrigin(req.headers.origin, req.headers.host),
  });
  wss.on("connection", acceptClient);
  wss.on("error", (err) => console.error("WebSocket サーバーエラー:", err.message));
  heartbeat = setInterval(checkHeartbeats, WS_HEARTBEAT_MS);
  heartbeat.unref();

  return httpServer;
}

/** 受付をやめて、つながっている画面に「止めます」と伝えて閉じる（止めるとき） */
export function stopServer() {
  clearInterval(heartbeat);
  for (const ws of wss?.clients ?? []) ws.close(1001, "server shutdown");
  if (!httpServer) return Promise.resolve();
  return new Promise((resolve) => {
    httpServer.close(() => resolve());
    httpServer.closeIdleConnections?.();
  });
}
