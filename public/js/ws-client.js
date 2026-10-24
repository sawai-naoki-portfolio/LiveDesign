// public/js/ws-client.js
// サーバーとの WebSocket（/studio と /overlay で共通）。サーバーからの配信を受け取るだけで、
// 画面からサーバーへの書き込みは REST（/api/studio/...）で送る。
// エディタはログインの Cookie で、OBS のオーバーレイは URL の合鍵（query の k）で本人を名乗る。
//
// サーバーを再起動したり回線が一瞬切れると、OBS のブラウザソースは何も表示しないまま
// 黙って止まる（手で再読み込みするまで戻らない）。配信中は気づけないので、切れたら
// 指数バックオフで自動で繋ぎ直す。繋がり直せば、サーバーが最初に送ってくる state で揃う。

const WS_RECONNECT_BASE_MS = 1000;
const WS_RECONNECT_MAX_MS = 15000;

/** 開いている URL から組み立てる（別の PC の OBS・ポートの変更・https でも繋がる） */
function serverUrl(query) {
  const base = location.protocol.startsWith("http")
    ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/`
    : "ws://localhost:3000/";
  return query ? `${base}?${query}` : base;
}

/**
 * サーバーに繋ぎ、切れたら繋ぎ直し続ける。
 * @param {object} handlers
 * @param {(data: object) => void} handlers.onMessage JSON として読めたメッセージ
 * @param {() => void} [handlers.onDisconnect] 切れたとき（繋ぎ直しを待つあいだの表示に使う）
 * @param {string} [handlers.query] 接続の URL に付ける query（オーバーレイの合鍵）
 * @param {(code: number) => boolean} [handlers.onRejected] 断られたとき（4401）。true を返すと繋ぎ直さない
 */
function connectServer({ onMessage, onDisconnect, query, onRejected }) {
  let attempts = 0;
  let reconnectTimer = null;

  function scheduleReconnect() {
    if (onDisconnect) onDisconnect();
    if (reconnectTimer) return;

    const delay = Math.min(WS_RECONNECT_BASE_MS * 2 ** attempts, WS_RECONNECT_MAX_MS);
    attempts++;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    const ws = new WebSocket(serverUrl(query));

    ws.addEventListener("open", () => {
      attempts = 0;
    });

    ws.addEventListener("close", (event) => {
      // 4401 はログイン切れ・合鍵の作り直し。繋ぎ直しても同じなので、画面に任せる
      if (event.code === 4401 && onRejected && onRejected(event.code)) return;
      scheduleReconnect();
    });

    // error のあとは close も来るが、来ない実装に備えて明示的に閉じる
    ws.addEventListener("error", () => {
      try { ws.close(); } catch (e) { /* すでに閉じている */ }
    });

    ws.addEventListener("message", (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      onMessage(data);
    });
  }

  connect();
}
