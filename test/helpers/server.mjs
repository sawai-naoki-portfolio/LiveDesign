// test/helpers/server.mjs
// 本物のサーバーを空いているポートと一時フォルダで立てて、ブラウザの代わりに叩くための道具。
//
// server/config.js は import した瞬間に保存先を決めるので、**index.js を読む前に**環境変数を変える。
// 1つのテストファイル（=1プロセス）で1回だけ呼ぶこと（test/run.mjs が別プロセスで流す）。
import fs from "fs";
import os from "os";
import path from "path";

/**
 * @param {object} [opts]
 * @param {Record<string, string>} [opts.env] 追加の環境変数
 * @param {(dataDir: string) => void} [opts.beforeStart] データフォルダを用意する（以前のデータの引き継ぎの検査など）
 */
export async function bootServer({ env = {}, beforeStart } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "livedesign.test."));
  const dataDir = path.join(tmpRoot, "data");
  fs.mkdirSync(dataDir);
  for (const k of ["DEMO_MODE", "PUBLIC_URL", "REGISTRATION", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "EULER_API_KEY"]) {
    delete process.env[k];
  }
  Object.assign(process.env, { DATA_DIR: dataDir, PORT: "0", HOST: "127.0.0.1", ...env });
  beforeStart?.(dataDir);

  const { server } = await import("../../index.js");
  if (!server.listening) await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  return {
    base,
    port,
    dataDir,
    client: () => createClient(base),
    close() {
      server.closeAllConnections?.();
      server.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    },
  };
}

/** ログインの Cookie を覚えておく、ブラウザの代わり */
function createClient(base) {
  let cookie = "";

  async function req(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method,
      redirect: "manual",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(";")[0];
      const [name, value] = pair.split("=");
      if (name === "ld_session") cookie = value ? pair : "";
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* JSON ではない */ }
    return { status: res.status, data, headers: res.headers, setCookies: res.headers.getSetCookie?.() ?? [] };
  }

  const c = {
    req,
    get: (url, headers) => req("GET", url, undefined, headers),
    post: (url, body = {}, headers) => req("POST", url, body, headers),
    put: (url, body, headers) => req("PUT", url, body, headers),
    patch: (url, body, headers) => req("PATCH", url, body, headers),
    del: (url, body, headers) => req("DELETE", url, body, headers),
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; },
    async register(email, password = "password-123", extra = {}) {
      const r = await c.post("/api/auth/register", { email, password, ...extra });
      if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.data)}`);
      return r.data.user;
    },
    /** WebSocket を開く（エディタなら Cookie、オーバーレイなら query の合鍵） */
    async socket(query = "") {
      const { default: WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://${base.slice(7)}/${query ? `?${query}` : ""}`, { headers: cookie && !query ? { Cookie: cookie } : {} });
      const inbox = [];
      ws.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
      const closed = new Promise((resolve) => ws.once("close", (code) => resolve(code)));
      // 断られると open のあとすぐに 4401 で閉じる。state が届くか、閉じるまで待つ
      await new Promise((resolve) => {
        ws.once("error", resolve);
        ws.once("close", resolve);
        const timer = setInterval(() => {
          if (inbox.some((m) => m.type === "state")) { clearInterval(timer); resolve(); }
        }, 10);
        setTimeout(() => { clearInterval(timer); resolve(); }, 2000);
      });
      return {
        ws, inbox, closed,
        of: (type) => inbox.filter((m) => m.type === type),
        clear: () => { inbox.length = 0; },
        close: () => ws.close(),
      };
    },
  };
  return c;
}

/** broadcast は同期で送るが、届くのは次のイベントループ以降 */
export const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
