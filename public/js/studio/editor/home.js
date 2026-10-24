// public/js/studio/editor/home.js
// /studio を ID なしで開いたときの画面：
//   はじめかた（@ID を入れて接続 → デザインを作る → OBS / LIVE Studio に貼る）、テンプレート、自分のデザイン、
//   設定（TikTok LIVE の接続・URL の合鍵・API キー・パスワード・アカウントの削除）。
import { api } from "./api.js";
import { h, toast, modal, copyText, prefs } from "./ui.js";
import { TEMPLATES } from "./templates.js";
import { SIZE_PRESETS } from "./inspector.js";
import { SAMPLE_VALUES } from "./constants.js";
import { getMe, setMe, overlayUrl, describeConnection, getConnection, onConnection } from "./me.js";
import { createRenderer } from "../shared/render.js";
import { createLive } from "../shared/runtime.js";
import { googleFontsUrl, collectFonts } from "../shared/model.js";
import { creatorSections } from "../creator/home.js";
import { loadGimmicks } from "./gimmicks.js";

const live = createLive();

/** シーンを小さな見本にする */
function sceneThumb(scene, W = 320, H = 180) {
  const box = h("div", { class: `scene-thumb${scene.background === "transparent" ? " checker" : ""}` });
  const inner = h("div", { class: "scene-thumb-inner" });
  box.appendChild(inner);
  createRenderer(inner, { mode: "thumb", getLive: () => live, getCtx: () => SAMPLE_VALUES }).render(scene);
  const s = Math.min(W / scene.width, H / scene.height);
  inner.style.transform = `translate(${(W - scene.width * s) / 2}px, ${(H - scene.height * s) / 2}px) scale(${s})`;
  box.style.width = `${W}px`;
  box.style.height = `${H}px`;
  return box;
}

function loadFonts(scenes) {
  const fonts = new Set();
  for (const s of scenes) collectFonts(s).forEach((f) => fonts.add(f));
  const url = googleFontsUrl(fonts);
  if (url) document.head.appendChild(h("link", { rel: "stylesheet", href: url }));
}

function templateScene(t, size) {
  const built = t.build();
  const [w, hh] = size ? size.split("x").map(Number) : [t.width, t.height];
  return {
    name: t.id === "blank" ? "無題のデザイン" : t.name,
    width: w, height: hh, background: built.background ?? "transparent",
    elements: built.elements, rules: built.rules, meta: { template: t.id },
  };
}

async function createFrom(t, size) {
  try {
    const scene = await api.createScene(templateScene(t, size));
    location.search = `?id=${encodeURIComponent(scene.id)}`;
  } catch (e) {
    toast(`作れませんでした: ${e.message}`, "error");
  }
}

// ===============================
// TikTok LIVE への接続（TikFinity と同じく、@ID を入れて「接続」を押すだけ）
// ===============================
/** 接続の様子の一行。サーバーから届くたびに書き換え、待ち時間の秒読みは毎秒進める */
function liveStatusLine() {
  const line = h("p", { class: "status-line" });
  const paint = (st) => {
    const d = describeConnection(st);
    line.textContent = d.text;
    line.dataset.tone = d.tone;
  };
  if (getConnection()) paint(getConnection());
  else api.liveStatus().then(paint).catch(() => { /* ログイン切れなら api.js が移動させる */ });
  const stop = onConnection(paint);
  const timer = setInterval(() => {
    if (!line.isConnected) {
      stop();
      clearInterval(timer);
    } else if (getConnection()?.state === "waiting") paint(getConnection());
  }, 1000);
  return line;
}

/** @ID を保存して、すぐに繋ぎにいく。同じ @ID のままでも押せば待ち時間を飛ばして繋ぎ直す */
async function connectLive(value, rerender) {
  try {
    const user = (await api.updateAccount({ tiktokUsername: value })).user;
    setMe(user);
    if (user.tiktokUsername) await api.liveRetry().catch(() => { });
    toast(user.tiktokUsername ? `@${user.tiktokUsername} の LIVE に接続します` : "接続をやめました");
    rerender();
  } catch (e) { toast(e.message, "error"); }
}

function connectForm(me, rerender) {
  const input = h("input", { type: "text", placeholder: "例：your_name", value: me.tiktokUsername || "", autocomplete: "off", spellcheck: "false" });
  const connect = h("button", { type: "button", class: "btn primary", onclick: () => connectLive(input.value, rerender) }, "接続");
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") connect.click(); });
  return h("div", { class: "inline-form" }, h("span", { class: "at" }, "@"), input, connect);
}

