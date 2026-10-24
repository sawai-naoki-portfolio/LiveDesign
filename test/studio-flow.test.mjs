// test/studio-flow.test.mjs
// スタジオが**本物のサーバーを通って**、利用者ごとに分かれて動くかの検査。`npm test` で実行する。
//
//   ・デザイン・素材・カウンターは本人のものだけ（他人のものは読めない・書けない・届かない）
//   ・TikTok LIVE の接続は、@ID があって画面が開いている人だけ。配信が始まるまで待って繋ぎ直す
//   ・同じ @ID を入れた人が何人いても接続は1本で、届いたイベントを全員に配る
//   ・TikTok 形式のイベントから、その人のルールが発火して、その人の画面にだけ届く
//   ・REST の守り（よそのページ・JSON 以外・危ない素材）と、利用者ごとの上限
import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import { t, section, finish } from "./helpers/harness.mjs";
import { bootServer, settle } from "./helpers/server.mjs";

const srv = await bootServer({ env: { MAX_SCENES_PER_USER: "3", STORAGE_QUOTA_MB: "1" } });
const { setConnectionFactory, setLiveTimings } = await import("../server/live.js");
const { startDemoMode } = await import("../server/demo.js");

// TikTok LIVE の接続の代わり。本物と同じ名前・同じ形のイベントを流す
const fakes = [];
let offline = new Set(); // この @ID は「配信していない」
setConnectionFactory((username) => {
  const conn = new EventEmitter();
  conn.username = username;
  conn.disconnected = false;
  conn.connect = async () => {
    if (offline.has(username)) throw new Error("The requested user isn't online :(");
    conn.emit("connected", { roomId: conn.roomId ?? "room-1" });
    return { roomId: "room-1" };
  };
  conn.disconnect = () => { conn.disconnected = true; };
  fakes.push(conn);
  return conn;
});
setLiveTimings({ stopGraceMs: 300, retryStepsMs: [200, 200], retryMaxMs: 200, reconnectAfterDropMs: 100 });
const fakeOf = (username) => fakes.filter((f) => f.username === username && !f.disconnected).at(-1);

const viewer = (name) => ({ userId: `v:${name}`, uniqueId: name, nickname: name, profilePictureUrl: `https://cdn.test/${name}.png` });
const gift = (name, diamondCount, repeatCount = 1, extra = {}) => ({
  user: viewer(extra.from || "ゆうき"), repeatCount, repeatEnd: extra.repeatEnd ?? true,
  giftDetails: { giftName: name, diamondCount, giftType: extra.giftType ?? 2, icon: { url: [`https://cdn.test/${name}.webp`] } },
});

const alice = srv.client();
const bob = srv.client();
const aliceUser = await alice.register("alice@example.com");
const bobUser = await bob.register("bob@example.com");

