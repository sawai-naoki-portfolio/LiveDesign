// lib/auth/oauth.js
// 「Google でログイン」「TikTok でログイン」の受け渡し（OAuth 2.0 の認可コード方式）。
// 鍵（client id / secret）と戻り先は呼ぶ側から渡す。通信は fetch を差し替えてテストできる。
//
// TikTok の Login Kit で取れるのは open_id・表示名・アイコンまで（メールは取れない）。
// user.info.profile の権限をもらっていれば @ID（username）も取れるので、
// 取れたときはそのまま「つなぐ TikTok の @ID」に入れる（TikFinity と同じく入力の手間を減らす）。

/**
 * @typedef {object} OAuthProfile
 * @property {string} providerUserId
 * @property {string|null} email
 * @property {string} displayName
 * @property {string} avatarUrl
 * @property {string} [tiktokUsername]
 */

async function json(res, label) {
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* 下で失敗にする */ }
  if (!res.ok || !data) throw new Error(`${label}に失敗しました（${res.status}）`);
  return data;
}

export const google = {
  authorizeUrl({ clientId, redirectUri, state }) {
    const p = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: "code",
      scope: "openid email profile", state, prompt: "select_account",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  },

  /** @returns {Promise<OAuthProfile>} */
  async exchange({ code, clientId, clientSecret, redirectUri, fetchImpl = fetch }) {
    const token = await json(await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    }), "Google のトークン取得");
    if (!token.access_token) throw new Error("Google のトークンがありません");
    const me = await json(await fetchImpl("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    }), "Google の利用者情報の取得");
    if (!me.sub) throw new Error("Google の利用者 ID がありません");
    return {
      providerUserId: String(me.sub),
      // 確認済みのメールだけを使う（未確認のメールを信じると他人のアカウントに入れてしまう）
      email: me.email && me.email_verified !== false ? String(me.email).toLowerCase() : null,
      displayName: String(me.name || me.email || "Google ユーザー").slice(0, 60),
      avatarUrl: /^https:\/\//.test(me.picture || "") ? me.picture : "",
    };
  },
};

export const tiktok = {
  authorizeUrl({ clientKey, redirectUri, state, scopes = "user.info.basic" }) {
    const p = new URLSearchParams({
      client_key: clientKey, redirect_uri: redirectUri, response_type: "code", scope: scopes, state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${p}`;
  },

  /** @returns {Promise<OAuthProfile>} */
  async exchange({ code, clientKey, clientSecret, redirectUri, scopes = "user.info.basic", fetchImpl = fetch }) {
    const token = await json(await fetchImpl("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_key: clientKey, client_secret: clientSecret, code, grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    }), "TikTok のトークン取得");
    if (!token.access_token) throw new Error("TikTok のトークンがありません");
    const fields = ["open_id", "display_name", "avatar_url"];
    if (scopes.includes("user.info.profile")) fields.push("username");
    const body = await json(await fetchImpl(`https://open.tiktokapis.com/v2/user/info/?fields=${fields.join(",")}`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    }), "TikTok の利用者情報の取得");
    const u = body.data?.user;
    if (!u?.open_id) throw new Error("TikTok の利用者 ID がありません");
    return {
      providerUserId: String(u.open_id),
      email: null,
      displayName: String(u.display_name || "TikTok ユーザー").slice(0, 60),
      avatarUrl: /^https:\/\//.test(u.avatar_url || "") ? u.avatar_url : "",
      tiktokUsername: typeof u.username === "string" ? u.username : "",
    };
  },
};

/**
 * 入力された TikTok の @ID を整える。URL（https://www.tiktok.com/@name/live）や「@name」でも受け付ける。
 * @returns {string|null} 使えない形なら null（空文字は「設定を消す」）
 */
export function normalizeTikTokUsername(input) {
  let s = String(input ?? "").trim();
  if (s === "") return "";
  const fromUrl = /tiktok\.com\/@([^/?#\s]+)/i.exec(s);
  if (fromUrl) s = fromUrl[1];
  s = s.replace(/^@+/, "");
  return /^[A-Za-z0-9._]{2,24}$/.test(s) ? s : null;
}