// ===============================
// はじめかた
// ===============================
function onboarding(me, sceneCount, rerender) {
  const steps = [
    {
      done: !!me.tiktokUsername,
      title: "TikTok の @ID を入れて「接続」",
      body: [
        h("p", {}, "配信するアカウントの @ID（表示名ではなく、プロフィールの @ のあとの文字）を入れて「接続」を押します。TikTok のパスワードもログインも要りません。誰でも見られる LIVE のコメントやギフトを読むだけなので、アカウントは公開にしておいてください。"),
        connectForm(me, rerender),
        me.tiktokUsername ? liveStatusLine() : null,
      ],
    },
    {
      done: sceneCount > 0,
      title: "デザインを作る",
      body: [h("p", {}, "下のテンプレートから選ぶと、アラート・チャット・ゴールなどが最初から入っています。")],
    },
    {
      done: false,
      title: "OBS か TikTok LIVE Studio に URL を貼る",
      body: [
        h("p", {}, "デザインの「OBS URL」をコピーして、OBS なら「ブラウザ」ソース、TikTok LIVE Studio なら「リンク」ソースに貼ります。幅と高さはデザインと同じ（例：1920×1080）に。URL は最後まで全部貼ってください（途中で切れると何も映りません）。"),
        h("p", { class: "hint" }, "あとは配信を始めるだけ。開始から数十秒で自動的につながり、ギフトやフォローで動き出します。"),
      ],
    },
  ];
  const allDone = steps[0].done && steps[1].done;
  return h("section", { class: `onboard${allDone ? " compact" : ""}` },
    h("h2", {}, allDone ? "配信の準備ができています" : "はじめかた（3ステップ）"),
    h("ol", { class: "steps" }, steps.map((s, i) => h("li", { class: s.done ? "done" : "" },
      h("span", { class: "step-no" }, s.done ? "✓" : String(i + 1)),
      h("div", { class: "step-body" }, h("strong", {}, s.title), allDone && i < 2 ? null : s.body)))));
}

// ===============================
// 設定
// ===============================
function settings(me, rerender) {
  const name = h("input", { type: "text", value: me.displayName, maxlength: 60 });
  const saveName = async () => {
    try {
      setMe((await api.updateAccount({ displayName: name.value })).user);
      toast("保存しました");
      rerender();
    } catch (e) { toast(e.message, "error"); }
  };

  const pwCurrent = h("input", { type: "password", autocomplete: "current-password", placeholder: "いまのパスワード" });
  const pwNext = h("input", { type: "password", autocomplete: "new-password", placeholder: "新しいパスワード（8文字以上）" });

  const maskedKey = `${me.apiKey.slice(0, 7)}${"•".repeat(16)}`;

  return h("section", { class: "home-sec settings", id: "settings" },
    h("h2", {}, "設定"),
    h("div", { class: "settings-grid" },
      h("div", { class: "card" },
        h("h3", {}, "TikTok LIVE"),
        me.tiktokUsername ? liveStatusLine() : h("p", { class: "status-line", "data-tone": "warn" }, "TikTok の @ID がまだ設定されていません"),
        h("div", { class: "fld" }, h("span", { class: "fld-label" }, "TikTok の @ID（表示名ではなく、プロフィールの @ のあと）"), connectForm(me, rerender)),
        me.tiktokUsername ? h("div", { class: "btn-row" }, h("button", { type: "button", class: "small-btn", onclick: () => connectLive("", rerender) }, "接続をやめる")) : null,
        h("p", { class: "hint" }, "パスワードもログインも要りません。スタジオか OBS の画面を開いている間はつながったままで、配信がまだなら始まるまで待って自動でつながります。アカウントは公開にしておいてください。"),
        h("p", { class: "hint" }, "自分以外の公開 LIVE でも、@ID を入れれば読めます（モデレーターが配信者の代わりにオーバーレイを動かす、など）。")),
      h("div", { class: "card" },
        h("h3", {}, "URL の合鍵"),
        h("p", { class: "hint" }, "OBS / LIVE Studio に貼る URL には、あなた専用の合鍵が入っています。配信画面に映したり人に見せたりしてしまったら、作り直してください（いま貼っている URL はすべて使えなくなり、貼り直しが必要です）。"),
        h("div", { class: "btn-row" }, h("button", {
          type: "button", class: "btn danger",
          onclick: async () => {
            const ok = await modal("URL の合鍵を作り直す", h("p", {}, "いま OBS や LIVE Studio に貼っている URL はすべて表示されなくなります。作り直したあと、デザインの「OBS URL」をコピーして貼り直してください。"), { okText: "作り直す" });
            if (!ok) return;
            setMe((await api.regenerateKey("overlay")).user);
            toast("合鍵を作り直しました。URL を貼り直してください");
            rerender();
          },
        }, "合鍵を作り直す")),
        h("h3", {}, "API キー（外部ツール用）"),
        h("p", { class: "hint" }, "Streamer.bot などからイベントを送るときに使います（Authorization: Bearer <キー>）。"),
        h("code", { class: "key" }, maskedKey),
        h("div", { class: "btn-row" },
          h("button", { type: "button", class: "small-btn", onclick: () => copyText(getMe().apiKey, "API キーをコピーしました") }, "コピー"),
          h("button", {
            type: "button", class: "small-btn",
            onclick: async () => {
              if (!(await modal("API キーを作り直す", h("p", {}, "いまのキーを使っているツールは動かなくなります。"), { okText: "作り直す" }))) return;
              setMe((await api.regenerateKey("api")).user);
              toast("API キーを作り直しました");
              rerender();
            },
          }, "作り直す"))),
      h("div", { class: "card" },
        h("h3", {}, me.hasPassword ? "パスワードを変える" : "パスワードを決める"),
        me.hasPassword ? pwCurrent : h("p", { class: "hint" }, "Google / TikTok でログインしています。パスワードを決めると、メールでもログインできます。"),
        pwNext,
        h("div", { class: "btn-row" }, h("button", {
          type: "button", class: "btn",
          onclick: async () => {
            try {
              await api.changePassword(pwCurrent.value, pwNext.value);
              pwCurrent.value = "";
              pwNext.value = "";
              toast("パスワードを変えました（ほかの端末はログアウトしました）");
            } catch (e) { toast(e.message, "error"); }
          },
        }, "保存")),
        h("h3", {}, "アカウント"),
        h("label", { class: "fld" }, h("span", { class: "fld-label" }, "表示名（このサービスの中だけ）"), name),
        h("div", { class: "btn-row" }, h("button", { type: "button", class: "btn", onclick: saveName }, "名前を保存")),
        h("p", { class: "hint" }, `${me.email || "メール未登録"}${me.identities.length ? `・${me.identities.map((p) => (p === "google" ? "Google" : "TikTok")).join("・")} でログイン` : ""}`),
        h("div", { class: "btn-row" },
          h("button", { type: "button", class: "btn", onclick: logout }, "ログアウト"),
          h("button", { type: "button", class: "btn danger", onclick: () => deleteAccount(me) }, "アカウントを削除")))));
}

