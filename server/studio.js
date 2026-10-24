// server/studio.js
// スタジオのサーバー側（利用者ごと）。
//
//   ・デザインとギミックの保存・配布（REST: /api/studio/... はログインした本人のものだけ）
//   ・素材の REST は server/assets.js（ここではログインの確認のあとに付けるだけ）
//   ・オーバーレイ（OBS）向けの読み出し（/api/public/... は URL の合鍵で本人を決める）
//   ・配信のイベントを受けて、その人のルール（イベント → アクション）を判定して、その人の画面に配る
//
// イベントの入口は studioIngest(userId, …) の1本だけで、live.js（本番）と demo.js（デモ）が
// 同じものを呼ぶ。ここで例外が出ても TikTok の受信を止めないよう、入口で必ず受け止める。
import fs from "fs";
import path from "path";
import express from "express";
import { app, broadcastTo, sameOriginOnly } from "./net.js";
import { run, transaction } from "./db.js";
import { LEGACY_STUDIO_DIR, MAX_SCENES_PER_USER, MAX_GIMMICKS_PER_USER } from "./config.js";
import {
  requireUser, requireUserOrApiKey, findUserByOverlayKey, authEvents, userCount,
} from "./auth.js";
import {
  getWorkspace, saveDocument, deleteDocument, markVarsDirty, varsPayload, scheduleVarsBroadcast, flushVars,
  dropWorkspace,
} from "./workspace.js";
import { assetsRouter, adoptLegacyAssets } from "./assets.js";
import { sanitizeScene, EVENT_TYPES } from "../lib/studio/scene.js";
import { gimmickSummary, referencedGimmickIds } from "../lib/studio/gimmick.js";
import { DOCUMENT_ID_PATTERN, newDocumentId } from "../lib/studio/sanitize.js";
import { actionAmount, sampleEventFor } from "../lib/studio/rules.js";
import { isValidVarName } from "../lib/studio/variables.js";
import { getUserName, getUserKey, getUserAvatar } from "../lib/live-events.js";

const RECENT_CHATS = 60;
const RECENT_EVENTS = 40;
// デザインとギミックの本文の上限。検査で縮める前の大きさなので、上限いっぱいの文書より余裕を持たせる
const DOCUMENT_JSON_LIMIT = "8mb";
// 外部ツール（API キー）からも使える口。ほかはログインした本人だけ（キーでデザインを消したりはできない）
const API_KEY_PATHS = new Set(["/event", "/vars"]);

/** 接続してきた画面に渡すぶん（index.js の state に載る） */
export function getStudioSnapshot(userId) {
  const w = getWorkspace(userId);
  return {
    vars: varsPayload(w),
    recentChats: w.recentChats.slice(-RECENT_CHATS),
    recentEvents: w.recentEvents.slice(-RECENT_EVENTS),
  };
}

/** 新しい配信になったとき（server/live.js が配信の切り替わりで呼ぶ） */
export function resetStudioSession(userId) {
  const w = getWorkspace(userId);
  w.vars.resetStats();
  w.supporters.clear();
  w.recentChats.length = 0;
  w.recentEvents.length = 0;
  w.engine.reset();
  flushVars(w);
}

