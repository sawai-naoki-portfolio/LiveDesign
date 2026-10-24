// lib/tiktok.js
// TikTok LIVE 接続を作る。Euler Stream の API キー（運営のもの）で署名する。
// キーは利用者ごとではなく、このサービス全体で1つ（server/config.js の EULER_API_KEY）。
import { SignConfig, TikTokLiveConnection } from "tiktok-live-connector";

/**
 * @param {string} username 接続先の TikTok @ID（@なし）
 * @param {object} [options]
 * @param {string} [options.apiKey] Euler Stream の API キー（空なら無料の範囲で署名する）
 *   ほかは TikTokLiveConnection に渡すオプション
 * @returns {TikTokLiveConnection}
 */
export function createConnection(username, { apiKey, ...options } = {}) {
  if (!username) throw new Error("TikTok の @ID が設定されていません");
  if (apiKey) SignConfig.apiKey = apiKey;
  return new TikTokLiveConnection(username, options);
}