async function logout() {
  try { await api.logout(); } catch (e) { /* 失敗してもログイン画面へ */ }
  location.href = "/login";
}

async function deleteAccount(me) {
  const input = h("input", { type: me.hasPassword ? "password" : "text", placeholder: me.hasPassword ? "パスワード" : "DELETE と入力" });
  const ok = await modal("アカウントを削除", h("div", {},
    h("p", {}, "デザイン・素材・カウンターがすべて消え、元に戻せません。OBS に貼っている URL も表示されなくなります。"),
    input), { okText: "削除する" });
  if (!ok) return;
  try {
    await api.deleteAccount(me.hasPassword ? { password: input.value } : { confirm: input.value });
    location.href = "/";
  } catch (e) { toast(e.message, "error"); }
}

// ===============================
// モード（アーティスト＝デザインして配信に使う／クリエイター＝デザインに置くギミックを作る）
// ===============================
function currentMode() {
  const q = new URLSearchParams(location.search).get("mode");
  if (q === "artist" || q === "creator") return q;
  return prefs.get("ld-mode") === "creator" ? "creator" : "artist";
}

function setMode(mode) {
  prefs.set("ld-mode", mode);
  const u = new URL(location.href);
  u.searchParams.set("mode", mode);
  history.replaceState(null, "", u);
}

function modeSwitch(mode, rerender) {
  const btn = (m, icon, label, desc) => h("button", {
    type: "button", class: `mode-btn${mode === m ? " active" : ""}`, "aria-pressed": mode === m ? "true" : "false",
    onclick: () => { if (mode !== m) { setMode(m); rerender(); } },
  }, h("span", { class: "mode-icon" }, icon), h("span", { class: "mode-text" }, h("strong", {}, label), h("small", {}, desc)));
  return h("nav", { class: "mode-switch", "aria-label": "モード" },
    btn("artist", "🎨", "アーティストモード", "配信画面をデザインして、イベントで動かす"),
    btn("creator", "🛠", "クリエイターモード", "デザインに置くゲーム・エフェクト・サウンドを作る"));
}