section("デザインの保存（本人のものだけ）");
let scene;
{
  const res = await alice.post("/api/studio/scenes", {
    name: "アリスの配信",
    elements: [{ id: "al", type: "alert" }, { id: "tx", type: "text", text: "❤ {likes}" }],
    rules: [
      { id: "f", name: "フォロー", trigger: { type: "follow" }, actions: [
        { kind: "alert", target: "al", title: "{user}", message: "ありがとう" },
        { kind: "counter", name: "fans", amount: 1 },
      ] },
      { id: "g", name: "大きなギフト", trigger: { type: "gift", minCoins: 100 }, actions: [
        { kind: "particles", preset: "confetti" },
        { kind: "timer", name: "sub", op: "add", seconds: 2, per: "coins" },
      ] },
      { id: "c", name: "!jump", trigger: { type: "chat", match: "command", keyword: "!jump" }, actions: [{ kind: "animate", target: "tx", animation: "bounce" }] },
      { id: "l", name: "いいね", trigger: { type: "like", likeEvery: 100 }, actions: [{ kind: "particles", preset: "hearts" }] },
    ],
  });
  scene = res.data;
  t("作れる（201）", res.status === 201 && /^[a-z0-9-]+$/.test(scene.id));
  t("一覧に出る", (await alice.get("/api/studio/scenes")).data.some((s) => s.id === scene.id && s.rules === 4));
  t("他人の一覧には出ない", (await bob.get("/api/studio/scenes")).data.length === 0);
  t("他人は読めない", (await bob.get(`/api/studio/scenes/${scene.id}`)).status === 404);
  t("他人は上書きできない", (await bob.put(`/api/studio/scenes/${scene.id}`, { name: "乗っ取り" })).status === 404);
  t("他人は消せない", (await bob.del(`/api/studio/scenes/${scene.id}`)).status === 404);
  t("他人は複製できない", (await bob.post(`/api/studio/scenes/${scene.id}/duplicate`)).status === 404);
  t("他人はルールを試せない", (await bob.post(`/api/studio/scenes/${scene.id}/rules/g/test`)).status === 404);
  t("中身は無事", (await alice.get(`/api/studio/scenes/${scene.id}`)).data.name === "アリスの配信");

  const aliceEditor = await alice.socket();
  const bobEditor = await bob.socket();
  const put = await alice.put(`/api/studio/scenes/${scene.id}`, { ...scene, name: "名前を変えた" });
  await settle();
  t("上書きできる", put.status === 200);
  t("本人の画面に配られる", aliceEditor.of("studioScene").some((m) => m.scene.name === "名前を変えた"));
  t("他人の画面には配られない", bobEditor.of("studioScene").length === 0);
  t("知らない ID の上書きは 404（PUT で新しく作れない）", (await alice.put("/api/studio/scenes/new-id-123", { name: "x" })).status === 404);
  t("ID の形が違えば 400", (await alice.put("/api/studio/scenes/..%2F..%2Fx", {})).status === 400);

  await alice.post("/api/studio/scenes", { name: "2つ目" });
  await alice.post("/api/studio/scenes", { name: "3つ目" });
  t("1人あたりのデザインの数に上限がある", (await alice.post("/api/studio/scenes", { name: "4つ目" })).status === 409);
  aliceEditor.close();
  bobEditor.close();
}

section("オーバーレイ（OBS）は合鍵で読む");
{
  t("合鍵が合えば読める（ログイン不要）", (await srv.client().get(`/api/public/scenes/${scene.id}?k=${aliceUser.overlayKey}`)).status === 200);
  t("他人の合鍵では読めない", (await srv.client().get(`/api/public/scenes/${scene.id}?k=${bobUser.overlayKey}`)).status === 404);
  t("合鍵が無ければ読めない", (await srv.client().get(`/api/public/scenes/${scene.id}`)).status === 404);
  const bad = await srv.client().socket("k=wrong-key");
  t("違う合鍵の WebSocket は断る", (await bad.closed) === 4401);
  const anon = await srv.client().socket();
  t("ログインも合鍵も無い WebSocket は断る", (await anon.closed) === 4401);
}

section("書き込みの守り");
{
  t("よそのページからの書き込みは断る", (await alice.post("/api/studio/scenes", {}, { Origin: "http://evil.example" })).status === 403);
  // よそのページのフォームは、プリフライト無しで text/plain の本文を Cookie 付きで送れる
  const plain = await fetch(`${srv.base}/api/studio/event`, {
    method: "POST", headers: { "Content-Type": "text/plain", Cookie: alice.cookie }, body: '{"type":"follow"}',
  });
  t("JSON 以外の本文は断る（プリフライト無しで送れる形）", plain.status === 415);
  t("同じページからの書き込みは通る", (await alice.post("/api/studio/event", { type: "join" }, { Origin: srv.base })).status === 200);
  const huge = await fetch(`${srv.base}/api/studio/scenes`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "x".repeat(3 * 1024 * 1024) }),
  });
  t("ログインしていなければ、本文を読む前に断る", huge.status === 401);
  const broken = await fetch(`${srv.base}/api/studio/scenes`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: alice.cookie }, body: "{broken",
  });
  const brokenBody = await broken.json().catch(() => null);
  t("壊れた JSON は 400 を JSON で返す（中身やスタックトレースは見せない）", broken.status === 400 && typeof brokenBody?.error === "string" && !/at |SyntaxError/.test(brokenBody.error));
  const unknown = await alice.get("/api/studio/no-such-thing");
  t("知らない API は JSON の 404", unknown.status === 404 && unknown.data?.error === "not found");
  const chatty = await alice.socket();
  chatty.ws.send("x".repeat(64 * 1024));
  t("WebSocket に大きなものを送ってくる画面は切る", (await chatty.closed) === 1009);
}

