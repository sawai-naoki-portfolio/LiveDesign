// test/auth-logic.test.mjs
// ログインまわりの計算の検査（パスワード・回数制限・Cookie・Google / TikTok ログイン・@ID の整え方）。
// `npm test` で実行する。サーバーを通した流れは auth-flow.test.mjs が見る。
import { t, section, finish } from "./helpers/harness.mjs";
import {
  hashPassword, verifyPassword, passwordProblem, randomToken, sha256,
} from "../lib/auth/password.js";
import { createRateLimiter } from "../lib/auth/rate-limit.js";
import { parseCookies, serializeCookie } from "../lib/auth/cookies.js";
import { google, tiktok, normalizeTikTokUsername } from "../lib/auth/oauth.js";

section("パスワード（lib/auth/password.js）");
{
  const hash = await hashPassword("correct horse");
  t("保存する形は scrypt$N$r$p$塩$ハッシュ", /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/.test(hash));
  t("同じパスワードでも塩が違うので毎回違う", hash !== (await hashPassword("correct horse")));
  t("正しいパスワードは通る", await verifyPassword("correct horse", hash));
  t("違うパスワードは通らない", !(await verifyPassword("correct horsE", hash)));
  t("壊れた保存値は通らない（例外にしない）", !(await verifyPassword("x", "garbage")) && !(await verifyPassword("x", null)));
  t("短すぎるパスワードは断る", passwordProblem("1234567") !== null && passwordProblem("12345678") === null);
  t("長すぎるパスワードは断る", passwordProblem("x".repeat(201)) !== null);
  t("合鍵は URL に入れられる文字だけ", /^[A-Za-z0-9_-]{32}$/.test(randomToken(24)));
  t("合鍵は毎回違う", randomToken() !== randomToken());
  t("sha256", sha256("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
}

section("回数制限（lib/auth/rate-limit.js）");
{
  let now = 0;
  const rl = createRateLimiter({ windowMs: 1000, max: 3, now: () => now });
  t("上限までは通す", rl.hit("a") && rl.hit("a") && rl.hit("a"));
  t("上限を超えたら止める", !rl.hit("a"));
  t("別の鍵は別に数える", rl.hit("b"));
  t("待つ秒数を返す", rl.retryAfter("a") === 1);
  now = 1001;
  t("時間が過ぎたら戻る", rl.hit("a"));
  rl.hit("a"); rl.hit("a"); rl.hit("a");
  rl.reset("a");
  t("成功したら数え直せる", rl.hit("a"));
}

section("Cookie（lib/auth/cookies.js）");
{
  const c = parseCookies("a=1; ld_session=abc%3D; empty=; =bad; broken=%E0");
  t("読める", c.a === "1" && c.ld_session === "abc=" && c.empty === "");
  t("壊れた値でも落ちない", c.broken === "%E0");
  t("名前の無いものは捨てる", !("" in c));
  const s = serializeCookie("ld_session", "x y", { maxAgeMs: 90_500, secure: true });
  t("HttpOnly と SameSite=Lax が既定", s.includes("HttpOnly") && s.includes("SameSite=Lax"));
  t("Secure・Max-Age・Path", s.includes("Secure") && s.includes("Max-Age=90") && s.includes("Path=/") && s.startsWith("ld_session=x%20y"));
  t("Secure は指定したときだけ", !serializeCookie("a", "b").includes("Secure"));
}

section("TikTok の @ID の整え方");
{
  t("@ を外す", normalizeTikTokUsername("@naoki_live") === "naoki_live");
  t("URL から取り出す", normalizeTikTokUsername("https://www.tiktok.com/@naoki.live/live?lang=ja") === "naoki.live");
  t("前後の空白を消す", normalizeTikTokUsername("  abc  ") === "abc");
  t("空は「消す」", normalizeTikTokUsername("") === "");
  t("使えない文字は断る", normalizeTikTokUsername("na oki") === null && normalizeTikTokUsername("<script>") === null && normalizeTikTokUsername("a") === null);
}

section("Google / TikTok でログイン（lib/auth/oauth.js）");
{
  const gUrl = new URL(google.authorizeUrl({ clientId: "cid", redirectUri: "https://x.test/cb", state: "st" }));
  t("Google：認可 URL", gUrl.host === "accounts.google.com" && gUrl.searchParams.get("state") === "st" && gUrl.searchParams.get("scope").includes("email"));
  const tUrl = new URL(tiktok.authorizeUrl({ clientKey: "ck", redirectUri: "https://x.test/cb", state: "st" }));
  t("TikTok：認可 URL", tUrl.host === "www.tiktok.com" && tUrl.searchParams.get("client_key") === "ck" && tUrl.searchParams.get("scope") === "user.info.basic");

  // 通信の偽物。URL ごとに返す中身を決める
  const fake = (routes) => async (url, opts) => {
    const key = Object.keys(routes).find((k) => String(url).startsWith(k));
    const [status, body] = routes[key] ?? [404, {}];
    fake.calls.push({ url: String(url), opts });
    return { ok: status < 400, status, text: async () => JSON.stringify(body) };
  };
  fake.calls = [];

  const gProfile = await google.exchange({
    code: "c", clientId: "cid", clientSecret: "sec", redirectUri: "https://x.test/cb",
    fetchImpl: fake({
      "https://oauth2.googleapis.com/token": [200, { access_token: "AT" }],
      "https://www.googleapis.com/oauth2/v3/userinfo": [200, { sub: "123", email: "A@Example.com", email_verified: true, name: "Aさん", picture: "https://img.test/a.png" }],
    }),
  });
  t("Google：利用者情報", gProfile.providerUserId === "123" && gProfile.email === "a@example.com" && gProfile.displayName === "Aさん" && gProfile.avatarUrl === "https://img.test/a.png");
  t("Google：トークンを Authorization で送る", fake.calls.some((c) => c.opts?.headers?.Authorization === "Bearer AT"));

  const unverified = await google.exchange({
    code: "c", clientId: "cid", clientSecret: "sec", redirectUri: "r",
    fetchImpl: fake({
      "https://oauth2.googleapis.com/token": [200, { access_token: "AT" }],
      "https://www.googleapis.com/oauth2/v3/userinfo": [200, { sub: "9", email: "b@example.com", email_verified: false }],
    }),
  });
  t("Google：確認されていないメールは使わない", unverified.email === null);

  let threw = false;
  try {
    await google.exchange({ code: "c", clientId: "cid", clientSecret: "sec", redirectUri: "r", fetchImpl: fake({ "https://oauth2.googleapis.com/token": [400, { error: "invalid_grant" }] }) });
  } catch (e) { threw = true; }
  t("Google：失敗は例外にする", threw);

  const tProfile = await tiktok.exchange({
    code: "c", clientKey: "ck", clientSecret: "sec", redirectUri: "r", scopes: "user.info.basic,user.info.profile",
    fetchImpl: fake({
      "https://open.tiktokapis.com/v2/oauth/token/": [200, { access_token: "TT" }],
      "https://open.tiktokapis.com/v2/user/info/": [200, { data: { user: { open_id: "oid", display_name: "なおき", avatar_url: "javascript:alert(1)", username: "naoki_live" } } }],
    }),
  });
  t("TikTok：利用者情報（メールは無い）", tProfile.providerUserId === "oid" && tProfile.email === null && tProfile.displayName === "なおき");
  t("TikTok：profile の権限があれば @ID も取る", tProfile.tiktokUsername === "naoki_live" && fake.calls.at(-1).url.includes("username"));
  t("TikTok：https でないアイコンは使わない", tProfile.avatarUrl === "");
}

finish();