// ===============================
// イベント
// ===============================
const httpUrlOrEmpty = (url) => (/^https?:\/\//.test(url) ? url : "");

/** ライブイベントの user（tiktok-live-connector の形）を揃える。画面に出すのは表示名とアイコンだけ */
function normalizeUser(user) {
  return {
    id: getUserKey(user) || "",
    name: String(getUserName(user)).slice(0, 80),
    handle: String(user?.uniqueId || "").slice(0, 80),
    avatar: httpUrlOrEmpty(String(getUserAvatar(user))),
  };
}

/** 画面に配る形（視聴者の id は配らない。1人ごとのクールダウンはサーバーで済ませる） */
function publicEvent(event) {
  const { user, ...rest } = event;
  return { ...rest, user: { name: user.name, handle: user.handle, avatar: user.avatar } };
}

function pushRecent(list, item, limit) {
  list.push(item);
  if (list.length > limit) list.splice(0, list.length - limit);
}

/** カウンター・タイマーはサーバーで済ませ、画面側のもの（アラート・揺らす・音…）だけを配る */
function runRule(w, sceneId, rule, event, extra = {}) {
  const times = Number(extra.times) || 1;
  let varsChanged = false;
  const visual = [];

  for (const action of rule.actions) {
    if (action.kind !== "counter" && action.kind !== "timer") {
      visual.push(action);
      continue;
    }
    // 「固定」の量は、いいねの N 件ごとを跨いだ回数ぶん掛ける（× コインなどはイベントの値がすでに合計）
    const amount = actionAmount(action, event) * ((action.per || "fixed") === "fixed" ? times : 1);
    const apply = action.kind === "counter" ? w.vars.applyCounter : w.vars.applyTimer;
    varsChanged = apply(String(action.name ?? ""), action.op || "add", amount) || varsChanged;
  }

  if (varsChanged) {
    markVarsDirty(w);
    flushVars(w);
  }
  if (visual.length === 0) return;
  broadcastTo(w.userId, {
    type: "studioAction", sceneId, ruleId: rule.id, actions: visual, event: publicEvent(event), extra,
  });
}

/**
 * その人のスタジオにイベントを1件渡す（live.js と demo.js が呼ぶ入口）。
 * @param {string} userId このサービスの利用者
 * @param {"chat"|"gift"|"follow"|"share"|"like"|"join"|"envelope"} type
 * @param {object} user ライブイベントの user（tiktok-live-connector の形）
 * @param {object} [data] text / gift / coins / likes / totalLikes / test
 */
export function studioIngest(userId, type, user, data = {}) {
  try {
    ingest(getWorkspace(userId), type, user, data);
  } catch (err) {
    console.error("スタジオのイベント処理に失敗しました:", err?.message || err);
  }
}

function ingest(w, type, user, data) {
  const event = { id: `${Date.now().toString(36)}-${w.eventSeq++}`, type, user: normalizeUser(user), at: Date.now() };
  if (data.test) event.test = true;

  if (type === "chat") event.text = String(data.text ?? "").slice(0, 500);
  if (type === "gift" && data.gift) {
    const coin = Math.max(0, Number(data.gift.coin) || 0);
    const count = Math.max(1, Math.floor(Number(data.gift.count) || 1));
    event.gift = { name: String(data.gift.name ?? "").slice(0, 80), picture: httpUrlOrEmpty(String(data.gift.pictureUrl ?? "")), coin, count };
    event.count = count;
    event.coins = coin * count;
  }
  if (type === "envelope") event.coins = Math.max(0, Number(data.coins) || 0);
  if (type === "like") {
    event.likes = Math.max(0, Number(data.likes) || 0);
    if (Number.isFinite(Number(data.totalLikes))) event.totalLikes = Number(data.totalLikes);
  }

  w.vars.recordEvent(event);
  if ((type === "gift" || type === "envelope") && event.coins > 0 && event.user.id) {
    const s = w.supporters.get(event.user.id) || { name: event.user.name, avatar: event.user.avatar, coins: 0 };
    s.name = event.user.name;
    s.avatar = event.user.avatar || s.avatar;
    s.coins += event.coins;
    w.supporters.set(event.user.id, s);
  }

  const pub = publicEvent(event);
  if (type === "chat") pushRecent(w.recentChats, pub, RECENT_CHATS);
  else if (type !== "like" && type !== "join") pushRecent(w.recentEvents, pub, RECENT_EVENTS);
  broadcastTo(w.userId, { type: "studioEvent", event: pub });

  for (const { sceneId, rule, extra } of w.engine.evaluate(w.scenes.values(), event)) {
    runRule(w, sceneId, rule, event, extra);
  }
  scheduleVarsBroadcast(w);
}

// ===============================
// デザインとギミック（本人のものだけ）
// ===============================
function sceneSummary(scene) {
  return {
    id: scene.id, name: scene.name, width: scene.width, height: scene.height,
    updatedAt: scene.updatedAt, elements: scene.elements.length, rules: scene.rules.length,
  };
}

/** オーバーレイに渡すシーン。置いてあるギミックの中身を gimmicks に添える */
function withGimmicks(w, scene) {
  const gimmicks = {};
  for (const id of referencedGimmickIds(scene.elements)) {
    const g = w.gimmicks.get(id);
    if (g) gimmicks[id] = g;
  }
  return { ...scene, gimmicks };
}

const newestFirst = (a, b) => b.updatedAt - a.updatedAt;

/**
 * 文書（デザイン・ギミック）の REST。どちらも同じ形で、違うところだけを opts で決める。
 *   GET /           一覧（要約）            GET /:id             1つ
 *   POST /          作る                    PUT /:id             上書き（自分のものだけ。PUT で新しくは作れない）
 *   POST /:id/duplicate  複製               DELETE /:id          消す
 * 上書きと削除は、開いている画面（エディタ・OBS）にその場で届ける。
 * @param {"scenes"|"gimmicks"} kind
 * @param {object} opts
 * @param {string} opts.label 上限のお知らせに出す名前
 * @param {number} opts.max 1人あたりの数
 * @param {(doc: object) => object} opts.summary 一覧に出す要約
 * @param {(w: object, doc: object) => object} opts.savedMessage 上書きしたときに画面へ配るもの
 * @param {string} opts.deletedType 消したときに画面へ配る種類
 */
function documentRoutes(kind, { label, max, summary, savedMessage, deletedType }) {
  const r = express.Router();
  const docs = (req) => req.space[kind];
  const idOf = (req) => (DOCUMENT_ID_PATTERN.test(req.params.id) ? req.params.id : null);
  const isFull = (req) => docs(req).size >= max;
  const tooMany = (res) => res.status(409).json({ error: `${label}は ${max} 個までです` });
  const notFound = (res) => res.status(404).json({ error: "not found" });

  // ?full=1 なら中身ごと（アーティストモードのエディタが、置いたギミックを動かすのに使う）
  r.get("/", (req, res) => {
    const list = [...docs(req).values()].sort(newestFirst);
    res.json(req.query.full === "1" ? list : list.map(summary));
  });

  r.get("/:id", (req, res) => {
    const doc = docs(req).get(idOf(req));
    if (!doc) return notFound(res);
    res.json(doc);
  });

  r.post("/", (req, res) => {
    if (isFull(req)) return tooMany(res);
    res.status(201).json(saveDocument(req.space, kind, req.body || {}, newDocumentId()));
  });

  r.put("/:id", (req, res) => {
    const id = idOf(req);
    if (!id) return res.status(400).json({ error: "bad id" });
    if (!docs(req).has(id)) return notFound(res);
    const doc = saveDocument(req.space, kind, req.body || {}, id);
    broadcastTo(req.user.id, savedMessage(req.space, doc));
    res.json({ ok: true, updatedAt: doc.updatedAt });
  });

  r.post("/:id/duplicate", (req, res) => {
    const src = docs(req).get(idOf(req));
    if (!src) return notFound(res);
    if (isFull(req)) return tooMany(res);
    const doc = saveDocument(req.space, kind, { ...src, name: `${src.name} のコピー` }, newDocumentId());
    res.status(201).json(summary(doc));
  });

  r.delete("/:id", (req, res) => {
    const id = idOf(req);
    if (!id || !docs(req).has(id)) return notFound(res);
    deleteDocument(req.space, kind, id);
    broadcastTo(req.user.id, { type: deletedType, id });
    res.json({ ok: true });
  });

  return r;
}

// ===============================
// /api/studio
// ===============================
const router = express.Router();
router.use(sameOriginOnly);
// 本文を読む前に本人か確かめる（ログインしていない人の大きな本文は読まない）
router.use((req, res, next) => (API_KEY_PATHS.has(req.path) ? requireUserOrApiKey : requireUser)(req, res, next));
router.use((req, res, next) => {
  req.space = getWorkspace(req.user.id);
  next();
});
// 素材は本文が大きいので、本文の上限は assets.js が決める（下の JSON の上限より先に付ける）
router.use("/assets", assetsRouter);
router.use(express.json({ limit: DOCUMENT_JSON_LIMIT }));

// 上書きすると、開いている /overlay がその場で描き直す（OBS を触らずに見た目を直せる）
router.use("/scenes", documentRoutes("scenes", {
  label: "デザイン",
  max: MAX_SCENES_PER_USER,
  summary: sceneSummary,
  savedMessage: (w, scene) => ({ type: "studioScene", scene: withGimmicks(w, scene) }),
  deletedType: "studioSceneDeleted",
}));

// クリエイターモードのギミック。アーティストモードのデザインに置いて使う部品で、
// 保存すると、置いてある OBS の画面もその場で描き直す
router.use("/gimmicks", documentRoutes("gimmicks", {
  label: "ギミック",
  max: MAX_GIMMICKS_PER_USER,
  summary: gimmickSummary,
  savedMessage: (w, gimmick) => ({ type: "studioGimmick", gimmick }),
  deletedType: "studioGimmickDeleted",
}));

// ルールの「テスト」ボタン。クールダウンを無視して、そのルールだけを流す
router.post("/scenes/:id/rules/:ruleId/test", (req, res) => {
  const scene = req.space.scenes.get(req.params.id);
  const rule = scene?.rules.find((r) => r.id === req.params.ruleId);
  if (!rule) return res.status(404).json({ error: "not found" });
  const event = { ...sampleEventFor(rule.trigger), id: `test-${req.space.eventSeq++}`, at: Date.now() };
  runRule(req.space, scene.id, rule, event, { args: "テスト", times: 1 });
  res.json({ ok: true });
});

// テスト用・外部ツール連携用（Authorization: Bearer <API キー>）のイベント投入。本番と同じ判定を通る
router.post("/event", (req, res) => {
  const body = req.body || {};
  const type = String(body.type ?? "");
  if (!EVENT_TYPES.includes(type)) return res.status(400).json({ error: "bad type" });
  const name = String(body.user?.name ?? body.user ?? "テスト視聴者").slice(0, 80) || "テスト視聴者";
  const avatar = String(body.user?.avatar ?? "");
  const viewer = { userId: `test:${name}`, uniqueId: name, nickName: name, profilePictureUrl: avatar };
  studioIngest(req.user.id, type, viewer, {
    text: body.text,
    gift: type === "gift" ? {
      name: body.gift?.name ?? body.giftName ?? "ローズ",
      pictureUrl: body.gift?.picture ?? "",
      coin: body.gift?.coin ?? body.coins ?? 1,
      count: body.gift?.count ?? body.count ?? 1,
    } : undefined,
    coins: body.coins,
    likes: body.likes ?? body.count,
    test: body.test !== false,
  });
  res.json({ ok: true });
});

// カウンター・タイマーを手で動かす（「テスト」タブ・配信中の手直し・外部ツール）
router.post("/vars", (req, res) => {
  const { kind, name, op, value } = req.body || {};
  const vars = req.space.vars;
  let ok = false;
  if (kind === "counter") ok = vars.applyCounter(String(name ?? ""), op, Number(value) || 0);
  else if (kind === "timer") ok = vars.applyTimer(String(name ?? ""), op, Number(value) || 0);
  else if (kind === "delete" && isValidVarName(name)) ok = vars.deleteVar(req.body.type, name);
  if (!ok) return res.status(400).json({ error: "bad request" });
  markVarsDirty(req.space);
  flushVars(req.space);
  res.json({ ok: true, vars: varsPayload(req.space) });
});

router.get("/vars", (req, res) => res.json(varsPayload(req.space)));

router.post("/stats/reset", (req, res) => {
  resetStudioSession(req.user.id);
  res.json({ ok: true });
});

app.use("/api/studio", router);

// ===============================
// オーバーレイ（OBS）向け：URL の合鍵で持ち主を決める
// ===============================
// 置いてあるギミックの中身も一緒に渡す（OBS はログインできないので、ギミックだけを取りに行く口は作らない）
app.get("/api/public/scenes/:id", (req, res) => {
  const user = findUserByOverlayKey(String(req.query.k ?? ""));
  const w = user && getWorkspace(user.id);
  const scene = w && w.scenes.get(req.params.id);
  if (!scene) return res.status(404).json({ error: "not found" });
  res.json(withGimmicks(w, scene));
});

// ===============================
// アカウントの登録・削除
// ===============================
// 素材のフォルダは assets.js が消す
authEvents.on("deleted", (userId) => dropWorkspace(userId));

// 1人用だった頃のデザインと素材は、最初に登録した人がそのまま引き継ぐ
authEvents.on("registered", (user) => {
  if (userCount() !== 1) return;
  try {
    const moved = adoptLegacyData(user.id);
    if (moved) console.log(`📦 1人用だった頃のデザイン ${moved} 件を、最初の利用者に引き継ぎました`);
  } catch (err) {
    console.warn("⚠ 以前のデザインを引き継げませんでした:", err?.message || err);
  }
});

function adoptLegacyData(userId) {
  const scenesDir = path.join(LEGACY_STUDIO_DIR, "scenes");
  if (!fs.existsSync(scenesDir)) return 0;
  let count = 0;
  transaction(() => {
    for (const file of fs.readdirSync(scenesDir)) {
      const id = path.basename(file, ".json");
      if (!file.endsWith(".json") || !DOCUMENT_ID_PATTERN.test(id)) continue;
      // 素材の URL は利用者ごとのフォルダに移る
      const text = fs.readFileSync(path.join(scenesDir, file), "utf-8").replaceAll('"/studio-assets/', `"/studio-assets/${userId}/`);
      const scene = sanitizeScene(JSON.parse(text), id);
      run("INSERT OR IGNORE INTO scenes (id, user_id, data, updated_at) VALUES (?, ?, ?, ?)", id, userId, JSON.stringify(scene), scene.updatedAt);
      count++;
    }
    const state = path.join(LEGACY_STUDIO_DIR, "state.json");
    if (fs.existsSync(state)) {
      run("INSERT OR IGNORE INTO user_state (user_id, data) VALUES (?, ?)", userId, fs.readFileSync(state, "utf-8"));
    }
  });
  adoptLegacyAssets(userId, path.join(LEGACY_STUDIO_DIR, "assets"));
  fs.renameSync(LEGACY_STUDIO_DIR, `${LEGACY_STUDIO_DIR}.migrated`);
  dropWorkspace(userId); // 読み直させる
  return count;
}
