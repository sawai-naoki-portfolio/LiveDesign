// test/auth-flow.test.mjs
// 会員登録・ログイン・アカウント設定が**本物のサーバーを通って**動くかの検査。`npm test` で実行する。
//   ・登録・ログイン・ログアウト・回数制限・セッションの Cookie
//   ・ページの出し分け（ログインしていなければログイン画面へ）
//   ・@ID・パスワード・合鍵・API キー・アカウントの削除
//   ・Google / TikTok でのログイン（受け取ったあとの処理）
//   ・1人用だった頃のデータを、最初の利用者が引き継ぐ
import fs from "fs";
import path from "path";
import { t, section, finish } from "./helpers/harness.mjs";
import { bootServer, settle } from "./helpers/server.mjs";

// 1人用だった頃のデータ（data/studio/）を置いてから起動する
const srv = await bootServer({
  beforeStart(dataDir) {
    const legacy = path.join(dataDir, "studio");
    fs.mkdirSync(path.join(legacy, "scenes"), { recursive: true });
    fs.mkdirSync(path.join(legacy, "assets"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "scenes", "old-scene-1.json"), JSON.stringify({
      id: "old-scene-1", name: "前からあったデザイン",
      elements: [{ id: "img", type: "image", src: "/studio-assets/logo.png" }], rules: [],
    }));
    fs.writeFileSync(path.join(legacy, "assets", "logo.png"), "png");
    fs.writeFileSync(path.join(legacy, "state.json"), JSON.stringify({ counters: { deaths: 3 }, timers: {} }));
  },
});
const { loginWithIdentity, findUserById } = await import("../server/auth.js");

section("新規登録");
const alice = srv.client();
{
  t("メールの形が違えば断る", (await alice.post("/api/auth/register", { email: "nope", password: "password-123" })).status === 400);
  t("短いパスワードは断る", (await alice.post("/api/auth/register", { email: "a@example.com", password: "short" })).status === 400);
  const r = await alice.post("/api/auth/register", { email: "Alice@Example.com", password: "password-123", displayName: "アリス" });
  t("登録できる（201）", r.status === 201 && r.data.user.email === "alice@example.com" && r.data.user.displayName === "アリス");
  const cookie = r.setCookies.find((c) => c.startsWith("ld_session=")) || "";
  t("セッションの Cookie は HttpOnly・SameSite=Lax", /HttpOnly/.test(cookie) && /SameSite=Lax/.test(cookie));
  t("ログイン状態になる", (await alice.get("/api/auth/me")).data?.user.email === "alice@example.com");
  t("合鍵と API キーが作られる", /^[A-Za-z0-9_-]{32}$/.test(r.data.user.overlayKey) && r.data.user.apiKey.startsWith("ld_"));
  t("パスワードのハッシュは返さない", !JSON.stringify(r.data).includes("scrypt"));
  t("同じメールでは登録できない（大文字小文字を区別しない）", (await srv.client().post("/api/auth/register", { email: "ALICE@example.com", password: "password-123" })).status === 409);
}

section("1人用だった頃のデータの引き継ぎ（最初の利用者）");
{
  const list = (await alice.get("/api/studio/scenes")).data;
  t("前からあったデザインが最初の利用者のものになる", list.length === 1 && list[0].name === "前からあったデザイン");
  const me = (await alice.get("/api/auth/me")).data.user;
  const scene = (await alice.get("/api/studio/scenes/old-scene-1")).data;
  t("素材の URL が利用者ごとのフォルダに変わる", scene.elements[0].src === `/studio-assets/${me.id}/logo.png`);
  t("素材のファイルも移る", fs.existsSync(path.join(srv.dataDir, "assets", me.id, "logo.png")));
  t("カウンターも引き継ぐ", (await alice.get("/api/studio/vars")).data.counters.deaths === 3);
  t("引き継いだ元のフォルダは片付ける", !fs.existsSync(path.join(srv.dataDir, "studio")) && fs.existsSync(path.join(srv.dataDir, "studio.migrated")));
  const bob = srv.client();
  await bob.register("bob-first@example.com");
  t("2人目の利用者には引き継がない", (await bob.get("/api/studio/scenes")).data.length === 0);
}

