// public/js/studio/editor/rules.js
// 右側の「イベント」タブ：配信のイベント → アクションのルール（TikFinity の Actions & Events）。
//   例）ギフト100コイン以上 → 紙吹雪 ＋ カメラ枠をジャーンと揺らす ＋ 効果音
//       コメント「!jump」     → 読み上げ ＋ カウンター +1
//       いいね 500 ごと      → ハートを降らせる
import { store, on, change, flushSave } from "./state.js";
import { api } from "./api.js";
import { elementOptions } from "./ops.js";
import {
  h, numberField, selectField, toggleField, textField, section, row, toast, openContextMenu, modal,
} from "./ui.js";
import { assetField } from "./inspector.js";
import { rule } from "./templates.js";
import { TTS_LANGS } from "./constants.js";
import { getGimmick } from "../shared/gimmick/registry.js";
import { signalNames } from "../shared/gimmick/defaults.js";
import {
  TRIGGER_LABELS, ACTION_LABELS, ACTION_ANIMS, PARTICLE_PRESETS, ENTER_ANIMS, clone, uid, flatten, getPath, setPath,
} from "../shared/model.js";

const findRule = (id, scene = store.scene) => scene?.rules.find((r) => r.id === id);

/** ルールの中の値の読み書き */
function rp(ruleId, path) {
  return {
    get: () => getPath(findRule(ruleId), path),
    set: (v) => change((s) => { const r = findRule(ruleId, s); if (r) setPath(r, path, v); }, { coalesce: `rule-${ruleId}-${path}` }),
  };
}

const DEFAULT_ACTIONS = {
  alert: () => ({ kind: "alert", target: "", title: "{user}", message: "ありがとう！", image: "avatar" }),
  sound: () => ({ kind: "sound", url: "", volume: 1 }),
  animate: () => ({ kind: "animate", target: "", animation: "shake", duration: 1, repeat: 1 }),
  visibility: () => ({ kind: "visibility", target: "", mode: "show", duration: 5 }),
  particles: () => ({ kind: "particles", preset: "confetti", amount: 80, emoji: "🎉" }),
  tts: () => ({ kind: "tts", text: "{user}さん、{comment}", lang: "ja-JP", rate: 1, pitch: 1, volume: 1 }),
  text: () => ({ kind: "text", target: "", text: "{user}さん ありがとう！", duration: 8 }),
  counter: () => ({ kind: "counter", name: "count", op: "add", amount: 1, per: "fixed" }),
  timer: () => ({ kind: "timer", name: "timer", op: "add", seconds: 60, per: "fixed" }),
  gimmick: () => {
    const first = elementOptions((e) => e.type === "gimmick")[0]?.[0] || "";
    return { kind: "gimmick", target: first, signal: signalsOf(first)[0] || "" };
  },
};

/** そのギミック枠に置いてあるギミックが受け取れる合図 */
function signalsOf(elementId) {
  const el = elementId && store.scene ? flatten(store.scene.elements).find((e) => e.id === elementId) : null;
  return signalNames(getGimmick(el?.cfg?.gimmickId));
}

const PER_OPTIONS = [["fixed", "固定"], ["coins", "× コイン数"], ["count", "× ギフトの個数"], ["likes", "× いいねの数"]];

function triggerFields(r) {
  const p = (k) => rp(r.id, `trigger.${k}`);
  const out = [
    selectField({ label: "きっかけ", wide: true, options: Object.entries(TRIGGER_LABELS), ...p("type") }),
  ];
  switch (r.trigger.type) {
    case "gift":
      out.push(
        textField({ label: "ギフト名（空ならどれでも・カンマ区切りで複数）", placeholder: "例：ローズ, ドーナツ", ...p("giftName") }),
        row(
          numberField({ label: "最低コイン", min: 0, ...p("minCoins"), hint: "0 なら下限なし（連打は合計で判定）" }),
          numberField({ label: "最高コイン", min: 0, ...p("maxCoins"), hint: "0 なら上限なし" }),
        ),
      );
      break;
    case "chat":
      out.push(
        selectField({
          label: "コメントの条件", wide: true,
          options: [["any", "どのコメントでも"], ["command", "コマンド（!jump など）で始まる"], ["contains", "この言葉を含む"], ["exact", "この言葉と完全に一致"]],
          ...p("match"),
        }),
      );
      if (r.trigger.match !== "any") out.push(textField({ label: "言葉", placeholder: r.trigger.match === "command" ? "!jump" : "草", ...p("keyword") }));
      break;
    case "like":
      out.push(numberField({ label: "いいね何件ごと", min: 0, hint: "0 ならいいねのたびに（数が多いので注意）", ...p("likeEvery") }));
      break;
    default:
      break;
  }
  out.push(
    textField({ label: "この人だけ（名前・@ID、カンマ区切り。空なら全員）", ...p("users") }),
    row(
      numberField({ label: "クールダウン", min: 0, unit: "秒", hint: "一度動いたら、この秒数は誰が来ても動かない", ...rp(r.id, "cooldown") }),
      numberField({ label: "1人ごと", min: 0, unit: "秒", hint: "同じ人では、この秒数は動かない", ...rp(r.id, "userCooldown") }),
    ),
  );
  return out;
}

