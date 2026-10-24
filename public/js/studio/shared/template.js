// public/js/studio/shared/template.js
// デザインの文字に値を差し込む（{likes} → 1,234）。エディタとオーバーレイの両方が使う。
//
// 差し込んだ結果は必ず textContent で画面に入れる（視聴者の名前やコメントが入るため）。
// ここは文字列を作るだけで、HTML としては一切解釈しない。

/** テンプレートで使える名前の一覧（エディタの「変数を挿入」に出す） */
export const TEMPLATE_VARS = [
  { key: "likes", label: "いいね数（配信累計）", scope: "global" },
  { key: "followers", label: "フォロー数（今回）", scope: "global" },
  { key: "shares", label: "シェア数（今回）", scope: "global" },
  { key: "coins", label: "ギフトのコイン合計（今回）", scope: "global" },
  { key: "gifts", label: "ギフトの個数（今回）", scope: "global" },
  { key: "comments", label: "コメント数（今回）", scope: "global" },
  { key: "joins", label: "入室数（今回）", scope: "global" },
  { key: "lastFollower", label: "最新のフォロワー", scope: "global" },
  { key: "lastGifter", label: "最新のギフト送り主", scope: "global" },
  { key: "lastGift", label: "最新のギフト名", scope: "global" },
  { key: "lastCommenter", label: "最新のコメント主", scope: "global" },
  { key: "lastComment", label: "最新のコメント", scope: "global" },
  { key: "lastSharer", label: "最新のシェアした人", scope: "global" },
  { key: "top1Name", label: "ギフト1位の名前", scope: "global" },
  { key: "top1Coins", label: "ギフト1位のコイン", scope: "global" },
  { key: "top2Name", label: "ギフト2位の名前", scope: "global" },
  { key: "top3Name", label: "ギフト3位の名前", scope: "global" },
  { key: "user", label: "イベントの人の名前", scope: "event" },
  { key: "gift", label: "ギフト名", scope: "event" },
  { key: "count", label: "ギフトの個数", scope: "event" },
  { key: "giftCoins", label: "このギフトのコイン", scope: "event" },
  { key: "comment", label: "コメント本文", scope: "event" },
  { key: "args", label: "コマンドの後ろの文字", scope: "event" },
  { key: "likeCount", label: "このいいねの数", scope: "event" },
];

const hasOwn = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

/** 1234567 → "1,234,567" / "1.2M"（k 指定時） */
export function formatNumber(n, fmt) {
  if (fmt === "raw") return String(n);
  if (fmt === "k") {
    const abs = Math.abs(n);
    if (abs >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
    return String(n);
  }
  return n.toLocaleString("ja-JP");
}

/**
 * ミリ秒を時計の形にする。
 * @param {number} ms
 * @param {"auto"|"hh:mm:ss"|"mm:ss"|"ss"} [format]
 */
export function formatDuration(ms, format = "auto") {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n) => String(n).padStart(2, "0");
  if (format === "ss") return String(total);
  if (format === "mm:ss") return `${p(h * 60 + m)}:${p(s)}`;
  if (format === "hh:mm:ss" || h > 0) return `${p(h)}:${p(m)}:${p(s)}`;
  return `${p(m)}:${p(s)}`;
}

function formatValue(v, fmt) {
  if (typeof v === "number") {
    if (fmt === "time") return formatDuration(v);
    return formatNumber(v, fmt);
  }
  if (fmt === "upper") return String(v).toUpperCase();
  return String(v);
}

/**
 * `{key}` と `{key|fmt}` を置き換える。知らない名前は空にする。
 * fmt: raw（区切り無し）/ k（1.2K）/ time（ミリ秒→時計）/ upper
 */
export function renderTemplate(template, ctx) {
  return String(template ?? "").replace(/\{([^{}\s|]{1,40})(?:\|([a-z]+))?\}/gu, (m, key, fmt) => {
    if (!hasOwn(ctx, key)) return "";
    const v = ctx[key];
    if (v === undefined || v === null) return "";
    return formatValue(v, fmt);
  });
}

export const hasTemplate = (s) => /\{[^{}\s]{1,40}\}/u.test(String(s ?? ""));

/**
 * 差し込みに使う値をまとめる。
 * @param {object} vars サーバーの studioVars（stats / counters / timers / top）
 * @param {object} [event] アクションのきっかけになったイベント
 * @param {object} [extra] ルールの判定で増えた値（args / times）
 * @param {number} [elapsedMs] vars を受け取ってから経った時間（タイマーを進める）
 */
export function buildContext(vars, event, extra, elapsedMs = 0) {
  const ctx = Object.create(null);
  const stats = vars?.stats || {};
  for (const [k, v] of Object.entries(stats)) ctx[k] = v;
  for (const [k, v] of Object.entries(vars?.counters || {})) {
    if (!(k in ctx)) ctx[k] = v;
  }
  for (const [k, t] of Object.entries(vars?.timers || {})) {
    if (k in ctx) continue;
    const remaining = t.running ? Math.max(0, t.remaining - elapsedMs) : t.remaining;
    ctx[k] = formatDuration(remaining);
  }
  (vars?.top || []).slice(0, 10).forEach((s, i) => {
    ctx[`top${i + 1}Name`] = s.name;
    ctx[`top${i + 1}Coins`] = s.coins;
  });
  for (let i = (vars?.top || []).length; i < 3; i++) {
    ctx[`top${i + 1}Name`] = "---";
    ctx[`top${i + 1}Coins`] = 0;
  }
  if (event) {
    ctx.user = event.user?.name ?? "";
    ctx.avatar = event.user?.avatar ?? "";
    ctx.comment = event.text ?? "";
    ctx.gift = event.gift?.name ?? "";
    ctx.count = event.count ?? event.gift?.count ?? 1;
    ctx.giftCoins = event.coins ?? 0;
    ctx.likeCount = event.likes ?? 0;
    ctx.type = event.type;
  }
  if (extra) {
    if (extra.args !== undefined) ctx.args = extra.args;
    if (extra.times !== undefined) ctx.times = extra.times;
  }
  return ctx;
}