section("ログイン・ログアウト");
{
  const c = srv.client();
  t("パスワードが違えば断る", (await c.post("/api/auth/login", { email: "alice@example.com", password: "wrong-password" })).status === 401);
  t("知らないメールも同じ返事", (await c.post("/api/auth/login", { email: "nobody@example.com", password: "wrong-password" })).data.error === "メールアドレスかパスワードが違います");
  t("正しければログインできる", (await c.post("/api/auth/login", { email: "ALICE@example.com", password: "password-123" })).status === 200);
  const token = c.cookie;
  t("ログアウトできる", (await c.post("/api/auth/logout")).status === 200 && c.cookie === "");
  c.cookie = token;
  t("ログアウトしたセッションはもう使えない", (await c.get("/api/auth/me")).status === 401);

  const brute = srv.client();
  let last = 0;
  for (let i = 0; i < 11; i++) last = (await brute.post("/api/auth/login", { email: "target@example.com", password: `guess-${i}` })).status;
  t("同じ相手への総当たりは止める（429）", last === 429);
}

section("ページの出し分け");
{
  const guest = srv.client();
  const top = await guest.get("/");
  t("ログインしていなければ / はトップページ", top.status === 200);
  const studio = await guest.get("/studio?id=x");
  t("ログインしていなければ /studio はログイン画面へ", studio.status === 302 && studio.headers.get("location") === "/login?next=%2Fstudio%3Fid%3Dx");
  t("ログインしていれば / はスタジオへ", (await alice.get("/")).headers.get("location") === "/studio");
  t("ログインしていれば /login は戻り先へ", (await alice.get("/login?next=/studio%3Fid%3Dabc")).headers.get("location") === "/studio?id=abc");
  t("よそのサイトへは戻らない", (await alice.get("/login?next=//evil.example")).headers.get("location") === "/studio");
  t("API はログインが要る", (await guest.get("/api/studio/scenes")).status === 401);
  t("エディタはよそのページに埋め込ませない", (await guest.get("/login")).headers.get("x-frame-options") === "DENY");
  t("オーバーレイは埋め込める（OBS・LIVE Studio 用）", !(await guest.get("/overlay")).headers.get("x-frame-options"));
  const csp = (await guest.get("/login")).headers.get("content-security-policy") || "";
  t("画面は自分のスクリプトだけを動かす（CSP）", /script-src 'self'/.test(csp) && /object-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp));
  const overlayCsp = (await guest.get("/overlay")).headers.get("content-security-policy") || "";
  t("オーバーレイにも CSP を付ける（埋め込みは許す）", /script-src 'self'/.test(overlayCsp) && !/frame-ancestors/.test(overlayCsp));
}

section("アカウント設定");
{
  let r = await alice.patch("/api/account", { tiktokUsername: "https://www.tiktok.com/@alice.live" });
  t("TikTok の @ID は URL からでも入れられる", r.data.user.tiktokUsername === "alice.live");
  r = await alice.patch("/api/account", { tiktokUsername: "bad name!" });
  t("使えない @ID は断る", r.status === 400);
  t("表示名を変えられる", (await alice.patch("/api/account", { displayName: "  アリス2  " })).data.user.displayName === "アリス2");
  t("よそのページからの変更は断る", (await alice.patch("/api/account", { displayName: "x" }, { Origin: "http://evil.example" })).status === 403);

  // パスワードを変えると、ほかの端末のログインは切れる
  const other = srv.client();
  await other.post("/api/auth/login", { email: "alice@example.com", password: "password-123" });
  t("いまのパスワードが違えば変えられない", (await alice.post("/api/account/password", { current: "nope-nope", next: "new-password-1" })).status === 401);
  t("パスワードを変えられる", (await alice.post("/api/account/password", { current: "password-123", next: "new-password-1" })).status === 200);
  t("ほかの端末のログインは切れる", (await other.get("/api/auth/me")).status === 401);
  t("変えた端末はそのまま", (await alice.get("/api/auth/me")).status === 200);
  t("新しいパスワードでログインできる", (await srv.client().post("/api/auth/login", { email: "alice@example.com", password: "new-password-1" })).status === 200);

  // 合鍵を作り直すと、前の URL のオーバーレイは止まる
  const before = (await alice.get("/api/auth/me")).data.user;
  const overlay = await srv.client().socket(`k=${before.overlayKey}`);
  t("オーバーレイは合鍵で繋がる", overlay.of("state").length === 1 && overlay.of("state")[0].role === "overlay");
  const after = (await alice.post("/api/account/keys/overlay")).data.user;
  t("合鍵が変わる", after.overlayKey !== before.overlayKey);
  t("前の合鍵のオーバーレイは切られる", (await overlay.closed) === 4401);
  t("前の合鍵ではもう繋がらない", (await (await srv.client().socket(`k=${before.overlayKey}`)).closed) === 4401);
  t("前の合鍵ではデザインも読めない", (await srv.client().get(`/api/public/scenes/old-scene-1?k=${before.overlayKey}`)).status === 404);
  t("新しい合鍵では読める", (await srv.client().get(`/api/public/scenes/old-scene-1?k=${after.overlayKey}`)).status === 200);

  // API キー（外部ツール）
  const api = srv.client();
  t("API キーでイベントを送れる", (await api.post("/api/studio/event", { type: "follow" }, { Authorization: `Bearer ${after.apiKey}` })).status === 200);
  t("違うキーは断る", (await api.post("/api/studio/event", { type: "follow" }, { Authorization: "Bearer ld_wrong" })).status === 401);
  const byKey = { Authorization: `Bearer ${after.apiKey}` };
  t("API キーでカウンターを動かせる", (await api.post("/api/studio/vars", { kind: "counter", name: "deaths", op: "add", value: 1 }, byKey)).status === 200);
  t("API キーではアカウントの設定を変えられない（キーが漏れても乗っ取られない）",
    (await api.post("/api/account/password", { next: "hijacked-password" }, byKey)).status === 401 &&
    (await api.post("/api/account/keys/overlay", {}, byKey)).status === 401 &&
    (await api.del("/api/account", { confirm: "DELETE" }, byKey)).status === 401);
  t("API キーではデザインを読み書きできない", (await api.get("/api/studio/scenes", byKey)).status === 401 && (await api.del("/api/studio/scenes/old-scene-1", undefined, byKey)).status === 401);
  const newKey = (await alice.post("/api/account/keys/api")).data.user.apiKey;
  t("作り直すと前のキーは使えない", newKey !== after.apiKey && (await api.post("/api/studio/event", { type: "follow" }, { Authorization: `Bearer ${after.apiKey}` })).status === 401);
}