section("TikTok LIVE の接続（@ID があって、画面が開いている間だけ）");
let aliceEditor;
let bobEditor;
{
  aliceEditor = await alice.socket();
  await settle();
  t("@ID が無ければ繋がない", fakes.length === 0 && aliceEditor.of("state")[0].connection.state === "unset");
  aliceEditor.clear();
  await alice.patch("/api/account", { tiktokUsername: "alice_live" });
  await settle();
  t("@ID を入れると、その @ID に繋ぐ", fakes.length === 1 && fakes[0].username === "alice_live");
  t("繋がったことが本人の画面に届く", aliceEditor.of("connectionStatus").some((m) => m.state === "connected" && m.username === "alice_live"));

  offline.add("bob_live");
  await bob.patch("/api/account", { tiktokUsername: "bob_live" });
  await settle();
  t("画面を開いていない人には繋がない", !fakes.some((f) => f.username === "bob_live"));
  bobEditor = await bob.socket();
  await settle(100);
  const bobStatus = bobEditor.of("connectionStatus").at(-1);
  t("配信していなければ「待っています」（エラーにしない）", bobStatus?.state === "waiting" && bobStatus.error === "" && bobStatus.nextRetryAt > 0);
  t("アリスの画面には、ボブの接続の様子は届かない", !aliceEditor.of("connectionStatus").some((m) => m.username === "bob_live"));
  offline.delete("bob_live");
  await settle(400);
  t("配信が始まれば、待ったあと自動で繋がる", bobEditor.of("connectionStatus").some((m) => m.state === "connected"));
}

section("TikTok のイベントから、その人のルールが動く");
{
  aliceEditor.clear();
  bobEditor.clear();
  const conn = fakeOf("alice_live");
  conn.emit("follow", { user: viewer("さくら") });
  await settle();
  const action = aliceEditor.of("studioAction").find((m) => m.ruleId === "f");
  t("フォロー → アラートのアクションが本人に届く", action?.sceneId === scene.id && action.actions.length === 1 && action.actions[0].kind === "alert");
  t("カウンターはサーバーで済ませる", aliceEditor.of("studioVars").some((m) => m.vars.counters.fans === 1 && m.vars.stats.followers === 1));
  t("他人の画面には何も届かない", bobEditor.inbox.length === 0);
  t("配るイベントに視聴者の ID は載せない", !JSON.stringify(aliceEditor.inbox).includes("v:さくら"));

  aliceEditor.clear();
  conn.emit("gift", gift("ドーナツ", 30, 2));
  await settle();
  t("60コインのギフトでは 100 コイン以上のルールは動かない", !aliceEditor.of("studioAction").some((m) => m.ruleId === "g"));
  conn.emit("gift", gift("ライオン", 100));
  await settle();
  t("100コインのギフトで動く", aliceEditor.of("studioAction").some((m) => m.ruleId === "g"));
  const vars = aliceEditor.of("studioVars").at(-1)?.vars;
  t("タイマーがコイン数に応じて延びる（100コイン × 2秒）", vars?.timers.sub?.remaining >= 199_000);
  t("ランキングに積まれる", vars?.top[0]?.name === "ゆうき" && vars.top[0].coins === 160);

  aliceEditor.clear();
  for (let i = 1; i <= 5; i++) conn.emit("gift", gift("ローズ", 1, i, { from: "ミク", giftType: 1, repeatEnd: i === 5 }));
  await settle();
  const roses = aliceEditor.of("studioEvent").filter((m) => m.event.gift?.name === "ローズ");
  t("連打ギフトは終わったときの1回だけ（ローズ×5 = 5コイン）", roses.length === 1 && roses[0].event.coins === 5);

  aliceEditor.clear();
  conn.emit("chat", { user: viewer("タロウ"), comment: "!jump" });
  conn.emit("chat", { user: viewer("タロウ"), comment: "!jumping" });
  conn.emit("like", { user: viewer("ミク"), likeCount: 60, totalLikeCount: 60 });
  conn.emit("like", { user: viewer("ミク"), likeCount: 60, totalLikeCount: 120 });
  conn.emit("envelope", { envelopeInfo: { sendUserId: "99", sendUserName: "宝箱さん", diamondCount: 300 } });
  conn.emit("gift", null);
  conn.emit("like", undefined);
  await settle();
  t("コマンドのコメントで動く（似た別の言葉では動かない）", aliceEditor.of("studioAction").filter((m) => m.ruleId === "c").length === 1);
  t("いいね 100 ごとに1回", aliceEditor.of("studioAction").filter((m) => m.ruleId === "l").length === 1);
  t("宝箱も届く", aliceEditor.of("studioEvent").some((m) => m.event.type === "envelope" && m.event.coins === 300));
  t("壊れたイベントでも落ちない", (await alice.get("/api/auth/me")).status === 200);

  // ボブの接続から来たものは、ボブにだけ
  aliceEditor.clear();
  bobEditor.clear();
  fakeOf("bob_live").emit("chat", { user: viewer("ボブの視聴者"), comment: "こんにちは" });
  await settle();
  t("ボブの配信のコメントはボブにだけ届く", bobEditor.of("studioEvent").length === 1 && aliceEditor.of("studioEvent").length === 0);

  const second = await alice.socket();
  const snap = second.of("state")[0].studio;
  second.close();
  t("繋いだときの state に、その人のチャットが残っている", snap.recentChats.length === 2 && snap.recentChats.every((c) => c.user.name === "タロウ"));
  t("いいねは配信の累計", snap.vars.stats.likes === 120);
}