// ===============================
// 画面
// ===============================
export async function showHome(root) {
  const me = getMe();
  root.hidden = false;
  root.textContent = "";
  const mode = currentMode();
  document.title = mode === "creator" ? "クリエイターモード - LiveDesign Studio" : "LiveDesign Studio";
  const rerender = () => showHome(root);

  const sizeSel = h("select", {}, SIZE_PRESETS.map(([v, label]) => h("option", { value: v }, label)));
  const header = h("header", { class: "home-head" },
    h("div", { class: "brand" }, h("span", { class: "logo" }, "◆"), h("div", {}, h("h1", {}, "LiveDesign Studio"), h("p", {}, "配信・ゲーム実況のオーバーレイとウィジェットをデザインして、TikTok LIVE のイベントで動かす"))),
    h("div", { class: "home-actions" },
      mode === "artist" ? h("button", { type: "button", class: "btn primary", onclick: () => createFrom(TEMPLATES[0], sizeSel.value) }, "＋ 白紙から作る") : null,
      mode === "artist" ? sizeSel : null,
      h("a", { class: "user-chip", href: "#settings", title: "設定" },
        h("span", { class: "user-avatar" }, (me.displayName || "?").slice(0, 1)),
        h("span", {}, me.displayName))));

  if (mode === "creator") {
    const switcher = modeSwitch(mode, rerender);
    root.append(header, switcher);
    const sections = await creatorSections(rerender);
    // 読み込んでいる間にモードを切り替えていたら、古い画面は出さない
    if (!switcher.isConnected) return;
    root.append(...sections, settings(me, rerender));
    if (location.hash === "#settings") requestAnimationFrame(() => document.getElementById("settings")?.scrollIntoView());
    return;
  }

  let scenes = [];
  let loadError = false;
  try {
    scenes = await api.listScenes();
  } catch (e) {
    loadError = true;
  }
  // デザインに置いたギミックも見本に描けるように
  if (scenes.length) await loadGimmicks();

  const tplGrid = h("div", { class: "tpl-grid" });
  for (const t of TEMPLATES) {
    const scene = templateScene(t);
    tplGrid.appendChild(h("button", { type: "button", class: "tpl-card", onclick: () => createFrom(t) },
      sceneThumb(scene, 260, t.height > t.width ? 260 : 146),
      h("strong", {}, t.name), h("span", {}, t.desc)));
  }
  loadFonts(TEMPLATES.map((t) => templateScene(t)));

  const list = h("div", { class: "scene-grid" });
  root.append(header,
    modeSwitch(mode, rerender),
    onboarding(me, scenes.length, rerender),
    h("section", { class: "home-sec" }, h("h2", {}, "テンプレートから作る"), tplGrid),
    h("section", { class: "home-sec" }, h("h2", {}, "あなたのデザイン"), list),
    settings(me, rerender));

  if (loadError) {
    list.appendChild(h("p", { class: "hint" }, "デザインを読み込めませんでした。少し待ってから再読み込みしてください。"));
    return;
  }
  if (!scenes.length) list.appendChild(h("p", { class: "hint" }, "まだデザインがありません。上のテンプレートから作ってみましょう。"));
  if (location.hash === "#settings") requestAnimationFrame(() => document.getElementById("settings")?.scrollIntoView());

  const full = await Promise.all(scenes.map((s) => api.getScene(s.id).catch(() => null)));
  loadFonts(full.filter(Boolean));
  scenes.forEach((s, i) => {
    const scene = full[i];
    const open = () => { location.search = `?id=${encodeURIComponent(s.id)}`; };
    list.appendChild(h("div", { class: "scene-card" },
      h("button", { type: "button", class: "scene-open", onclick: open }, scene ? sceneThumb(scene) : h("div", { class: "scene-thumb" })),
      h("div", { class: "scene-meta" },
        h("strong", {}, s.name),
        h("span", {}, `${s.width}×${s.height}・要素 ${s.elements}・ルール ${s.rules}・${new Date(s.updatedAt).toLocaleString("ja-JP")}`)),
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "small-btn primary", onclick: open }, "開く"),
        h("button", { type: "button", class: "small-btn", onclick: () => copyText(overlayUrl(s.id), `OBS 用 URL をコピーしました（${s.width}×${s.height} で貼ってください）`) }, "OBS URL"),
        h("button", {
          type: "button", class: "small-btn",
          onclick: async () => {
            try { await api.duplicateScene(s.id); rerender(); } catch (e) { toast(e.message, "error"); }
          },
        }, "複製"),
        h("button", {
          type: "button", class: "small-btn danger",
          onclick: async () => {
            const ok = await modal("デザインを削除", h("p", {}, `「${s.name}」を削除します。OBS に貼っている場合は表示されなくなります。`), { okText: "削除" });
            if (!ok) return;
            await api.deleteScene(s.id);
            rerender();
          },
        }, "削除"))));
  });
}