section("Google / TikTok でのログイン");
{
  t("鍵が無いときはボタンを出さない", JSON.stringify((await srv.client().get("/api/auth/providers")).data) === '{"google":false,"tiktok":false,"registration":true}');
  t("鍵が無いときは入口も無い", (await srv.client().get("/api/auth/google")).status === 404);

  const profile = { providerUserId: "tt-1", email: null, displayName: "ティックさん", avatarUrl: "", tiktokUsername: "@tick_live" };
  const u1 = loginWithIdentity("tiktok", profile, null);
  t("初めてなら利用者を作る", !!u1 && u1.displayName === "ティックさん");
  t("TikTok で取れた @ID をそのまま使う", u1.tiktokUsername === "tick_live");
  t("2回目は同じ利用者", loginWithIdentity("tiktok", profile, null).id === u1.id);

  const aliceUser = (await alice.get("/api/auth/me")).data.user;
  const g = loginWithIdentity("google", { providerUserId: "g-1", email: "alice@example.com", displayName: "G", avatarUrl: "" }, null);
  t("メールが同じでも既存のアカウントには自動で紐づけない（乗っ取り防止）", g.id !== aliceUser.id && g.email === null);
  t("ログイン中なら、その人に紐づける", loginWithIdentity("google", { providerUserId: "g-2", email: null, displayName: "x", avatarUrl: "" }, findUserById(aliceUser.id)).id === aliceUser.id);
  t("紐づけたあとは Google でアリスとしてログインできる", loginWithIdentity("google", { providerUserId: "g-2", email: null, displayName: "x", avatarUrl: "" }, null).id === aliceUser.id);
}

section("アカウントの削除");
{
  const carol = srv.client();
  const user = await carol.register("carol@example.com");
  const scene = (await carol.post("/api/studio/scenes", { name: "消えるデザイン" })).data;
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  await carol.post("/api/studio/assets", { name: "a.png", data: png });
  const editor = await carol.socket();
  t("パスワードが違えば消せない", (await carol.del("/api/account", { password: "wrong" })).status === 401);
  t("消せる", (await carol.del("/api/account", { password: "password-123" })).status === 200);
  t("開いていた画面は切られる", (await editor.closed) === 4401);
  t("ログインできなくなる", (await srv.client().post("/api/auth/login", { email: "carol@example.com", password: "password-123" })).status === 401);
  t("デザインも消える", (await srv.client().get(`/api/public/scenes/${scene.id}?k=${user.overlayKey}`)).status === 404);
  await settle();
  t("素材のフォルダも消える", !fs.existsSync(path.join(srv.dataDir, "assets", user.id)));
}

srv.close();
finish();
