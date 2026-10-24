// public/js/studio/creator/console.js
// 下の「コンソール」：ギミックが書いたログ（「コンソールに書く」ノード・式のまちがい）と、
// 再生中に合図や TikTok LIVE のイベントを流して試すボタン（配信しなくても動きを確かめられる）。
import { cstore, onC } from "./state.js";
import { h } from "../editor/ui.js";
import { signalNames } from "../shared/gimmick/defaults.js";

const MAX_LINES = 300;

/**
 * @param {HTMLElement} root
 * @param {{signal: (name: string, payload: object) => number, liveEvent: (ev: object) => void, start: () => void}} opts
 */
export function initConsole(root, opts) {
  const lines = h("div", { class: "cr-log" });
  const user = h("input", { type: "text", value: "テスト視聴者", class: "cr-test-user", title: "イベントを送った人の名前（{user}）" });
  const sigName = h("input", { type: "text", placeholder: "合図の名前", class: "cr-test-sig", list: "cr-signals" });
  const sigButtons = h("span", { class: "cr-sig-buttons" });
  const giftName = h("input", { type: "text", value: "ローズ", class: "cr-test-small", title: "ギフト名" });
  const giftCoins = h("input", { type: "number", value: "1", min: 0, class: "cr-test-num", title: "1個のコイン" });
  const giftCount = h("input", { type: "number", value: "1", min: 1, class: "cr-test-num", title: "個数" });
  const comment = h("input", { type: "text", value: "!jump", class: "cr-test-small", title: "コメント" });

  function log(text, level = "info") {
    const t = new Date();
    const stamp = `${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
    lines.appendChild(h("div", { class: `cr-log-line ${level}` }, h("span", { class: "cr-log-time" }, stamp), String(text)));
    while (lines.childElementCount > MAX_LINES) lines.firstChild.remove();
    lines.scrollTop = lines.scrollHeight;
  }

  const ensurePlaying = () => {
    if (cstore.play === "stopped") {
      opts.start();
      log("▶ 再生を始めました（イベントは再生中だけ届きます）", "sys");
    }
  };

  const person = () => ({ name: user.value.trim() || "テスト視聴者", handle: "test", avatar: "" });
  function sendLive(ev) {
    ensurePlaying();
    // 再生を始めた直後は世界ができるのを待ってから渡す
    setTimeout(() => {
      opts.liveEvent({ id: `t${Date.now()}`, test: true, user: person(), ...ev });
      log(`→ ${ev.label}`, "sys");
    }, 30);
  }

  function sendSignal(name) {
    if (!name) return;
    ensurePlaying();
    setTimeout(() => {
      const n = opts.signal(name, { user: person().name, count: 1, coins: 1, gift: "ローズ", comment: "", args: "" });
      log(n ? `→ 合図「${name}」（${n} 個のイベントが動きました）` : `→ 合図「${name}」を受けるイベントがありません`, n ? "sys" : "warn");
    }, 30);
  }

  const sigBtn = h("button", { type: "button", class: "small-btn", onclick: () => sendSignal(sigName.value.trim()) }, "📡 送る");
  sigName.addEventListener("keydown", (e) => { if (e.key === "Enter") sigBtn.click(); });

  function renderSignals() {
    sigButtons.textContent = "";
    for (const name of signalNames(cstore.gimmick)) {
      sigButtons.appendChild(h("button", { type: "button", class: "small-btn primary", onclick: () => sendSignal(name) }, `📡 ${name}`));
    }
  }

  const tests = h("div", { class: "cr-tests" },
    h("div", { class: "cr-test-row" }, h("span", { class: "cr-test-label" }, "合図"), sigButtons, sigName, sigBtn),
    h("div", { class: "cr-test-row" },
      h("span", { class: "cr-test-label" }, "LIVE"),
      user,
      giftName, giftCoins, h("span", { class: "hint" }, "×"), giftCount,
      h("button", {
        type: "button", class: "small-btn",
        onclick: () => {
          const coin = Math.max(0, Number(giftCoins.value) || 0);
          const count = Math.max(1, Math.floor(Number(giftCount.value) || 1));
          sendLive({ type: "gift", label: `🎁 ${giftName.value} ×${count}（${coin * count}コイン）`, gift: { name: giftName.value, picture: "", coin, count }, count, coins: coin * count });
        },
      }, "🎁 ギフト"),
      comment,
      h("button", { type: "button", class: "small-btn", onclick: () => sendLive({ type: "chat", label: `💬 ${comment.value}`, text: comment.value }) }, "💬 コメント"),
      h("button", { type: "button", class: "small-btn", onclick: () => sendLive({ type: "like", label: "❤️ いいね ×10", likes: 10, count: 10 }) }, "❤️ ×10"),
      h("button", { type: "button", class: "small-btn", onclick: () => sendLive({ type: "follow", label: "➕ フォロー" }) }, "➕ フォロー"),
      h("button", { type: "button", class: "small-btn", onclick: () => sendLive({ type: "share", label: "🔁 シェア" }) }, "🔁 シェア"),
      h("button", { type: "button", class: "small-btn", onclick: () => sendLive({ type: "join", label: "🚪 入室" }) }, "🚪 入室")));

  const head = h("div", { class: "cr-console-head" },
    h("strong", {}, "コンソール"),
    h("span", { class: "spacer" }),
    h("button", { type: "button", class: "small-btn", onclick: () => { lines.textContent = ""; } }, "消す"));

  root.append(tests, head, lines);
  renderSignals();
  let last = cstore.play;
  onC((kind, detail) => {
    if (kind === "gimmick" && !detail?.live) renderSignals();
    if (kind === "play" && cstore.play !== last) {
      if (cstore.play === "playing" && last === "stopped") log("▶ 再生", "sys");
      if (cstore.play === "paused") log("⏸ 一時停止", "sys");
      if (cstore.play === "stopped") log("⏹ 停止（始めの状態に戻しました）", "sys");
      last = cstore.play;
    }
  });
  log("ここにギミックのログが出ます。「コンソールに書く（Print）」ノードの文字や、式のまちがい・止めた理由もここに出ます。", "sys");
  return { log };
}
