// lib/studio/scene.js
// スタジオ（/studio）で作るデザイン＝「シーン」の入れ物と検査。
//
// シーンは REST で丸ごと届く。ブラウザからは誰でも送れる前提なので、**保存する前に形を整える**
// （整え方の小道具は sanitize.js）。
// ここで見るのは「壊れていない・大きすぎない・型が合っている」ことだけで、
// 要素の種類ごとの既定値や見た目の解釈はブラウザ側（public/js/studio/shared/model.js）が持つ。
// サーバーが要素の細かい形まで知ると、ウィジェットを足すたびに両側を直すことになる。
//
// 視聴者由来の文字列（名前・コメント）はシーンには入らない。シーンを書くのは
// 配信者本人だけで、視聴者の文字列は描画のときに textContent で差し込む。
import {
  sanitizeLoose, clampNum, str, isPlainObject, isSafeKey, freshPartId, PART_ID_PATTERN, STRING_LIMIT,
} from "./sanitize.js";

// 要素の種類。ここに無いものは捨てる（ブラウザ側が描けないので）。
const ELEMENT_TYPES = [
  "rect", "ellipse", "polygon", "path", "text", "image", "group",
  // 配信と連動するウィジェット
  "chat", "danmaku", "alert", "goal", "leaderboard", "events", "timer",
  // クリエイターモードで作ったギミックを置く枠（中身は lib/studio/gimmick.js）
  "gimmick",
];

// アクションの種類（lib/studio/rules.js と server/studio.js が解釈する）
const ACTION_KINDS = [
  "alert", "sound", "animate", "visibility", "counter", "timer", "particles", "tts", "text",
  // 置いたギミックに合図を送る（クリエイターモードのブループリントの「合図を受けたとき」ノード）
  "gimmick",
];

// 配信のイベントの種類（server/studio.js が受け付ける）と、ルールのきっかけ（＋「すべて」）
export const EVENT_TYPES = ["chat", "gift", "follow", "share", "like", "join", "envelope"];
const TRIGGER_TYPES = [...EVENT_TYPES, "any"];

// 上限。巨大なシーンを保存して配信中に重くならないように。
export const LIMITS = {
  elements: 500,      // グループの中も含めた総数
  depth: 4,           // グループの入れ子
  rules: 100,
  actionsPerRule: 12,
  string: STRING_LIMIT,
  size: 8192,         // キャンバスの一辺
};

// 共通の項目。ここに並べたものは型を固定する。
const COMMON_KEYS = new Set([
  "id", "type", "name", "x", "y", "w", "h", "rotation", "opacity", "visible", "locked",
  "startHidden", "children",
]);

function sanitizeElement(raw, depth, counter, seenIds) {
  if (!isPlainObject(raw)) return null;
  if (!ELEMENT_TYPES.includes(raw.type)) return null;
  if (counter.n >= LIMITS.elements) return null;

  let id = str(raw.id, 40);
  if (!PART_ID_PATTERN.test(id) || seenIds.has(id)) id = freshPartId("el");
  seenIds.add(id);
  counter.n++;

  const el = {
    id,
    type: raw.type,
    name: str(raw.name, 80, raw.type),
    x: clampNum(raw.x, -LIMITS.size * 2, LIMITS.size * 2, 0),
    y: clampNum(raw.y, -LIMITS.size * 2, LIMITS.size * 2, 0),
    w: clampNum(raw.w, 1, LIMITS.size * 2, 100),
    h: clampNum(raw.h, 1, LIMITS.size * 2, 100),
    rotation: clampNum(raw.rotation, -3600, 3600, 0),
    opacity: clampNum(raw.opacity, 0, 1, 1),
    visible: raw.visible !== false,
    locked: raw.locked === true,
    startHidden: raw.startHidden === true,
  };

  // 種類ごとの設定は形だけ整えて残す
  for (const [k, v] of Object.entries(raw)) {
    if (COMMON_KEYS.has(k) || !isSafeKey(k)) continue;
    const clean = sanitizeLoose(v);
    if (clean !== undefined) el[k] = clean;
  }

  if (el.type === "group") {
    if (depth >= LIMITS.depth) return null;
    const children = Array.isArray(raw.children) ? raw.children : [];
    el.children = children
      .map((c) => sanitizeElement(c, depth + 1, counter, seenIds))
      .filter(Boolean);
    if (el.children.length === 0) return null;
  }
  return el;
}

