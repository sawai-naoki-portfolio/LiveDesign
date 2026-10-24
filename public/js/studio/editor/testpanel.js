// public/js/studio/editor/testpanel.js
// 右側の「テスト」タブ：配信のイベントを手で流す・数字を見る・カウンターとタイマーを動かす。
// ここから流したイベントは本番と同じ判定（ルール・ウィジェット）を通る。
import { store, emit } from "./state.js";
import { api } from "./api.js";
import { h, toast } from "./ui.js";
import { STAT_OPTIONS } from "./constants.js";
import { formatDuration } from "../shared/template.js";
import { describeConnection } from "./me.js";

const SAMPLE_GIFTS = [
  ["ローズ", 1], ["GG", 1], ["TikTok", 1], ["ハート", 5], ["ドーナツ", 30], ["パフューム", 20],
  ["花火", 1088], ["ライオン", 29999], ["ユニバース", 34999],
];

export function initTestPanel(panel, { getLive, getStatus }) {
  const userInput = h("input", { type: "text", value: "テスト視聴者", placeholder: "名前" });
  const send = async (event) => {
    try {
      await api.sendEvent({ user: { name: userInput.value.trim() || "テスト視聴者" }, ...event });
    } catch (e) {
      toast(`送れませんでした: ${e.message}`, "error");
    }
  };

  const chatText = h("input", { type: "text", placeholder: "コメント（!jump など）", value: "こんばんは！" });
  const giftSel = h("select", {}, SAMPLE_GIFTS.map(([name, coin]) => h("option", { value: `${name}|${coin}` }, `${name}（${coin}コイン）`)));
  const giftCount = h("input", { type: "number", min: 1, max: 999, value: 1, class: "num short" });
  const likeCount = h("input", { type: "number", min: 1, max: 10000, value: 50, class: "num short" });

  const status = h("div", { class: "status-line" });
  const retry = h("button", {
    type: "button", class: "small-btn", hidden: true,
    onclick: async () => {
      try { await api.liveRetry(); } catch (e) { toast(e.message, "error"); }
    },
  }, "今すぐ繋ぐ");
  const settings = h("a", { class: "small-btn", href: "/studio#settings" }, "@ID を設定・変更");
  const statsBox = h("div", { class: "stats-grid" });
  const countersBox = h("div", { class: "var-list" });
  const timersBox = h("div", { class: "var-list" });

  const preview = h("input", { type: "checkbox", checked: store.livePreview });
  preview.addEventListener("change", () => { store.livePreview = preview.checked; emit("view"); });
  const sound = h("input", { type: "checkbox", checked: store.sound });
  sound.addEventListener("change", () => { store.sound = sound.checked; });

  panel.append(
    h("section", { class: "sec open" }, h("div", { class: "sec-head static" }, "接続"), h("div", { class: "sec-body" },
      status,
      h("div", { class: "btn-row" }, retry, settings),
      h("label", { class: "fld toggle wide" }, preview, h("span", {}, "このキャンバスでもアラートや演出を再生する")),
      h("label", { class: "fld toggle wide" }, sound, h("span", {}, "プレビューで音と読み上げを出す")))),
    h("section", { class: "sec open" }, h("div", { class: "sec-head static" }, "イベントを流す"), h("div", { class: "sec-body test-events" },
      h("label", { class: "fld wide" }, h("span", { class: "fld-label" }, "誰から"), userInput),
      h("div", { class: "test-row" }, chatText, h("button", { type: "button", class: "small-btn", onclick: () => send({ type: "chat", text: chatText.value }) }, "💬 コメント")),
      h("div", { class: "test-row" }, giftSel, h("span", {}, "×"), giftCount, h("button", {
        type: "button", class: "small-btn",
        onclick: () => {
          const [name, coin] = giftSel.value.split("|");
          send({ type: "gift", gift: { name, coin: Number(coin), count: Number(giftCount.value) || 1 } });
        },
      }, "🎁 ギフト")),
      h("div", { class: "test-row" }, likeCount, h("button", { type: "button", class: "small-btn", onclick: () => send({ type: "like", likes: Number(likeCount.value) || 1 }) }, "❤️ いいね")),
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "small-btn", onclick: () => send({ type: "follow" }) }, "➕ フォロー"),
        h("button", { type: "button", class: "small-btn", onclick: () => send({ type: "share" }) }, "🔁 シェア"),
        h("button", { type: "button", class: "small-btn", onclick: () => send({ type: "join" }) }, "🚪 入室"),
        h("button", { type: "button", class: "small-btn", onclick: () => send({ type: "envelope", coins: 300 }) }, "🧧 宝箱")))),
    h("section", { class: "sec open" }, h("div", { class: "sec-head static" }, "今回の配信の数字"), h("div", { class: "sec-body" },
      statsBox,
      h("button", {
        type: "button", class: "small-btn",
        onclick: async () => { await api.resetStats(); toast("数字をリセットしました"); },
      }, "数字をリセット（新しい配信のとき）"))),
    h("section", { class: "sec open" }, h("div", { class: "sec-head static" }, "カウンター"), h("div", { class: "sec-body" },
      countersBox, newVarRow("counter"))),
    h("section", { class: "sec open" }, h("div", { class: "sec-head static" }, "タイマー"), h("div", { class: "sec-body" },
      timersBox, newVarRow("timer"))),
  );

  function newVarRow(kind) {
    const name = h("input", { type: "text", placeholder: kind === "timer" ? "名前（例：subathon）" : "名前（例：deaths）" });
    const value = h("input", { type: "number", class: "num short", value: kind === "timer" ? 300 : 0, title: kind === "timer" ? "秒" : "値" });
    return h("div", { class: "test-row" }, name, value, h("button", {
      type: "button", class: "small-btn",
      onclick: async () => {
        try {
          await api.setVar({ kind, name: name.value.trim(), op: "set", value: Number(value.value) || 0 });
          name.value = "";
        } catch (e) {
          toast("この名前は使えません（英数字・日本語・_。likes などの予約語は不可）", "error");
        }
      },
    }, "作る"));
  }

  const setVar = (body) => api.setVar(body).catch((e) => toast(e.message, "error"));

  function render() {
    const live = getLive();
    const st = getStatus();
    const conn = describeConnection(st.connection);
    status.textContent = st.server ? conn.text : "🔴 サーバーに繋がっていません（繋ぎ直しています）";
    status.dataset.tone = st.server ? conn.tone : "error";
    retry.hidden = !st.server || !["waiting", "busy"].includes(st.connection?.state);

    statsBox.textContent = "";
    for (const [key, label] of STAT_OPTIONS) {
      statsBox.appendChild(h("div", { class: "stat" }, h("span", {}, label.replace(/（.*）/, "")), h("strong", {}, Number(live.vars.stats?.[key] ?? 0).toLocaleString("ja-JP")), h("code", {}, `{${key}}`)));
    }

    countersBox.textContent = "";
    const counters = Object.entries(live.vars.counters || {});
    if (!counters.length) countersBox.appendChild(h("p", { class: "hint" }, "ルールの「カウンター」アクションで作られます。ここで作ることもできます。"));
    for (const [name, value] of counters) {
      countersBox.appendChild(h("div", { class: "var-row" },
        h("code", {}, `{${name}}`), h("strong", {}, Number(value).toLocaleString("ja-JP")),
        h("button", { type: "button", class: "icon-btn", onclick: () => setVar({ kind: "counter", name, op: "sub", value: 1 }) }, "−"),
        h("button", { type: "button", class: "icon-btn", onclick: () => setVar({ kind: "counter", name, op: "add", value: 1 }) }, "＋"),
        h("button", { type: "button", class: "icon-btn", title: "0 に", onclick: () => setVar({ kind: "counter", name, op: "reset" }) }, "⟲"),
        h("button", { type: "button", class: "icon-btn", title: "削除", onclick: () => setVar({ kind: "delete", type: "counter", name }) }, "×")));
    }

    timersBox.textContent = "";
    const timers = Object.entries(live.vars.timers || {});
    if (!timers.length) timersBox.appendChild(h("p", { class: "hint" }, "タイマーウィジェットや、ルールの「タイマー」アクションで使います。"));
    for (const [name, t] of timers) {
      const remaining = t.running ? Math.max(0, t.remaining - (Date.now() - live.varsAt)) : t.remaining;
      timersBox.appendChild(h("div", { class: "var-row" },
        h("code", {}, name), h("strong", { class: t.running ? "running" : "" }, formatDuration(remaining)),
        h("button", { type: "button", class: "icon-btn", title: t.running ? "停止" : "開始", onclick: () => setVar({ kind: "timer", name, op: t.running ? "pause" : "start" }) }, t.running ? "⏸" : "▶"),
        h("button", { type: "button", class: "icon-btn", title: "+1分", onclick: () => setVar({ kind: "timer", name, op: "add", value: 60 }) }, "+1"),
        h("button", { type: "button", class: "icon-btn", title: "0 に", onclick: () => setVar({ kind: "timer", name, op: "reset" }) }, "⟲"),
        h("button", { type: "button", class: "icon-btn", title: "削除", onclick: () => setVar({ kind: "delete", type: "timer", name }) }, "×")));
    }

    // ルールやタイマーの名前欄の候補
    const list = document.getElementById("studio-var-names");
    if (list) {
      list.textContent = "";
      for (const n of [...counters.map(([k]) => k), ...timers.map(([k]) => k)]) list.appendChild(h("option", { value: n }));
    }
  }

  // タイマーの残りと、繋ぎ直すまでの秒数を進める
  setInterval(() => {
    if (!panel.offsetParent) return;
    if (Object.values(getLive().vars.timers || {}).some((t) => t.running) || getStatus().connection?.state === "waiting") render();
  }, 1000);
  return { render };
}