function actionFields(r, i) {
  const a = r.actions[i];
  const p = (k) => rp(r.id, `actions.${i}.${k}`);
  const targetAny = (label = "動かす要素") => selectField({ label, wide: true, options: () => [["", "（選ぶ）"], ...elementOptions()], ...p("target") });
  switch (a.kind) {
    case "alert":
      return [
        selectField({ label: "出すアラート枠", wide: true, options: () => [["", "（最初のアラート枠）"], ...elementOptions((e) => e.type === "alert")], ...p("target") }),
        textField({ label: "見出し", vars: "event", ...p("title") }),
        textField({ label: "メッセージ", vars: "event", ...p("message") }),
        assetField({ label: "画像・動画", kind: "visual", ...p("image"), special: [["avatar", "👤 その人のアイコン"], ["gift", "🎁 ギフトの画像"], ["none", "画像なし"]] }),
        assetField({ label: "効果音", kind: "audio", ...p("sound") }),
        row(numberField({ label: "音量", min: 0, max: 1, step: 0.05, ...p("volume") }), numberField({ label: "表示秒数", min: 0, max: 60, hint: "0 ならアラート枠の設定", ...p("duration") })),
        selectField({ label: "出方", options: [["", "（アラート枠の設定）"], ...ENTER_ANIMS.filter(([v]) => v !== "none")], ...p("enter") }),
      ];
    case "sound":
      return [
        assetField({ label: "音", kind: "audio", ...p("url") }),
        numberField({ label: "音量", min: 0, max: 1, step: 0.05, ...p("volume") }),
      ];
    case "animate":
      return [
        targetAny(),
        selectField({ label: "動き", options: ACTION_ANIMS, ...p("animation") }),
        row(numberField({ label: "長さ", min: 0.1, max: 10, step: 0.1, unit: "秒", ...p("duration") }), numberField({ label: "回数", min: 1, max: 20, ...p("repeat") })),
      ];
    case "visibility":
      return [
        targetAny("要素"),
        selectField({ label: "どうする", options: [["show", "表示する"], ["hide", "隠す"], ["toggle", "切り替える"]], ...p("mode") }),
        numberField({ label: "戻すまで", min: 0, max: 3600, unit: "秒", hint: "0 なら戻さない", ...p("duration") }),
        h("p", { class: "hint" }, "最初は隠しておきたい要素は、プロパティの「配信画面では最初は隠す」をオンにします。"),
      ];
    case "particles":
      return [
        selectField({ label: "種類", options: PARTICLE_PRESETS, ...p("preset") }),
        a.preset === "emoji" ? textField({ label: "絵文字（空白区切りで複数）", ...p("emoji") }) : null,
        numberField({ label: "量", min: 1, max: 200, ...p("amount") }),
      ].filter(Boolean);
    case "tts":
      return [
        textField({ label: "読み上げる文", vars: "event", ...p("text") }),
        selectField({ label: "言語", options: TTS_LANGS, ...p("lang") }),
        row(numberField({ label: "速さ", min: 0.3, max: 3, step: 0.1, ...p("rate") }), numberField({ label: "高さ", min: 0, max: 2, step: 0.1, ...p("pitch") })),
        numberField({ label: "音量", min: 0, max: 1, step: 0.05, ...p("volume") }),
      ];
    case "text":
      return [
        selectField({ label: "差し替えるテキスト", wide: true, options: () => [["", "（選ぶ）"], ...elementOptions((e) => e.type === "text")], ...p("target") }),
        textField({ label: "新しい文字", vars: "event", ...p("text") }),
        numberField({ label: "戻すまで", min: 0, max: 3600, unit: "秒", hint: "0 なら戻さない", ...p("duration") }),
      ];
    case "counter":
      return [
        textField({ label: "カウンターの名前（文字の {名前} で表示できます）", list: "studio-var-names", ...p("name") }),
        row(
          selectField({ label: "どうする", options: [["add", "足す"], ["sub", "引く"], ["set", "この値にする"], ["reset", "0 にする"]], ...p("op") }),
          numberField({ label: "量", ...p("amount") }),
        ),
        selectField({ label: "掛ける", options: PER_OPTIONS, ...p("per") }),
      ];
    case "gimmick": {
      const signals = signalsOf(a.target);
      return [
        selectField({ label: "送るギミック", wide: true, options: () => [["", "（置いてある全部のギミック）"], ...elementOptions((e) => e.type === "gimmick")], ...p("target") }),
        signals.length
          ? selectField({ label: "合図", wide: true, options: () => [...signalsOf(findRule(r.id)?.actions[i]?.target).map((x) => [x, `📡 ${x}`])], ...p("signal") })
          : textField({ label: "合図の名前（ギミックのブループリントの「合図を受けたとき」ノードの名前）", ...p("signal") }),
        h("p", { class: "hint" }, "イベントの人の名前・ギフト・個数・コメントも一緒に渡します（ギミックの式で {user} {count} {coins} などとして使えます）。"),
      ];
    }
    case "timer":
      return [
        textField({ label: "タイマーの名前（タイマーウィジェットと同じ名前）", list: "studio-var-names", ...p("name") }),
        selectField({
          label: "どうする", wide: true,
          options: [["add", "時間を足す（延長）"], ["sub", "時間を引く"], ["set", "この時間にする"], ["start", "開始"], ["pause", "一時停止"], ["toggle", "開始／停止"], ["reset", "0 にする"]],
          ...p("op"),
        }),
        ["add", "sub", "set"].includes(a.op ?? "add")
          ? row(numberField({ label: "秒", min: 0, ...p("seconds") }), selectField({ label: "掛ける", options: PER_OPTIONS, ...p("per") }))
          : null,
      ].filter(Boolean);
    default:
      return [];
  }
}