function sanitizeAction(raw) {
  if (!isPlainObject(raw) || !ACTION_KINDS.includes(raw.kind)) return null;
  const clean = sanitizeLoose(raw);
  clean.kind = raw.kind;
  return clean;
}

function sanitizeRule(raw, index) {
  if (!isPlainObject(raw)) return null;
  const trigger = isPlainObject(raw.trigger) ? raw.trigger : {};
  const type = TRIGGER_TYPES.includes(trigger.type) ? trigger.type : "gift";
  const id = typeof raw.id === "string" && PART_ID_PATTERN.test(raw.id) ? raw.id : `rule-${index}`;

  return {
    id,
    name: str(raw.name, 80, "ルール"),
    enabled: raw.enabled !== false,
    trigger: {
      type,
      giftName: str(trigger.giftName, 80),
      minCoins: clampNum(trigger.minCoins, 0, 1e9, 0),
      maxCoins: clampNum(trigger.maxCoins, 0, 1e9, 0),
      match: ["any", "command", "contains", "exact"].includes(trigger.match) ? trigger.match : "any",
      keyword: str(trigger.keyword, 80),
      likeEvery: clampNum(trigger.likeEvery, 0, 1e7, 0),
      users: str(trigger.users, 500),
    },
    cooldown: clampNum(raw.cooldown, 0, 86400, 0),
    userCooldown: clampNum(raw.userCooldown, 0, 86400, 0),
    actions: (Array.isArray(raw.actions) ? raw.actions : [])
      .slice(0, LIMITS.actionsPerRule)
      .map(sanitizeAction)
      .filter(Boolean),
  };
}

/**
 * 届いたシーンを保存できる形にする。
 * @param {unknown} raw
 * @param {string} id 保存先のID（本文の id は信用しない）
 * @returns {object} 整えたシーン
 */
export function sanitizeScene(raw, id) {
  const src = isPlainObject(raw) ? raw : {};
  const counter = { n: 0 };
  const seenIds = new Set();

  const elements = (Array.isArray(src.elements) ? src.elements : [])
    .map((e) => sanitizeElement(e, 0, counter, seenIds))
    .filter(Boolean);

  const ruleIds = new Set();
  const rules = (Array.isArray(src.rules) ? src.rules : [])
    .slice(0, LIMITS.rules)
    .map(sanitizeRule)
    .filter(Boolean)
    .map((r) => {
      if (ruleIds.has(r.id)) r.id = freshPartId("rule");
      ruleIds.add(r.id);
      return r;
    });

  return {
    id,
    name: str(src.name, 80, "無題のデザイン") || "無題のデザイン",
    width: Math.round(clampNum(src.width, 16, LIMITS.size, 1920)),
    height: Math.round(clampNum(src.height, 16, LIMITS.size, 1080)),
    background: str(src.background, 80, "transparent") || "transparent",
    elements,
    rules,
    meta: sanitizeLoose(isPlainObject(src.meta) ? src.meta : {}) ?? {},
    updatedAt: Date.now(),
  };
}

/** 全要素をグループの中まで平らにして返す */
export function flattenElements(elements) {
  const out = [];
  const walk = (list) => {
    for (const el of list) {
      out.push(el);
      if (el.type === "group" && Array.isArray(el.children)) walk(el.children);
    }
  };
  walk(elements || []);
  return out;
}
