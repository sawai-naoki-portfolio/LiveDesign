// server/auth.js
// 利用者とログイン。
//
//   ・メールとパスワードで登録・ログイン（パスワードは scrypt で保存）
//   ・Google / TikTok でログイン（.env に鍵があるときだけ出る）
//   ・ログインはサーバーで取り消せるセッション（Cookie は HttpOnly。中身はランダムな合鍵で、
//     データベースにはそのハッシュだけを置く。漏れてもそのままでは使えない）
//   ・オーバーレイの合鍵（OBS はログインできないので、URL に入れた合鍵で誰のデザインかを決める）
//   ・外部ツール用の API キー（Authorization: Bearer）。使えるのは requireUserOrApiKey を付けた口だけで、
//     アカウントの設定（パスワード・合鍵・削除）には使えない（キーが漏れてもアカウントは乗っ取られない）
//
// スタジオや TikTok の接続は知らない。登録・変更・削除は authEvents で知らせる。
import { EventEmitter } from "events";
import express from "express";
import {
  app, sameOriginOnly, sendPage, setClientAuthenticator, closeClientsOf,
} from "./net.js";
import { one, all, run, transaction } from "./db.js";
import {
  PUBLIC_URL, COOKIE_SECURE, SESSION_TTL_MS, REGISTRATION_OPEN,
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_SCOPES,
} from "./config.js";
import {
  hashPassword, verifyPassword, passwordProblem, randomToken, sha256,
} from "../lib/auth/password.js";
import { createRateLimiter } from "../lib/auth/rate-limit.js";
import { parseCookies, serializeCookie } from "../lib/auth/cookies.js";
import { google, tiktok, normalizeTikTokUsername } from "../lib/auth/oauth.js";
import { unrefTimer } from "../lib/timers.js";

/** "registered"(user) / "updated"(user, changed) / "deleted"(userId) */
export const authEvents = new EventEmitter();

const SESSION_COOKIE = "ld_session";
const OAUTH_COOKIE = "ld_oauth";
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const JSON_LIMIT = "16kb";

// ===============================
// Google / TikTok でログイン（鍵が .env にあるものだけ）
// ===============================
const callbackUrl = (name) => `${PUBLIC_URL}/api/auth/${name}/callback`;

/** @type {Record<string, {authorizeUrl: (state: string) => string, exchange: (code: string) => Promise<import("../lib/auth/oauth.js").OAuthProfile>} | null>} */
const providers = {
  google: GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET ? {
    authorizeUrl: (state) => google.authorizeUrl({ clientId: GOOGLE_CLIENT_ID, redirectUri: callbackUrl("google"), state }),
    exchange: (code) => google.exchange({
      code, clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri: callbackUrl("google"),
    }),
  } : null,
  tiktok: TIKTOK_CLIENT_KEY && TIKTOK_CLIENT_SECRET ? {
    authorizeUrl: (state) => tiktok.authorizeUrl({ clientKey: TIKTOK_CLIENT_KEY, redirectUri: callbackUrl("tiktok"), state, scopes: TIKTOK_SCOPES }),
    exchange: (code) => tiktok.exchange({
      code, clientKey: TIKTOK_CLIENT_KEY, clientSecret: TIKTOK_CLIENT_SECRET, redirectUri: callbackUrl("tiktok"), scopes: TIKTOK_SCOPES,
    }),
  } : null,
};

// ===============================
// 利用者
// ===============================
function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    tiktokUsername: row.tiktok_username,
    overlayKey: row.overlay_key,
    apiKey: row.api_key,
    plan: row.plan,
    createdAt: row.created_at,
    hasPassword: !!row.password_hash,
    passwordHash: row.password_hash,
  };
}

export const findUserById = (id) => toUser(one("SELECT * FROM users WHERE id = ?", String(id ?? "")));
export const findUserByOverlayKey = (key) => (key ? toUser(one("SELECT * FROM users WHERE overlay_key = ?", String(key))) : null);
const findUserByApiKey = (key) => (key ? toUser(one("SELECT * FROM users WHERE api_key = ?", String(key))) : null);
const findUserByEmail = (email) => toUser(one("SELECT * FROM users WHERE email = ?", String(email)));
export const userCount = () => one("SELECT COUNT(*) AS n FROM users").n;

/** 本人に返す形（合鍵も含む。本人にしか返さないこと） */
function selfView(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    tiktokUsername: user.tiktokUsername,
    overlayKey: user.overlayKey,
    apiKey: user.apiKey,
    plan: user.plan,
    hasPassword: user.hasPassword,
    identities: all("SELECT provider FROM identities WHERE user_id = ?", user.id).map((r) => r.provider),
  };
}

