// lib/auth/cookies.js
// Cookie の読み書き（express の外の WebSocket の接続でも使うので、小さく自前で持つ）。

/** "a=1; b=2" → { a: "1", b: "2" } */
export function parseCookies(header) {
  const out = Object.create(null);
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(i + 1).trim());
    } catch (e) {
      out[name] = part.slice(i + 1).trim();
    }
  }
  return out;
}

/**
 * Set-Cookie の値を作る。
 * @param {string} name
 * @param {string} value
 * @param {{maxAgeMs?: number, secure?: boolean, sameSite?: "Lax"|"Strict"|"None", path?: string, httpOnly?: boolean}} [opts]
 */
export function serializeCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? "/"}`];
  if (opts.maxAgeMs !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeMs / 1000))}`);
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  parts.push(`SameSite=${opts.sameSite ?? "Lax"}`);
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}
