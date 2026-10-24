// test/studio-logic.test.mjs
// スタジオの計算部分の検査（シーンの検査・ルールの判定・カウンターとタイマー・差し込み・幾何）。
// `npm test` で実行する。配線（イベントが届いて配られるか）は studio-flow.test.mjs が見る。
import { t, section, finish } from "./helpers/harness.mjs";
import { sanitizeScene, flattenElements, LIMITS } from "../lib/studio/scene.js";
import {
  matchCommand, matchTrigger, createRuleEngine, actionAmount, sampleEventFor,
} from "../lib/studio/rules.js";
import { createStudioVars, isValidVarName } from "../lib/studio/variables.js";
import {
  getUserKey, getUserName, getUserAvatar, getGiftName, getGiftCoin, getGiftPictureUrl, isStreakInProgress,
} from "../lib/live-events.js";
import {
  renderTemplate, buildContext, formatDuration, formatNumber, hasTemplate,
} from "../public/js/studio/shared/template.js";
import {
  normalizeElement, createElement, safeColor, safeUrl, safeFont, pathData, nodesBounds, polygonPoints,
  aabb, scaleAbout, rotateAbout, refreshGroup, translate, pathElementFromNodes, cssPaint, deepMerge,
  googleFontsUrl, findElement,
} from "../public/js/studio/shared/model.js";

const user = (name) => ({ id: `id:${name}`, name, handle: name, avatar: "" });
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

section("シーンの検査（lib/studio/scene.js）");
{
  const raw = {
    name: "テスト", width: 99999, height: "720",
    elements: [
      { id: "a", type: "rect", x: 10, y: "20", w: 0, h: 50, fill: { type: "solid", color: "#fff" }, opacity: 5 },
      { id: "a", type: "ellipse" }, // 重複した id
      { type: "script", x: 1 },     // 知らない種類
      { type: "text", text: "x".repeat(10000), font: { size: 40 }, ["__proto__"]: { polluted: true } },
      { type: "group", children: [{ type: "rect" }, { type: "group", children: [] }] },
      { type: "group", children: [] }, // 空のグループ
      null, 42, "str",
    ],
    rules: [
      { name: "r", trigger: { type: "follow" }, actions: [{ kind: "alert" }, { kind: "eval", code: "x" }] },
      { id: "dup", trigger: { type: "nope" }, actions: [] },
      { id: "dup", trigger: { type: "chat", match: "regex" }, actions: [] },
    ],
  };
  const s = sanitizeScene(raw, "abc");
  t("ID は保存先のものを使う", s.id === "abc");
  t("大きさに上限がある", s.width === LIMITS.size && s.height === 720);
  t("知らない種類・壊れた要素・空のグループは捨てる", s.elements.length === 4);
  t("重複した id は振り直す", new Set(flattenElements(s.elements).map((e) => e.id)).size === flattenElements(s.elements).length);
  t("数値は型を直して範囲に収める", s.elements[0].y === 20 && s.elements[0].w === 1 && s.elements[0].opacity === 1);
  t("種類ごとの設定は残る", s.elements[0].fill.color === "#fff");
  t("長すぎる文字は切る", s.elements[2].text.length === LIMITS.string);
  t("__proto__ を鍵にした値は入らない", !Object.prototype.hasOwnProperty.call(s.elements[2], "__proto__") && ({}).polluted === undefined);
  t("入れ子のグループの空の子グループは捨てる", s.elements[3].children.length === 1);
  t("知らないアクションは捨てる", s.rules[0].actions.length === 1 && s.rules[0].actions[0].kind === "alert");
  t("ルールに id が無ければ付ける", typeof s.rules[0].id === "string" && s.rules[0].id.length > 0);
  t("重複したルールの id は振り直す", s.rules[1].id !== s.rules[2].id);
  t("知らないきっかけは gift に・知らない一致方法は any に", s.rules[1].trigger.type === "gift" && s.rules[2].trigger.match === "any");

  const many = { elements: Array.from({ length: LIMITS.elements + 50 }, () => ({ type: "rect" })) };
  t("要素の数に上限がある", sanitizeScene(many, "x").elements.length === LIMITS.elements);
  let deep = { type: "rect" };
  for (let i = 0; i < 10; i++) deep = { type: "group", children: [deep] };
  t("グループの入れ子が深すぎるものは捨てる", sanitizeScene({ elements: [deep] }, "x").elements.length === 0);
}

