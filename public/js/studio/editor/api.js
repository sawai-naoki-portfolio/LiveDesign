// public/js/studio/editor/api.js
// サーバーの REST を呼ぶ小道具。ログインが切れていたら（401）ログイン画面へ戻す。

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* 本文なし */ }
  if (res.status === 401 && url !== "/api/auth/login" && !url.startsWith("/api/account")) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  // デザイン
  listScenes: () => request("GET", "/api/studio/scenes"),
  getScene: (id) => request("GET", `/api/studio/scenes/${encodeURIComponent(id)}`),
  createScene: (scene) => request("POST", "/api/studio/scenes", scene),
  saveScene: (id, scene) => request("PUT", `/api/studio/scenes/${encodeURIComponent(id)}`, scene),
  duplicateScene: (id) => request("POST", `/api/studio/scenes/${encodeURIComponent(id)}/duplicate`, {}),
  deleteScene: (id) => request("DELETE", `/api/studio/scenes/${encodeURIComponent(id)}`),
  testRule: (id, ruleId) => request("POST", `/api/studio/scenes/${encodeURIComponent(id)}/rules/${encodeURIComponent(ruleId)}/test`, {}),
  sendEvent: (event) => request("POST", "/api/studio/event", event),
  setVar: (body) => request("POST", "/api/studio/vars", body),
  resetStats: () => request("POST", "/api/studio/stats/reset", {}),
  listAssets: () => request("GET", "/api/studio/assets"),

  // ギミック（クリエイターモード）
  listGimmicks: ({ full = false } = {}) => request("GET", `/api/studio/gimmicks${full ? "?full=1" : ""}`),
  getGimmick: (id) => request("GET", `/api/studio/gimmicks/${encodeURIComponent(id)}`),
  createGimmick: (g) => request("POST", "/api/studio/gimmicks", g),
  saveGimmick: (id, g) => request("PUT", `/api/studio/gimmicks/${encodeURIComponent(id)}`, g),
  duplicateGimmick: (id) => request("POST", `/api/studio/gimmicks/${encodeURIComponent(id)}/duplicate`, {}),
  deleteGimmick: (id) => request("DELETE", `/api/studio/gimmicks/${encodeURIComponent(id)}`),
  deleteAsset: (name) => request("DELETE", `/api/studio/assets/${encodeURIComponent(name)}`),

  // アカウント
  me: () => request("GET", "/api/auth/me"),
  logout: () => request("POST", "/api/auth/logout", {}),
  updateAccount: (fields) => request("PATCH", "/api/account", fields),
  changePassword: (current, next) => request("POST", "/api/account/password", { current, next }),
  regenerateKey: (which) => request("POST", `/api/account/keys/${which}`, {}),
  deleteAccount: (body) => request("DELETE", "/api/account", body),

  // TikTok LIVE の接続
  liveStatus: () => request("GET", "/api/live/status"),
  liveRetry: () => request("POST", "/api/live/retry", {}),

  /** File を data URL にして送る */
  uploadAsset(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => request("POST", "/api/studio/assets", { name: file.name, data: reader.result })
        .then(resolve, reject);
      reader.readAsDataURL(file);
    });
  },
};