section("同じ @ID は1本の接続をみんなで読む（@ID だけで、誰の公開 LIVE でも読める）");
{
  const carol = srv.client();
  await carol.register("carol@example.com");
  const carolEditor = await carol.socket();
  const before = fakes.length;
  const res = await carol.patch("/api/account", { tiktokUsername: "@Alice_Live" });
  await settle();
  t("本人確認なしで、他人の @ID も入れられる（TikTok のログインは要らない）", res.status === 200 && res.data.user.tiktokUsername === "Alice_Live");
  t("同じ @ID なら新しく繋がない（大文字小文字は同じとみなす）", fakes.length === before);
  t("すでに繋がっていれば、すぐ「接続中」になる", carolEditor.of("connectionStatus").some((m) => m.state === "connected" && m.username === "Alice_Live"));

  aliceEditor.clear();
  bobEditor.clear();
  carolEditor.clear();
  fakeOf("alice_live").emit("chat", { user: viewer("ひなた"), comment: "こんばんは" });
  await settle();
  t("届いたイベントは、その @ID を読んでいる全員に配る",
    aliceEditor.of("studioEvent").length === 1 && carolEditor.of("studioEvent").length === 1);
  t("ボブには届かない", !bobEditor.of("studioEvent").length);

  carolEditor.close();
  await settle(450);
  t("片方が画面を閉じても、もう片方の接続はそのまま", !!fakeOf("alice_live") && fakes.length === before);
  t("抜けた人は「画面を開くと繋ぎます」に戻る", (await carol.get("/api/live/status")).data.state === "idle");
  t("「今すぐ繋ぐ」は抜けた人には効かない", (await carol.post("/api/live/retry")).data.ok === false);
}

section("配信の切り替わり・@ID の変更・画面を閉じたとき");
{
  const conn = fakeOf("alice_live");
  conn.emit("connected", { roomId: "room-1" });
  t("同じ配信へ繋ぎ直しても数字は消さない", (await alice.get("/api/studio/vars")).data.stats.followers === 1);
  conn.emit("connected", { roomId: "room-2" });
  const vars = (await alice.get("/api/studio/vars")).data;
  t("新しい配信で今回の数字とランキングを消す", vars.stats.followers === 0 && vars.top.length === 0);
  t("カウンターとタイマーは残す", vars.counters.fans === 1);

  conn.emit("disconnected");
  await settle(300);
  t("配信の途中で切れたら、すぐに繋ぎ直す", fakes.filter((f) => f.username === "alice_live").length >= 2 && !!fakeOf("alice_live"));

  await alice.patch("/api/account", { tiktokUsername: "alice_second" });
  await settle();
  t("@ID を変えると、前の接続を切って新しい @ID に繋ぐ", fakes.filter((f) => f.username === "alice_live").every((f) => f.disconnected) && !!fakeOf("alice_second"));
}