section("ルールの判定（lib/studio/rules.js）");
{
  t("コマンドは単語として一致する", matchCommand("!jump", "!jump") === "" && matchCommand("!JUMP 3回", "!jump") === "3回");
  t("前方一致しただけの別の単語には当たらない", matchCommand("!jumpman", "!jump") === null);
  t("空のコマンドは当たらない", matchCommand("!jump", "") === null);
  t("全角の「！」・全角スペース・全角の数字でも当たる（日本語入力のまま）", matchCommand("！ｊｕｍｐ　３", "!jump") === "3" && matchCommand("ｼﾞｬﾝﾌﾟ", "ジャンプ") === "");
  t("「含む」「同じ」も全角を同じに読む", !!matchTrigger({ type: "chat", match: "exact", keyword: "1" }, { type: "chat", text: "１" }) && !!matchTrigger({ type: "chat", match: "contains", keyword: "w" }, { type: "chat", text: "ｗｗｗ" }));

  const gift = (coins, name = "ローズ") => ({ type: "gift", user: user("a"), gift: { name, coin: coins, count: 1 }, coins, count: 1 });
  const trig = (o) => ({ type: "gift", giftName: "", minCoins: 0, maxCoins: 0, match: "any", keyword: "", likeEvery: 0, users: "", ...o });
  t("ギフト：どれでも", !!matchTrigger(trig({}), gift(1)));
  t("ギフト：最低コイン", !matchTrigger(trig({ minCoins: 100 }), gift(99)) && !!matchTrigger(trig({ minCoins: 100 }), gift(100)));
  t("ギフト：最高コイン", !matchTrigger(trig({ maxCoins: 10 }), gift(11)));
  t("ギフト：名前（大文字小文字・カンマ区切り）", !!matchTrigger(trig({ giftName: "gg, ローズ" }), gift(1, "GG")) && !matchTrigger(trig({ giftName: "ライオン" }), gift(1)));
  t("種類が違えば当たらない", !matchTrigger(trig({ type: "follow" }), gift(1)));
  t("any はどれにも当たる", !!matchTrigger(trig({ type: "any" }), { type: "share", user: user("a") }));

  const chat = (text) => ({ type: "chat", user: user("b"), text });
  t("コメント：コマンドの引数を返す", matchTrigger(trig({ type: "chat", match: "command", keyword: "!tts" }), chat("!tts こんにちは"))?.args === "こんにちは");
  t("コメント：含む", !!matchTrigger(trig({ type: "chat", match: "contains", keyword: "草" }), chat("大草原")));
  t("コメント：完全一致", !matchTrigger(trig({ type: "chat", match: "exact", keyword: "888" }), chat("8888")));
  t("人で絞る（名前・@ID）", !!matchTrigger(trig({ type: "chat", users: "@b" }), chat("x")) && !matchTrigger(trig({ type: "chat", users: "zzz" }), chat("x")));

  t("量：固定", actionAmount({ amount: 3 }, gift(10)) === 3);
  t("量：コイン数を掛ける", actionAmount({ seconds: 10, per: "coins" }, gift(5)) === 50);
  t("量：個数を掛ける", actionAmount({ amount: 2, per: "count" }, { count: 4 }) === 8);
  t("量：いいねを掛ける", actionAmount({ amount: 1, per: "likes" }, { likes: 15 }) === 15);

  let now = 0;
  const engine = createRuleEngine({ now: () => now });
  const scene = (rules) => [{ id: "s", rules }];
  const r = (id, trigger, extra = {}) => ({ id, enabled: true, trigger: trig(trigger), cooldown: 0, userCooldown: 0, actions: [{ kind: "alert" }], ...extra });

  const likeRule = r("like", { type: "like", likeEvery: 100 });
  const like = (n) => ({ type: "like", user: user("c"), likes: n });
  t("いいね：貯まるまでは出ない", engine.evaluate(scene([likeRule]), like(60)).length === 0);
  const fired = engine.evaluate(scene([likeRule]), like(60));
  t("いいね：跨いだら出る", fired.length === 1 && fired[0].extra.times === 1);
  t("いいね：一度に何回分も跨いだら回数を持つ", engine.evaluate(scene([likeRule]), like(320))[0].extra.times === 3);

  const cd = r("cd", { type: "follow" }, { cooldown: 10 });
  const follow = (name) => ({ type: "follow", user: user(name) });
  t("クールダウン：1回目は出る", engine.evaluate(scene([cd]), follow("a")).length === 1);
  now = 5000;
  t("クールダウン：時間内は誰でも出ない", engine.evaluate(scene([cd]), follow("b")).length === 0);
  now = 10001;
  t("クールダウン：過ぎたら出る", engine.evaluate(scene([cd]), follow("b")).length === 1);

  const ucd = r("ucd", { type: "share" }, { userCooldown: 60 });
  const share = (name) => ({ type: "share", user: user(name) });
  engine.evaluate(scene([ucd]), share("a"));
  t("1人ごと：同じ人は出ない", engine.evaluate(scene([ucd]), share("a")).length === 0);
  t("1人ごと：別の人は出る", engine.evaluate(scene([ucd]), share("b")).length === 1);

  t("無効なルール・アクションの無いルールは出ない",
    engine.evaluate(scene([r("x", { type: "follow" }, { enabled: false }), r("y", { type: "follow" }, { actions: [] })]), follow("z")).length === 0);

  for (const type of ["gift", "chat", "like", "follow", "share", "join", "envelope"]) {
    const tr = trig({ type, match: type === "chat" ? "command" : "any", keyword: "!go", minCoins: 50, giftName: "ドーナツ" });
    t(`テスト用のイベントは自分のルールに当たる（${type}）`, !!matchTrigger(tr, sampleEventFor(tr)));
  }
}

