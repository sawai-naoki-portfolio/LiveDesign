// public/js/studio/editor/me.js
// ログインしている自分の情報（名前・TikTok の @ID・オーバーレイの合鍵）と、TikTok の接続の様子。
import { api } from "./api.js";
import { formatDuration } from "../shared/template.js";

let me = null;
let connection = null;
const connectionListeners = new Set();

export async function loadMe() {
  me = (await api.me()).user;
  return me;
}

export const getMe = () => me;
export function setMe(user) {
  me = user;
}

/**
 * OBS / TikTok LIVE Studio に貼る URL。合鍵（k）で、ログインしなくても自分のデザインだと分かる。
 * 合鍵を作り直すと、前の URL は使えなくなる。
 */
export function overlayUrl(sceneId) {
  const p = new URLSearchParams({ id: sceneId, k: me?.overlayKey ?? "" });
  return `${overlayOrigin()}/overlay?${p}`;
}

/**
 * 手元で動かしているときは localhost ではなく 127.0.0.1 で渡す。
 * サーバーは既定で 127.0.0.1（IPv4）だけで待ち受けるが、TikTok LIVE Studio のリンクソースなどは
 * localhost を ::1（IPv6）として引くことがあり、そうなると何も表示されない。
 */
function overlayOrigin() {
  const { protocol, hostname, port } = location;
  if (hostname !== "localhost" && hostname !== "[::1]") return location.origin;
  return `${protocol}//127.0.0.1${port ? `:${port}` : ""}`;
}

/** サーバーから届いた接続の様子（WebSocket の state / connectionStatus） */
export const getConnection = () => connection;
export function setConnection(status) {
  connection = status;
  for (const fn of connectionListeners) fn(status);
}
/** 接続の様子が変わったら呼ぶ。やめるときは戻り値を呼ぶ */
export function onConnection(fn) {
  connectionListeners.add(fn);
  return () => connectionListeners.delete(fn);
}

/** 接続の様子を、画面に出す一言と色にする */
export function describeConnection(status) {
  const s = status || {};
  const at = s.username ? `@${s.username}` : "";
  switch (s.state) {
    case "demo": return { tone: "ok", text: "🎮 デモモード（ダミーのイベントが流れています）" };
    case "unset": return { tone: "warn", text: "TikTok の @ID がまだ設定されていません（設定で @ID を入れて「接続」）" };
    case "idle": return { tone: "muted", text: `${at} — 画面を開くと繋ぎます` };
    case "connecting": return { tone: "muted", text: `${at} に接続しています…` };
    case "connected": return { tone: "ok", text: `🟢 ${at} の LIVE に接続中` };
    case "busy": return { tone: "warn", text: s.error || "接続が混み合っています" };
    case "waiting": {
      const left = s.nextRetryAt ? Math.max(0, s.nextRetryAt - Date.now()) : 0;
      const next = left ? `（次は ${formatDuration(left, "mm:ss")} 後）` : "";
      return s.error
        ? { tone: "error", text: `⚠ ${s.error}${next}` }
        : { tone: "muted", text: `⏳ ${at} の配信が始まるのを待っています${next}` };
    }
    default: return { tone: "muted", text: "—" };
  }
}