export function initRules(panel) {
  const expanded = new Set();
  let fields = [];
  let builtKey = null;

  const keyOf = () => JSON.stringify([
    store.scene?.id,
    (store.scene?.rules || []).map((r) => [r.id, r.enabled, r.trigger.type, r.trigger.match, r.actions.map((a) => [a.kind, a.preset, a.op, a.kind === "gimmick" ? a.target : null])]),
    [...expanded],
  ]);

  function addRule(trigger, name) {
    const r = rule(name, trigger, [DEFAULT_ACTIONS.alert()]);
    expanded.add(r.id);
    change((s) => { s.rules.push(r); });
  }

  function ruleCard(r, index) {
    const open = expanded.has(r.id);
    const summary = `${TRIGGER_LABELS[r.trigger.type] || r.trigger.type} → ${r.actions.map((a) => ACTION_LABELS[a.kind]?.split(" ")[0] ?? a.kind).join(" ") || "（アクションなし）"}`;
    const enabled = toggleField({ label: "", ...rp(r.id, "enabled") });
    const name = h("input", { type: "text", class: "rule-name", value: r.name });
    name.addEventListener("change", () => rp(r.id, "name").set(name.value));
    name.addEventListener("click", (e) => e.stopPropagation());
    fields.push(enabled, { sync() { if (document.activeElement !== name) name.value = findRule(r.id)?.name ?? ""; } });

    const head = h("div", { class: "rule-head", onclick: () => { open ? expanded.delete(r.id) : expanded.add(r.id); render(); } },
      h("span", { class: "rule-caret" }, open ? "▾" : "▸"),
      h("span", { onclick: (e) => e.stopPropagation() }, enabled.el),
      h("div", { class: "rule-title" }, name, h("span", { class: "rule-summary" }, summary)),
      h("button", {
        type: "button", class: "small-btn", title: "このルールを試す（クールダウンは無視）",
        onclick: async (e) => {
          e.stopPropagation();
          await flushSave();
          try { await api.testRule(store.scene.id, r.id); } catch (err) { toast(`テストできませんでした: ${err.message}`, "error"); }
        },
      }, "▶ テスト"),
      h("button", {
        type: "button", class: "icon-btn", title: "その他",
        onclick: (e) => {
          e.stopPropagation();
          const b = e.currentTarget.getBoundingClientRect();
          openContextMenu([
            { label: "複製", run: () => change((s) => { const copy = clone(r); copy.id = uid("rule"); copy.name = `${r.name} のコピー`; s.rules.splice(index + 1, 0, copy); }) },
            { label: "上へ", disabled: index === 0, run: () => change((s) => { s.rules.splice(index - 1, 0, s.rules.splice(index, 1)[0]); }) },
            { label: "下へ", disabled: index === store.scene.rules.length - 1, run: () => change((s) => { s.rules.splice(index + 1, 0, s.rules.splice(index, 1)[0]); }) },
            "-",
            {
              label: "削除", run: async () => {
                if (await modal("ルールを削除", h("p", {}, `「${r.name}」を削除します。`), { okText: "削除" })) {
                  change((s) => { s.rules = s.rules.filter((x) => x.id !== r.id); });
                }
              },
            },
          ], { x: b.left - 120, y: b.bottom });
        },
      }, "⋯"));

    const card = h("div", { class: `rule-card${r.enabled ? "" : " disabled"}${open ? " open" : ""}` }, head);
    if (!open) return card;

    const trig = section("きっかけ（トリガー）", triggerFields(r), { id: "rule-trigger" });
    fields.push(trig);
    const actions = h("div", { class: "action-list" });
    r.actions.forEach((a, i) => {
      const fs = actionFields(r, i);
      fields.push(...fs);
      const delay = numberField({ label: "遅らせる", min: 0, max: 60, step: 0.1, unit: "秒", ...rp(r.id, `actions.${i}.delay`) });
      fields.push(delay);
      const move = (d) => change((s) => {
        const list = findRule(r.id, s).actions;
        const [x] = list.splice(i, 1);
        list.splice(Math.max(0, Math.min(list.length, i + d)), 0, x);
      });
      actions.appendChild(h("div", { class: "action-card" },
        h("div", { class: "action-head" },
          h("span", { class: "action-kind" }, ACTION_LABELS[a.kind] || a.kind),
          h("button", { type: "button", class: "icon-btn", title: "上へ", disabled: i === 0 || null, onclick: () => move(-1) }, "↑"),
          h("button", { type: "button", class: "icon-btn", title: "下へ", disabled: i === r.actions.length - 1 || null, onclick: () => move(1) }, "↓"),
          h("button", {
            type: "button", class: "icon-btn", title: "削除",
            onclick: () => change((s) => { findRule(r.id, s).actions.splice(i, 1); }),
          }, "×")),
        h("div", { class: "action-body" }, fs.map((f) => f.el), delay.el)));
    });
    const add = h("select", { class: "add-action" },
      h("option", { value: "" }, "＋ アクションを追加…"),
      Object.entries(ACTION_LABELS).map(([k, label]) => h("option", { value: k }, label)));
    add.addEventListener("change", () => {
      const kind = add.value;
      if (!kind) return;
      change((s) => { findRule(r.id, s).actions.push(DEFAULT_ACTIONS[kind]()); });
    });
    card.append(h("div", { class: "rule-body" }, trig.el, h("h4", {}, "アクション（上から順に）"), actions, add));
    return card;
  }

  function render() {
    builtKey = keyOf();
    panel.textContent = "";
    fields = [];
    if (!store.scene) return;
    const addBtn = h("button", {
      type: "button", class: "btn primary block",
      onclick: (e) => {
        const b = e.currentTarget.getBoundingClientRect();
        openContextMenu([
          { label: "🎁 ギフトが来たら", run: () => addRule({ type: "gift" }, "ギフトのお礼") },
          { label: "🎁 大きなギフト（100コイン〜）", run: () => addRule({ type: "gift", minCoins: 100 }, "大きなギフト") },
          { label: "➕ フォローされたら", run: () => addRule({ type: "follow" }, "フォローのお礼") },
          { label: "🔁 シェアされたら", run: () => addRule({ type: "share" }, "シェアのお礼") },
          { label: "❤️ いいね 100 ごと", run: () => addRule({ type: "like", likeEvery: 100 }, "いいね 100 ごと") },
          { label: "💬 コマンド（!jump）", run: () => addRule({ type: "chat", match: "command", keyword: "!jump" }, "!jump コマンド") },
          { label: "💬 コメントを読み上げ", run: () => {
            const r = rule("コメント読み上げ", { type: "chat" }, [DEFAULT_ACTIONS.tts()], { userCooldown: 10 });
            expanded.add(r.id);
            change((s) => { s.rules.push(r); });
          } },
          { label: "🚪 入室したら", run: () => addRule({ type: "join" }, "入室") },
          { label: "🧧 宝箱が来たら", run: () => addRule({ type: "envelope" }, "宝箱") },
        ], { x: b.left, y: b.bottom });
      },
    }, "＋ ルールを追加");
    panel.appendChild(addBtn);
    panel.appendChild(h("p", { class: "hint" }, "配信でイベントが起きたとき、このデザインに何をするかを決めます。「テスト」タブで、実際のイベントを流して確かめられます。"));
    if (!store.scene.rules.length) {
      panel.appendChild(h("p", { class: "hint pad" }, "まだルールがありません。"));
    }
    store.scene.rules.forEach((r, i) => panel.appendChild(ruleCard(r, i)));
    sync();
  }

  function sync() {
    for (const f of fields) { try { f.sync?.(); } catch (e) { console.error(e); } }
  }

  on((kind) => {
    if (kind !== "scene") return;
    if (keyOf() !== builtKey) render(); else sync();
  });
  return { render };
}