section("カウンター・タイマー（lib/studio/variables.js）");
{
  let now = 1000;
  const vars = createStudioVars({ now: () => now });
  vars.recordEvent({ type: "follow", user: user("さくら") });
  vars.recordEvent({ type: "gift", user: user("ゆうき"), gift: { name: "ローズ" }, coins: 30, count: 3 });
  vars.recordEvent({ type: "like", user: user("x"), likes: 5 });
  vars.recordEvent({ type: "like", user: user("x"), likes: 5, totalLikes: 400 });
  vars.recordEvent({ type: "chat", user: user("y"), text: "こんにちは" });
  const st = vars.snapshot().stats;
  t("フォロー・ギフト・コメントを数える", st.followers === 1 && st.coins === 30 && st.gifts === 3 && st.comments === 1);
  t("最新の人を覚える", st.lastFollower === "さくら" && st.lastGifter === "ゆうき" && st.lastGift === "ローズ" && st.lastComment === "こんにちは");
  t("いいねは配信の累計があればそれを使う", st.likes === 400);

  t("予約語はカウンターの名前にできない", !isValidVarName("likes") && !isValidVarName("user") && !isValidVarName("top1Name") && !isValidVarName("__proto__"));
  t("日本語の名前は使える", isValidVarName("デス数") && isValidVarName("deaths") && isValidVarName("topping"));
  t("記号や空白は使えない", !isValidVarName("a b") && !isValidVarName("a{b}") && !isValidVarName(""));
  vars.applyCounter("deaths", "add", 2);
  vars.applyCounter("deaths", "add", 3);
  vars.applyCounter("deaths", "sub", 1);
  t("カウンター：足す・引く", vars.snapshot().counters.deaths === 4);
  vars.applyCounter("deaths", "set", 10);
  t("カウンター：値にする", vars.snapshot().counters.deaths === 10);
  t("カウンター：不正な名前は動かさない", vars.applyCounter("likes", "add", 1) === false);

  vars.applyTimer("sub", "set", 60);
  vars.applyTimer("sub", "start");
  now += 10_000;
  t("タイマー：走っている間は減る", vars.snapshot().timers.sub.remaining === 50_000);
  vars.applyTimer("sub", "add", 30);
  t("タイマー：延長できる", vars.snapshot().timers.sub.remaining === 80_000 && vars.snapshot().timers.sub.running);
  vars.applyTimer("sub", "pause");
  now += 10_000;
  t("タイマー：止めている間は減らない", vars.snapshot().timers.sub.remaining === 80_000);
  vars.applyTimer("sub", "start");
  now += 100_000;
  const done = vars.snapshot().timers.sub;
  t("タイマー：0 で止まる", done.remaining === 0 && done.running === false);

  vars.applyTimer("sub", "set", 120);
  vars.applyTimer("sub", "start");
  const saved = vars.serialize();
  t("保存：stats は保存しない", !("stats" in saved));
  const vars2 = createStudioVars({ now: () => now });
  vars2.restore(JSON.parse(JSON.stringify(saved)));
  t("保存：カウンターが戻る", vars2.snapshot().counters.deaths === 10);
  t("保存：タイマーは止めた状態で戻る", vars2.snapshot().timers.sub.remaining === 120_000 && !vars2.snapshot().timers.sub.running);
  vars2.restore({ counters: { likes: 5, ok: "x", fine: 3 }, timers: { bad: { remainingMs: "x" } } });
  t("保存：読めない値は捨てる", JSON.stringify(vars2.snapshot().counters) === '{"fine":3}' && Object.keys(vars2.snapshot().timers).length === 0);
  vars.resetStats();
  t("stats のリセットでカウンターは消えない", vars.snapshot().stats.followers === 0 && vars.snapshot().counters.deaths === 10);
}