section("素材（本人のフォルダに）");
{
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const up = await alice.post("/api/studio/assets", { name: "カメラ枠.png", data: png });
  t("画像を置ける", up.status === 201 && up.data.url.startsWith(`/studio-assets/${aliceUser.id}/`));
  t("本人の一覧に出る", (await alice.get("/api/studio/assets")).data.some((a) => a.name === up.data.name));
  t("他人の一覧には出ない", (await bob.get("/api/studio/assets")).data.length === 0);
  t("他人は消せない", (await bob.del(`/api/studio/assets/${encodeURIComponent(up.data.name)}`)).status === 404);
  const got = await fetch(srv.base + up.data.url);
  t("配られる（nosniff 付き）", got.status === 200 && got.headers.get("x-content-type-options") === "nosniff" && got.headers.get("content-type") === "image/png");
  t("SVG（中にスクリプトを書ける）は断る", (await alice.post("/api/studio/assets", { name: "x.svg", data: "data:image/svg+xml;base64,PHN2Zy8+" })).status === 415);
  t("素材フォルダの外は消せない", (await alice.del("/api/studio/assets/..%2F..%2Flivedesign.db")).status === 404);
  t("データベースは配られない", (await fetch(`${srv.base}/studio-assets/%2E%2E/livedesign.db`)).status === 404);
  const big = `data:audio/mpeg;base64,${Buffer.alloc(700 * 1024).toString("base64")}`;
  t("容量の範囲なら置ける", (await alice.post("/api/studio/assets", { name: "a.mp3", data: big })).status === 201);
  t("1人あたりの容量を超えたら断る", (await alice.post("/api/studio/assets", { name: "b.mp3", data: big })).status === 413);
  t("消せる", (await alice.del(`/api/studio/assets/${encodeURIComponent(up.data.name)}`)).status === 200 && !fs.existsSync(path.join(srv.dataDir, "assets", aliceUser.id, up.data.name)));
}

section("テスト用の口");
{
  const editor = await alice.socket();
  editor.clear();
  const res = await alice.post(`/api/studio/scenes/${scene.id}/rules/g/test`);
  await settle();
  t("ルールのテストボタンでそのルールだけ動く", res.status === 200 && editor.of("studioAction").length === 1 && editor.of("studioAction")[0].ruleId === "g");
  editor.clear();
  await alice.post("/api/studio/event", { type: "chat", user: { name: "テスト" }, text: "!jump 3" });
  await settle();
  t("イベントを流すと本番と同じ判定を通る", editor.of("studioAction").some((m) => m.ruleId === "c" && m.extra.args === "3"));
  t("知らない種類のイベントは断る", (await alice.post("/api/studio/event", { type: "hack" })).status === 400);
  t("カウンターを手で動かせる", (await alice.post("/api/studio/vars", { kind: "counter", name: "deaths", op: "set", value: 7 })).data.vars.counters.deaths === 7);
  t("他人のカウンターは別", (await bob.get("/api/studio/vars")).data.counters.deaths === undefined);
  t("予約語のカウンターは断る", (await alice.post("/api/studio/vars", { kind: "counter", name: "likes", op: "set", value: 1 })).status === 400);
  editor.close();
}

section("画面を閉じたら少し待って切る");
{
  aliceEditor.close();
  bobEditor.close();
  await settle(100);
  t("閉じてすぐには切らない（OBS のシーン切り替えのたびに繋ぎ直さないように）", !fakeOf("bob_live")?.disconnected && !!fakeOf("alice_second"));
  const reopened = await alice.socket();
  await settle(400);
  t("待っている間に開き直せば、そのまま使う", !!fakeOf("alice_second") && fakes.filter((f) => f.username === "alice_second").length === 1);
  t("誰も見ていない人の接続は切る", fakes.filter((f) => f.username === "bob_live").every((f) => f.disconnected));
  reopened.close();
}

section("デモモード");
{
  const editor = await alice.socket();
  startDemoMode();
  await settle(4500); // いいねは 2〜4 秒おき
  t("画面を開いている人にデモのイベントが届く", editor.of("studioEvent").some((m) => m.event.type === "like"));
  editor.close();
}

srv.close();
finish();