function newUserId() {
  return `u${randomToken(12)}`;
}

/**
 * @param {{email?: string|null, passwordHash?: string|null, displayName: string, avatarUrl?: string, tiktokUsername?: string, identity?: {provider: string, id: string}}} data
 */
function createUser(data) {
  const id = newUserId();
  transaction(() => {
    run(
      `INSERT INTO users (id, email, password_hash, display_name, avatar_url, tiktok_username, overlay_key, api_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, data.email || null, data.passwordHash || null, String(data.displayName || "配信者").slice(0, 60),
      data.avatarUrl || "", data.tiktokUsername || "", randomToken(24), `ld_${randomToken(24)}`, Date.now(),
    );
    if (data.identity) {
      run("INSERT INTO identities (provider, provider_user_id, user_id) VALUES (?, ?, ?)", data.identity.provider, data.identity.id, id);
    }
  });
  const user = findUserById(id);
  authEvents.emit("registered", user);
  return user;
}

function updateUser(id, fields) {
  const cols = { displayName: "display_name", tiktokUsername: "tiktok_username", passwordHash: "password_hash", overlayKey: "overlay_key", apiKey: "api_key", avatarUrl: "avatar_url" };
  const sets = Object.keys(fields).filter((k) => cols[k]);
  if (!sets.length) return findUserById(id);
  run(`UPDATE users SET ${sets.map((k) => `${cols[k]} = ?`).join(", ")} WHERE id = ?`, ...sets.map((k) => fields[k]), id);
  const user = findUserById(id);
  authEvents.emit("updated", user, sets);
  return user;
}

// ===============================
// セッション
// ===============================
function createSession(userId) {
  const token = randomToken(32);
  const now = Date.now();
  run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", sha256(token), userId, now, now + SESSION_TTL_MS);
  return token;
}

function userFromSessionToken(token) {
  if (!token) return null;
  const row = one("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?", sha256(token));
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    run("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
    return null;
  }
  return findUserById(row.user_id);
}

const sessionCookie = (token) => serializeCookie(SESSION_COOKIE, token, { maxAgeMs: SESSION_TTL_MS, secure: COOKIE_SECURE });
const clearCookie = (name) => serializeCookie(name, "", { maxAgeMs: 0, secure: COOKIE_SECURE });

function startSession(res, userId) {
  res.append("Set-Cookie", sessionCookie(createSession(userId)));
}

const sessionTokenOf = (req) => parseCookies(req.headers.cookie)[SESSION_COOKIE];

/** ログインの Cookie の持ち主。ログインしていなければ null */
const sessionUser = (req) => userFromSessionToken(sessionTokenOf(req));

/** Authorization: Bearer <API キー> の持ち主。キーが無い・違えば null */
function apiKeyUser(req) {
  const auth = String(req.headers.authorization || "");
  return auth.startsWith("Bearer ") ? findUserByApiKey(auth.slice(7).trim()) : null;
}

function guard(findUser) {
  return (req, res, next) => {
    const user = findUser(req);
    if (!user) return res.status(401).json({ error: "ログインが必要です" });
    req.user = user;
    next();
  };
}

/** ログインした本人だけ（Cookie のセッション） */
export const requireUser = guard(sessionUser);

/** 外部ツールの API キーでも通す口（イベントを送る・カウンターを動かす）。キーがあればキーで決める */
export const requireUserOrApiKey = guard((req) => (req.headers.authorization ? apiKeyUser(req) : sessionUser(req)));

// 期限切れのセッションを1時間おきに片付ける
unrefTimer(setInterval(() => {
  try {
    run("DELETE FROM sessions WHERE expires_at < ?", Date.now());
  } catch (err) {
    console.warn("⚠ 期限切れのログインを片付けられませんでした:", err?.message || err);
  }
}, 60 * 60 * 1000));

// ===============================
// 回数制限
// ===============================
const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });   // 同じ IP＋メール
const ipLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 60 });      // 同じ IP
const registerLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10 }); // 同じ IP からの登録

function limited(res, limiter, key) {
  res.setHeader("Retry-After", String(limiter.retryAfter(key)));
  return res.status(429).json({ error: "試す回数が多すぎます。しばらく待ってからもう一度どうぞ" });
}

// 知らないメールでも同じだけ時間をかける（登録済みかどうかを、返事の速さで見分けられないように）
let dummyHash = null;
async function burnTime(password) {
  dummyHash ??= await hashPassword("dummy-password-for-timing");
  await verifyPassword(password, dummyHash);
}

/** ログインのあとに戻る先。よそのサイトへは飛ばさない */
function safeNext(next) {
  const s = String(next ?? "");
  return /^\/(?![/\\])[\w\-./?=&%#~]*$/.test(s) ? s : "/studio";
}

// ===============================
// /api/auth
// ===============================
const authRouter = express.Router();
authRouter.use(sameOriginOnly, express.json({ limit: JSON_LIMIT }));

authRouter.get("/providers", (req, res) => {
  res.json({ google: !!providers.google, tiktok: !!providers.tiktok, registration: REGISTRATION_OPEN });
});

authRouter.get("/me", requireUser, (req, res) => res.json({ user: selfView(req.user) }));

authRouter.post("/register", async (req, res) => {
  if (!REGISTRATION_OPEN) return res.status(403).json({ error: "いまは新規登録を受け付けていません" });
  if (!registerLimiter.hit(req.ip)) return limited(res, registerLimiter, req.ip);
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const displayName = String(req.body?.displayName ?? "").trim() || email.split("@")[0];
  if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: "メールアドレスの形が正しくありません" });
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });
  if (findUserByEmail(email)) return res.status(409).json({ error: "このメールアドレスは登録済みです。ログインしてください" });
  const user = createUser({ email, passwordHash: await hashPassword(password), displayName });
  startSession(res, user.id);
  res.status(201).json({ user: selfView(user) });
});

authRouter.post("/login", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const key = `${req.ip}|${email}`;
  if (!ipLimiter.hit(req.ip)) return limited(res, ipLimiter, req.ip);
  if (!loginLimiter.hit(key)) return limited(res, loginLimiter, key);
  const user = email ? findUserByEmail(email) : null;
  if (!user?.passwordHash) {
    await burnTime(password);
    return res.status(401).json({ error: "メールアドレスかパスワードが違います" });
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: "メールアドレスかパスワードが違います" });
  }
  loginLimiter.reset(key);
  startSession(res, user.id);
  res.json({ user: selfView(user) });
});

authRouter.post("/logout", (req, res) => {
  const token = sessionTokenOf(req);
  if (token) run("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
  res.append("Set-Cookie", clearCookie(SESSION_COOKIE));
  res.json({ ok: true });
});

// ---- Google / TikTok でログイン ----
for (const name of Object.keys(providers)) {
  authRouter.get(`/${name}`, (req, res) => {
    const provider = providers[name];
    if (!provider) return res.status(404).send("このログイン方法は使えません");
    const state = randomToken(18);
    res.append("Set-Cookie", serializeCookie(OAUTH_COOKIE, `${name}|${state}|${safeNext(req.query.next)}`, {
      maxAgeMs: 10 * 60 * 1000, secure: COOKIE_SECURE,
    }));
    res.redirect(provider.authorizeUrl(state));
  });

  authRouter.get(`/${name}/callback`, async (req, res) => {
    const provider = providers[name];
    const [savedName, savedState, next] = String(parseCookies(req.headers.cookie)[OAUTH_COOKIE] ?? "").split("|");
    res.append("Set-Cookie", clearCookie(OAUTH_COOKIE));
    const fail = (why) => res.redirect(`/login?error=${encodeURIComponent(why)}`);
    if (!provider) return fail("このログイン方法は使えません");
    // 自分で始めたログインの戻りか（よそのページから戻り先だけを踏ませる攻撃を防ぐ）
    if (savedName !== name || !savedState || savedState !== req.query.state) return fail("ログインをやり直してください");
    if (req.query.error || !req.query.code) return fail("ログインがキャンセルされました");
    try {
      const profile = await provider.exchange(String(req.query.code));
      const user = loginWithIdentity(name, profile, sessionUser(req));
      startSession(res, user.id);
      res.redirect(safeNext(next));
    } catch (err) {
      console.error(`${name} ログインに失敗しました:`, err?.message || err);
      fail("ログインに失敗しました。もう一度お試しください");
    }
  });
}

/**
 * 外部のアカウントでログインする。初めてなら利用者を作る。ログイン中なら、その人に紐づける。
 * メールが同じでも既存のアカウントには自動で紐づけない（こちらはメールを確認していないので、
 * 他人が先にそのメールで登録していると乗っ取られてしまう）。
 */
export function loginWithIdentity(provider, profile, current) {
  const linked = one("SELECT user_id FROM identities WHERE provider = ? AND provider_user_id = ?", provider, profile.providerUserId);
  if (linked) return findUserById(linked.user_id);
  if (current) {
    run("INSERT INTO identities (provider, provider_user_id, user_id) VALUES (?, ?, ?)", provider, profile.providerUserId, current.id);
    return current;
  }
  if (!REGISTRATION_OPEN) throw new Error("registration closed");
  const tiktokUsername = normalizeTikTokUsername(profile.tiktokUsername) || "";
  return createUser({
    email: profile.email && !findUserByEmail(profile.email) ? profile.email : null,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    tiktokUsername,
    identity: { provider, id: profile.providerUserId },
  });
}

app.use("/api/auth", authRouter);

// ===============================
// /api/account（本人の設定）
// ===============================
const accountRouter = express.Router();
// 本文を読む前に本人か確かめる（ログインしていない人の本文は読まない）
accountRouter.use(sameOriginOnly, requireUser, express.json({ limit: JSON_LIMIT }));

accountRouter.patch("/", (req, res) => {
  const fields = {};
  if (req.body?.displayName !== undefined) {
    const name = String(req.body.displayName).trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: "名前を入れてください" });
    fields.displayName = name;
  }
  if (req.body?.tiktokUsername !== undefined) {
    const username = normalizeTikTokUsername(req.body.tiktokUsername);
    if (username === null) return res.status(400).json({ error: "TikTok の @ID の形が正しくありません（英数字・ピリオド・アンダーバー）" });
    fields.tiktokUsername = username;
  }
  res.json({ user: selfView(updateUser(req.user.id, fields)) });
});

accountRouter.post("/password", async (req, res) => {
  const next = String(req.body?.next ?? "");
  const problem = passwordProblem(next);
  if (problem) return res.status(400).json({ error: problem });
  if (req.user.hasPassword && !(await verifyPassword(String(req.body?.current ?? ""), req.user.passwordHash))) {
    return res.status(401).json({ error: "いまのパスワードが違います" });
  }
  updateUser(req.user.id, { passwordHash: await hashPassword(next) });
  // ほかの端末のログインは切る（パスワードを変えるのは、たいてい漏れたかもしれないとき）
  const keep = sha256(sessionTokenOf(req) || "");
  run("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", req.user.id, keep);
  res.json({ ok: true });
});

accountRouter.post("/keys/:which", (req, res) => {
  if (req.params.which === "overlay") {
    const user = updateUser(req.user.id, { overlayKey: randomToken(24) });
    closeClientsOf(user.id, { role: "overlay" }); // 古い URL の OBS はここで止まる
    return res.json({ user: selfView(user) });
  }
  if (req.params.which === "api") return res.json({ user: selfView(updateUser(req.user.id, { apiKey: `ld_${randomToken(24)}` })) });
  res.status(404).json({ error: "not found" });
});

accountRouter.delete("/", async (req, res) => {
  if (req.user.hasPassword) {
    if (!(await verifyPassword(String(req.body?.password ?? ""), req.user.passwordHash))) {
      return res.status(401).json({ error: "パスワードが違います" });
    }
  } else if (req.body?.confirm !== "DELETE") {
    return res.status(400).json({ error: "確認の文字が違います" });
  }
  run("DELETE FROM users WHERE id = ?", req.user.id); // セッション・デザイン・カウンターも一緒に消える
  closeClientsOf(req.user.id);
  authEvents.emit("deleted", req.user.id);
  res.append("Set-Cookie", clearCookie(SESSION_COOKIE));
  res.json({ ok: true });
});

app.use("/api/account", accountRouter);

// ===============================
// ページ
// ===============================
const loggedIn = (req) => !!sessionUser(req);

app.get("/", (req, res) => (loggedIn(req) ? res.redirect("/studio") : sendPage(res, "index")));
app.get("/login", (req, res) => (loggedIn(req) ? res.redirect(safeNext(req.query.next)) : sendPage(res, "login")));
app.get("/studio", (req, res) => {
  if (!loggedIn(req)) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  sendPage(res, "studio");
});
app.get("/overlay", (req, res) => sendPage(res, "overlay"));

// ===============================
// WebSocket の持ち主
// ===============================
// エディタはログインの Cookie で、OBS のオーバーレイは URL の合鍵（?k=）で決める
setClientAuthenticator(async (req) => {
  const key = new URL(req.url || "/", "http://x").searchParams.get("k");
  if (key) {
    const user = findUserByOverlayKey(key);
    return user ? { userId: user.id, role: "overlay" } : null;
  }
  const user = sessionUser(req);
  return user ? { userId: user.id, role: "editor" } : null;
});