section("差し込み（public/js/studio/shared/template.js）");
{
  const ctx = buildContext(
    { stats: { likes: 12345, followers: 3 }, counters: { deaths: 2 }, timers: { sub: { remaining: 3_725_000, running: false } }, top: [{ name: "さくら", coins: 500 }] },
    { type: "gift", user: { name: "ゆうき" }, gift: { name: "ローズ" }, count: 5, coins: 5, text: "" },
    { args: "abc" },
  );
  t("値を差し込む", renderTemplate("❤ {likes} / {followers}", ctx) === "❤ 12,345 / 3");
  t("書式：raw と k", renderTemplate("{likes|raw} {likes|k}", ctx) === "12345 12.3K");
  t("カウンターも差し込める", renderTemplate("デス {deaths}", ctx) === "デス 2");
  t("タイマーは時計の形", renderTemplate("{sub}", ctx) === "01:02:05");
  t("イベントの値", renderTemplate("{user}が{gift}×{count}（{giftCoins}）{args}", ctx) === "ゆうきがローズ×5（5）abc");
  t("ランキングが空の席は ---", renderTemplate("{top1Name} {top2Name}", ctx) === "さくら ---");
  t("知らない名前は空にする", renderTemplate("[{nope}]", ctx) === "[]");
  t("prototype の名前でも壊れない", renderTemplate("{constructor}{__proto__}{toString}", ctx) === "");
  t("差し込みがあるかの判定", hasTemplate("a {b}") && !hasTemplate("a { b }") && !hasTemplate("abc"));
  t("時計の形", formatDuration(59_001) === "01:00" && formatDuration(3_600_000) === "01:00:00" && formatDuration(90_000, "mm:ss") === "01:30" && formatDuration(-5) === "00:00");
  t("大きな数の略記", formatNumber(1_500_000, "k") === "1.5M" && formatNumber(999, "k") === "999");
}

section("要素と幾何（public/js/studio/shared/model.js）");
{
  const el = normalizeElement({ type: "rect", id: "r" });
  t("既定値で埋める", el.fill.type === "solid" && el.shadow.enabled === false && el.anim.loop === "none");
  t("保存された値は既定値より優先", normalizeElement({ type: "text", font: { size: 10 } }).font.family === "Noto Sans JP" && normalizeElement({ type: "text", font: { size: 10 } }).font.size === 10);
  t("deepMerge は __proto__ を無視する", deepMerge({}, JSON.parse('{"__proto__":{"p":1}}')).p === undefined && ({}).p === undefined);
  const a = createElement("ellipse");
  const b = createElement("ellipse");
  t("作るたびに別の id", a.id !== b.id && a.name === "円");

  t("色：16進・rgba は通す", safeColor("#ff00aa80") === "#ff00aa80" && safeColor("rgba(1, 2, 3, 0.5)") === "rgba(1, 2, 3, 0.5)");
  t("色：CSS の注入は通さない", safeColor("red;background:url(x)", "X") === "X" && safeColor("url(javascript:1)", "X") === "X");
  t("URL：自分の素材と http(s) だけ", safeUrl("/studio-assets/a.png") === "/studio-assets/a.png" && safeUrl("https://x.test/a.png") !== "");
  t("URL：javascript: や相対パス抜けは通さない", safeUrl("javascript:alert(1)") === "" && safeUrl("/studio-assets/a.png\") x") === "" && safeUrl("data:text/html,x") === "");
  t("フォント名の記号は落とす", safeFont('Noto"; } body{') === "Noto  body");
  t("塗り：グラデーションの CSS", cssPaint({ type: "linear", angle: 90, stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }] }) === "linear-gradient(90deg, #000 0%, #fff 100%)");

  const nodes = [{ x: 0, y: 0 }, { x: 100, y: 0, ix: 50, iy: -50, ox: 100, oy: 0 }, { x: 100, y: 100 }];
  t("パス：直線と曲線", pathData(nodes, false) === "M0 0 C0 0 50 -50 100 0 L100 100");
  t("パス：閉じる", pathData(nodes, true).endsWith("Z"));
  const nb = nodesBounds(nodes);
  t("パス：制御点も含めた範囲", nb.y === -50 && nb.h === 150);
  const pe = pathElementFromNodes([{ x: 100, y: 200 }, { x: 300, y: 260 }], false);
  t("パス：シーン座標の点から要素を作る", pe.x === 100 && pe.y === 200 && pe.w === 200 && pe.h === 60 && pe.path.nodes[1].x === 200);

  const tri = polygonPoints(300, 200, 3, false, 0.5);
  const xs = tri.map((p) => p[0]);
  const ys = tri.map((p) => p[1]);
  t("多角形：枠いっぱいに広がる", near(Math.min(...xs), 0) && near(Math.max(...xs), 300) && near(Math.min(...ys), 0) && near(Math.max(...ys), 200));
  t("星：角の数の2倍の頂点", polygonPoints(100, 100, 5, true, 0.4).length === 10);

  const rot = { type: "rect", x: 0, y: 0, w: 100, h: 50, rotation: 90 };
  const box = aabb(rot);
  t("回転した外接矩形", near(box.w, 50) && near(box.h, 100) && near(box.x, 25) && near(box.y, -25));

  const s1 = { type: "rect", x: 10, y: 10, w: 10, h: 10, rotation: 0 };
  scaleAbout(s1, 0, 0, 2, 3);
  t("基準点から拡大する", s1.x === 20 && s1.y === 30 && s1.w === 20 && s1.h === 30);
  const r1 = { type: "rect", x: 90, y: -10, w: 20, h: 20, rotation: 0 };
  rotateAbout(r1, 0, 0, 90);
  t("中心のまわりに回す", near(r1.x + 10, 0) && near(r1.y + 10, 100) && r1.rotation === 90);

  const g = { type: "group", x: 0, y: 0, w: 1, h: 1, children: [
    { type: "rect", id: "c1", x: 10, y: 10, w: 10, h: 10 }, { type: "rect", id: "c2", x: 50, y: 40, w: 10, h: 10 },
  ] };
  refreshGroup(g);
  t("グループの枠は中身から決まる", g.x === 10 && g.y === 10 && g.w === 50 && g.h === 40);
  translate(g, 5, 5);
  t("グループを動かすと中身も動く", g.children[1].x === 55 && g.x === 15);
  t("グループの中まで探せる", findElement([g], "c2")?.parent === g);

  const url = googleFontsUrl(new Set(["Noto Sans JP", "Dela Gothic One", "Unknown Font"]));
  t("使っている Google Fonts だけ読む", url.includes("family=Noto+Sans+JP:wght@100..900") && url.includes("family=Dela+Gothic+One&") && !url.includes("Unknown"));
  t("Google Fonts を使っていなければ読まない", googleFontsUrl(new Set(["sans-serif"])) === null);
}

section("TikTok のイベントの読み取り（lib/live-events.js）");
{
  t("人のキーは変わらない userId を使う", getUserKey({ userId: 123, uniqueId: "abc" }) === "123");
  t("userId が無ければ @ID", getUserKey({ uniqueId: "abc" }) === "@abc" && getUserKey({}) === null);
  t("名前は表示名 → @ID の順", getUserName({ nickname: "さくら", uniqueId: "s" }) === "さくら" && getUserName({ uniqueId: "s" }) === "s" && getUserName(null) === "名無し");
  t("アイコンはイベントの種類ごとの場所から読む", getUserAvatar({ avatarThumb: { urlList: ["a.png"] } }) === "a.png" && getUserAvatar({}) === "");

  const v2 = { repeatCount: 3, repeatEnd: true, giftDetails: { giftName: "ローズ", diamondCount: 1, giftType: 1, icon: { url: ["r.webp"] } } };
  t("ギフト（v2 の giftDetails）", getGiftName(v2) === "ローズ" && getGiftCoin(v2) === 1 && getGiftPictureUrl(v2) === "r.webp");
  t("ギフト（v1 の gift）", getGiftName({ gift: { name: "GG", diamond_count: 1 } }) === "GG" && getGiftCoin({ gift: { diamond_count: 5 } }) === 5);
  t("コインが読めなければ 0", getGiftCoin({}) === 0 && getGiftCoin({ giftDetails: { diamondCount: "abc" } }) === 0);
  t("名前が読めなければ「ギフト」", getGiftName({}) === "ギフト");
  t("連打の途中は数えない", isStreakInProgress({ ...v2, repeatEnd: false }) && isStreakInProgress({ ...v2, repeatEnd: 0 }));
  t("連打の終わりは数える", !isStreakInProgress(v2));
  t("連打できないギフトはいつも数える", !isStreakInProgress({ repeatEnd: false, giftDetails: { giftType: 2 } }));
  t("repeatEnd が無ければ確定とみなす", !isStreakInProgress({ giftDetails: { giftType: 1 } }));
}

finish();
