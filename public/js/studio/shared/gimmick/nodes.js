// public/js/studio/shared/gimmick/nodes.js
// ブループリント（ノードでプログラミングする仕組み。Unreal Engine の Blueprint にならう）のノードの種類。
//
// ノードは5つの仲間に分かれる（色も UE と同じ考え方）：
//   🟥 イベント … きっかけ。ここから処理が始まる（ゲーム開始・合図・ぶつかった・ギフト…）
//   🟦 アクション … 白い「実行ピン」でつないだ順に実行する（出す・動かす・音・エフェクト…）
//   ⬜ フロー … 実行の流れを変える（分岐・順番に・待つ・くり返す…）
//   🟩 ピュア … 実行ピンが無い。値を計算するだけ（足し算・比べる・ランダム・オブジェクトの情報…）
//   🔢 変数 … 変数を読む・入れる・足す
//   🟪 関数・マクロ … 自分で作ったノード。中身は別のグラフ（関数の入口 → 出口、マクロの入口 → 出口）
//
// ピン（つなぎ口）の種類と色：
//   exec（実行・白）  number（数・緑）  string（文字・桃）  bool（はい／いいえ・赤）
//   entity（オブジェクト・青）  any（なんでも・灰）
// 数・文字・はい／いいえは、つなぐと自動で変換する（UE の自動変換ノードと同じ）。
//
// ここは画面にも DOM にも触らない（Node のテストでもそのまま動く）。実行は graph.js、
// オブジェクトや物理など世界そのものは world.js が受け持ち、ノードは api を通して世界を動かす。
import { tryEval, interpolate } from "./expr.js";

const EXEC_IN = { name: "exec", type: "exec", label: "" };
const THEN = { name: "then", type: "exec", label: "" };
const TARGET = { name: "target", type: "entity", label: "対象", self: true };

const pin = (name, type, label, extra = {}) => ({ name, type, label, ...extra });
const num = (name, label, def = 0, extra = {}) => pin(name, "number", label, { default: def, ...extra });
const str = (name, label, def = "", extra = {}) => pin(name, "string", label, { default: def, ...extra });
const bool = (name, label, def = true, extra = {}) => pin(name, "bool", label, { default: def, ...extra });

const USER_OUT = pin("user", "string", "人の名前");
const AVATAR_OUT = pin("avatar", "string", "アイコンの URL");

// ノードの中の設定（ピンではなく、ノードに書いておくもの。例：どのプレハブを出すか）
const field = (name, kind, label, def, extra = {}) => ({ name, kind, label, default: def, ...extra });

const SIDES = [["any", "どこでも"], ["bottom", "下"], ["top", "上"], ["left", "左"], ["right", "右"]];
const CHAT_MATCH = [["any", "どのコメントでも"], ["command", "コマンド（!jump など）"], ["contains", "この言葉を含む"], ["exact", "この言葉と同じ"]];
const SPAWN_PLACES = [
  ["xy", "座標（X・Y のピン）"], ["randomTop", "上の端のどこか（落ちてくる）"], ["randomBottom", "下の端のどこか"],
  ["randomLeft", "左の端のどこか"], ["randomRight", "右の端のどこか"], ["random", "画面のどこか"],
  ["center", "画面の中央"], ["origin", "置いた位置"],
];

const n0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const alive = (e) => !!e && typeof e === "object" && !e.dead;

/** 数のピンが「空のまま」か（空なら元の値のまま、の意味に使う） */
const blank = (v) => v === undefined || v === null || v === "";

/** @type {Record<string, object>} */
export const NODE_TYPES = {};

function def(type, spec) {
  NODE_TYPES[type] = { type, inputs: [], outputs: [], fields: [], keywords: "", ...spec };
}

// ===============================
// 🟥 イベント
// ===============================
def("event.start", {
  kind: "event", category: "イベント", title: "ゲームが始まったとき", keywords: "Event BeginPlay 開始 スタート",
  desc: "再生したとき・OBS に表示されたとき・「最初からやり直す」のたびに1回動きます。",
  outputs: [THEN],
});
def("event.tick", {
  kind: "event", category: "イベント", title: "毎フレーム", keywords: "Event Tick 毎回 ずっと",
  desc: "1秒に約60回、ずっと動きます。「経過秒」は前のフレームからの秒数（動きをなめらかにするときに掛ける）。重い処理は避けましょう。",
  outputs: [THEN, num("dt", "経過秒")],
});
def("event.every", {
  kind: "event", category: "イベント", title: "一定時間ごと", keywords: "Timer タイマー 秒ごと 繰り返し",
  desc: "設定した秒数ごとに動きます（タイマー）。",
  fields: [field("seconds", "number", "何秒ごと", 1, { min: 0.05, step: 0.05 })],
  outputs: [THEN, num("times", "何回目")],
});
def("event.signal", {
  kind: "event", category: "イベント", title: "合図を受けたとき", keywords: "Custom Event カスタムイベント シグナル",
  desc: "アーティストモードのルール「🎮 ギミックに合図」・「合図を出す」ノード・コンソールのボタンから動きます。合図を送ったイベントの人・個数なども受け取れます。",
  fields: [field("name", "signal", "合図の名前", "合図")],
  outputs: [THEN, USER_OUT, num("count", "個数"), num("coins", "コイン"), str("gift", "ギフト名"), str("comment", "コメント"), AVATAR_OUT],
});
def("event.when", {
  kind: "event", category: "イベント", title: "条件が成り立ったとき", keywords: "When 条件 満たした 判定",
  desc: "「条件」に「はい」がつながった瞬間に1回だけ動きます（成り立っていない → 成り立った、のとき）。",
  inputs: [bool("cond", "条件", false)],
  outputs: [THEN],
});
def("event.collide", {
  kind: "event", category: "イベント", title: "ぶつかったとき", keywords: "OnHit Overlap 当たり判定 衝突",
  desc: "タグ A のオブジェクトとタグ B のオブジェクトが触れた瞬間に動きます。空のタグはどれでも。",
  fields: [field("a", "tag", "タグ A（自分）", ""), field("b", "tag", "タグ B（相手）", "")],
  outputs: [THEN, pin("self", "entity", "自分（A）"), pin("other", "entity", "相手（B）")],
});
def("event.edge", {
  kind: "event", category: "イベント", title: "画面の端に着いたとき", keywords: "Edge 壁 画面外 端",
  desc: "タグのオブジェクトが画面の端に触れた瞬間に動きます。",
  fields: [field("tag", "tag", "タグ", ""), field("side", "select", "どの端", "any", { options: SIDES })],
  outputs: [THEN, pin("self", "entity", "オブジェクト")],
});
def("event.click", {
  kind: "event", category: "イベント", title: "クリックしたとき", keywords: "Click Touch タップ マウス",
  desc: "再生中の画面をクリックしたときに動きます（配信画面ではクリックできないので、確かめる用）。",
  fields: [field("tag", "tag", "タグ（空なら画面のどこでも）", "")],
  outputs: [THEN, pin("self", "entity", "クリックした物"), num("x", "X"), num("y", "Y")],
});
def("event.spawned", {
  kind: "event", category: "イベント", title: "オブジェクトが出てきたとき", keywords: "Spawned BeginPlay 生成 出現",
  desc: "「オブジェクトを出す」でこのオブジェクトが出てきたとき、1個ずつ動きます（出てきたものの向きや速さを決めるのに便利）。",
  fields: [field("object", "object", "オブジェクト", "")],
  outputs: [THEN, pin("self", "entity", "出てきた物"), num("index", "何個目")],
});
def("event.gift", {
  kind: "event", category: "TikTok LIVE", title: "ギフトが来たとき", keywords: "Gift 投げ銭 コイン",
  desc: "配信でギフトが届いたときに動きます。ギフト名（カンマ区切りで複数）や最低コインで絞れます。",
  fields: [field("giftName", "text", "ギフト名（空ならどれでも）", ""), field("minCoins", "number", "最低コイン", 0, { min: 0 })],
  outputs: [THEN, USER_OUT, str("gift", "ギフト名"), num("count", "個数"), num("coins", "コイン"), AVATAR_OUT, str("giftImage", "ギフトの画像")],
});
def("event.chat", {
  kind: "event", category: "TikTok LIVE", title: "コメントが来たとき", keywords: "Chat Comment コマンド",
  desc: "コメントが届いたときに動きます。「コマンド」なら「!jump 3」の「3」が「後ろの文字」に入ります。",
  fields: [field("match", "select", "条件", "any", { options: CHAT_MATCH }), field("keyword", "text", "言葉", "")],
  outputs: [THEN, USER_OUT, str("comment", "コメント"), str("args", "後ろの文字"), AVATAR_OUT],
});
def("event.like", {
  kind: "event", category: "TikTok LIVE", title: "いいねされたとき", keywords: "Like ハート",
  desc: "いいねが届いたときに動きます。「何件ごと」を 0 にすると、届くたびに（個数がいいねの数）。",
  fields: [field("every", "number", "何件ごと", 10, { min: 0 })],
  outputs: [THEN, USER_OUT, num("count", "回数・いいねの数")],
});
for (const [t, title, kw] of [["follow", "フォローされたとき", "Follow"], ["share", "シェアされたとき", "Share"], ["join", "入室したとき", "Join 来場"]]) {
  def(`event.${t}`, {
    kind: "event", category: "TikTok LIVE", title, keywords: kw,
    desc: `配信で${title.replace("とき", "")}ときに動きます。`,
    outputs: [THEN, USER_OUT, AVATAR_OUT],
  });
}

// ===============================
// ⬜ フロー
// ===============================
def("flow.branch", {
  kind: "flow", category: "フロー", title: "分岐（Branch）", keywords: "Branch If もし 条件",
  desc: "「条件」が「はい」なら上の出口、「いいえ」なら下の出口へ進みます。",
  inputs: [EXEC_IN, bool("cond", "条件", true)],
  outputs: [pin("true", "exec", "はい"), pin("false", "exec", "いいえ")],
  exec: (api, node, get) => (api.truthy(get("cond")) ? "true" : "false"),
});
def("flow.sequence", {
  kind: "flow", category: "フロー", title: "順番に（Sequence）", keywords: "Sequence 順番 まとめて",
  desc: "1 → 2 → 3… の出口を順番に全部実行します。1本の流れを枝分かれさせたいときに。",
  fields: [field("outs", "number", "出口の数", 3, { min: 2, max: 8 })],
  inputs: [EXEC_IN],
  outputs: (node) => Array.from({ length: Math.max(2, Math.min(8, Math.round(n0(node.values?.outs) || 3))) }, (_, i) => pin(`then${i}`, "exec", String(i + 1))),
  exec(api, node, get, X) {
    const outs = Math.max(2, Math.min(8, Math.round(n0(node.values?.outs) || 3)));
    for (let i = 0; i < outs; i++) api.runFrom(node, `then${i}`, X);
    return null;
  },
});
def("flow.delay", {
  kind: "flow", category: "フロー", title: "待つ（Delay）", keywords: "Delay Wait 秒 遅らせる",
  desc: "設定した秒数だけ待ってから、続きを実行します。",
  inputs: [EXEC_IN, num("seconds", "秒", 1, { min: 0 })],
  outputs: [pin("completed", "exec", "")],
  exec(api, node, get, X) {
    api.later(Math.max(0, n0(get("seconds"))), node, "completed", X);
    return null;
  },
});
def("flow.forLoop", {
  kind: "flow", category: "フロー", title: "くり返す（For Loop）", keywords: "For Loop ループ 回数 繰り返し",
  desc: "「最初」から「最後」まで1ずつ増やしながら「くり返し」を実行し、終わったら「終わったら」へ進みます（1回に 500 回まで）。",
  inputs: [EXEC_IN, num("first", "最初", 1), num("last", "最後", 3)],
  outputs: [pin("body", "exec", "くり返し"), num("index", "今の数"), pin("completed", "exec", "終わったら")],
  exec(api, node, get, X) {
    const a = Math.round(n0(get("first")));
    const b = Math.round(n0(get("last")));
    const limit = Math.min(b, a + 499);
    for (let i = a; i <= limit; i++) {
      X.outputs.set(node.id, { index: i });
      api.runFrom(node, "body", X);
      if (X.aborted) return null;
    }
    return "completed";
  },
});
def("flow.forEach", {
  kind: "flow", category: "フロー", title: "タグの全部に（For Each）", keywords: "For Each ForEach 全部 タグ ループ",
  desc: "タグが付いたオブジェクト1つずつに「くり返し」を実行します。「オブジェクト」に今のものが入ります。",
  inputs: [EXEC_IN, str("tag", "タグ", "")],
  outputs: [pin("body", "exec", "くり返し"), pin("element", "entity", "オブジェクト"), num("index", "何個目"), pin("completed", "exec", "終わったら")],
  exec(api, node, get, X) {
    const list = api.withTag(String(get("tag") ?? "")).slice(0, 500);
    list.forEach((e, i) => {
      if (X.aborted) return;
      X.outputs.set(node.id, { element: e, index: i });
      api.runFrom(node, "body", X);
    });
    return "completed";
  },
});
def("flow.doOnce", {
  kind: "flow", category: "フロー", title: "一度だけ（Do Once）", keywords: "Do Once 1回 一回",
  desc: "最初の1回だけ先へ進みます。「もう一度」に流すと、また1回だけ通るようになります。",
  inputs: [EXEC_IN, pin("reset", "exec", "もう一度")],
  outputs: [THEN],
  exec(api, node, get, X, pinIn) {
    const st = api.state(node, X);
    if (pinIn === "reset") { st.done = false; return null; }
    if (st.done) return null;
    st.done = true;
    return "then";
  },
});
def("flow.flipFlop", {
  kind: "flow", category: "フロー", title: "交互に（Flip Flop）", keywords: "FlipFlop 交互 かわりばんこ",
  desc: "流れてくるたびに A → B → A → B… と出口を替えます。",
  inputs: [EXEC_IN],
  outputs: [pin("a", "exec", "A"), pin("b", "exec", "B"), bool("isA", "A だった")],
  exec(api, node, get, X) {
    const st = api.state(node, X);
    st.a = !st.a;
    return { next: st.a ? "a" : "b", out: { isA: st.a } };
  },
});
def("flow.chance", {
  kind: "flow", category: "フロー", title: "確率で分岐", keywords: "Random Chance 確率 ランダム ガチャ",
  desc: "「確率」％で「当たり」、それ以外は「はずれ」へ進みます。",
  inputs: [EXEC_IN, num("percent", "確率（%）", 50, { min: 0, max: 100 })],
  outputs: [pin("yes", "exec", "当たり"), pin("no", "exec", "はずれ")],
  exec: (api, node, get) => (api.random() * 100 < n0(get("percent")) ? "yes" : "no"),
});
def("flow.cooldown", {
  kind: "flow", category: "フロー", title: "クールダウン", keywords: "Cooldown 連打 間隔 制限",
  desc: "一度通ったら、設定した秒数のあいだは「クールダウン中」へ進みます（ギフトの連打で演出が重ならないように）。",
  inputs: [EXEC_IN, num("seconds", "秒", 3, { min: 0 })],
  outputs: [THEN, pin("blocked", "exec", "クールダウン中")],
  exec(api, node, get, X) {
    const st = api.state(node, X);
    if (st.at !== undefined && api.time() - st.at < n0(get("seconds"))) return "blocked";
    st.at = api.time();
    return "then";
  },
});

// ===============================
// 🟦 アクション：オブジェクト
// ===============================
def("action.spawn", {
  kind: "action", category: "オブジェクト", title: "オブジェクトを出す", keywords: "Spawn Actor 生成 出す 降らせる プレハブ",
  desc: "プレハブ（または置いたオブジェクト）を複製して出します。速さ・文字・画像のピンは、空ならプレハブのまま。出したもの（最後の1個）が「出したもの」に入ります。",
  fields: [field("prefab", "prefab", "出すもの", ""), field("at", "select", "場所", "randomTop", { options: SPAWN_PLACES })],
  inputs: (node) => [
    EXEC_IN,
    ...(node.values?.at === "xy" ? [num("x", "X（中心）", 400), num("y", "Y（中心）", 300)] : []),
    num("count", "数", 1, { min: 0 }),
    num("vx", "速さ X", "", { optional: true }),
    num("vy", "速さ Y", "", { optional: true }),
    str("text", "文字", "", { optional: true }),
    str("image", "画像の URL", "", { optional: true, hint: "イベントの「アイコンの URL」「ギフトの画像」をつなぐと、その画像になります" }),
  ],
  outputs: [THEN, pin("spawned", "entity", "出したもの")],
  exec(api, node, get, X) {
    const at = node.values?.at || "randomTop";
    const made = api.spawn(node.values?.prefab, {
      at,
      x: at === "xy" ? n0(get("x")) : undefined,
      y: at === "xy" ? n0(get("y")) : undefined,
      count: n0(get("count")),
      vx: get("vx"), vy: get("vy"), text: get("text"), image: get("image"),
    }, X);
    return { next: "then", out: { spawned: made[made.length - 1] || null } };
  },
});
def("action.destroy", {
  kind: "action", category: "オブジェクト", title: "オブジェクトを消す", keywords: "Destroy Actor 削除 消す",
  desc: "対象を消します。対象が空なら、このイベントのオブジェクト（ぶつかった自分・クリックした物など）。",
  fields: [field("effect", "effect", "消えるときのエフェクト", "")],
  inputs: [EXEC_IN, TARGET],
  outputs: [THEN],
  exec(api, node, get) {
    const e = get("target");
    if (alive(e)) api.kill(e, node.values?.effect);
    return "then";
  },
});
def("action.destroyTag", {
  kind: "action", category: "オブジェクト", title: "タグのオブジェクトを全部消す", keywords: "Destroy All 全部消す 片付け",
  desc: "タグが付いたオブジェクトを全部消します。",
  fields: [field("effect", "effect", "消えるときのエフェクト", "")],
  inputs: [EXEC_IN, str("tag", "タグ", "")],
  outputs: [THEN, num("count", "消した数")],
  exec(api, node, get) {
    const list = api.withTag(String(get("tag") ?? ""));
    list.forEach((e) => api.kill(e, node.values?.effect));
    return { next: "then", out: { count: list.length } };
  },
});
def("action.setPosition", {
  kind: "action", category: "オブジェクト", title: "位置を決める", keywords: "Set Location Teleport 移動 ワープ",
  desc: "対象の真ん中をその座標へすぐに動かします。",
  inputs: [EXEC_IN, TARGET, num("x", "X（中心）", 400), num("y", "Y（中心）", 300)],
  outputs: [THEN],
  exec(api, node, get) {
    const e = get("target");
    if (alive(e)) { e.tween = null; e.x = n0(get("x")) - e.w / 2; e.y = n0(get("y")) - e.h / 2; }
    return "then";
  },
});
def("action.moveTo", {
  kind: "action", category: "オブジェクト", title: "なめらかに移動", keywords: "Move To Tween Lerp アニメーション",
  desc: "対象を、秒数をかけてなめらかにその座標へ動かします。「今の位置から」をオンにすると、X・Y だけずらします。",
  fields: [field("relative", "bool", "今の位置から（ずらす）", false)],
  inputs: [EXEC_IN, TARGET, num("x", "X", 400), num("y", "Y", 300), num("seconds", "秒", 0.5, { min: 0.01 })],
  outputs: [THEN],
  exec(api, node, get) {
    const e = get("target");
    if (!alive(e)) return "then";
    const rel = !!node.values?.relative;
    const x = n0(get("x"));
    const y = n0(get("y"));
    api.tween(e, rel ? e.x + x : x - e.w / 2, rel ? e.y + y : y - e.h / 2, n0(get("seconds")));
    return "then";
  },
});
def("action.setVelocity", {
  kind: "action", category: "オブジェクト", title: "速さを決める", keywords: "Set Velocity Impulse はじく ジャンプ 速度",
  desc: "対象の速さ（1秒に何 px 進むか）を決めます。「今の速さに足す」をオンにすると、はじくように足します（ジャンプなど）。",
  fields: [field("add", "bool", "今の速さに足す（はじく）", false)],
  inputs: [EXEC_IN, TARGET, num("vx", "速さ X", 0), num("vy", "速さ Y", -600)],
  outputs: [THEN],
  exec(api, node, get) {
    const e = get("target");
    if (!alive(e)) return "then";
    e.tween = null;
    if (node.values?.add) { e.vx += n0(get("vx")); e.vy += n0(get("vy")); } else { e.vx = n0(get("vx")); e.vy = n0(get("vy")); }
    return "then";
  },
});
def("action.moveToward", {
  kind: "action", category: "オブジェクト", title: "相手に向かって進む", keywords: "Move Toward Chase 追いかける 向かう",
  desc: "対象が「相手」（空なら画面の中央）に向かって、その速さで進むようにします。",
  inputs: [EXEC_IN, TARGET, pin("toward", "entity", "相手"), num("speed", "速さ", 300)],
  outputs: [THEN],
  exec(api, node, get) {
    const e = get("target");
    if (!alive(e)) return "then";
    const t = get("toward");
    const tx = alive(t) ? t.x + t.w / 2 : api.W() / 2;
    const ty = alive(t) ? t.y + t.h / 2 : api.H() / 2;
    const dx = tx - (e.x + e.w / 2);
    const dy = ty - (e.y + e.h / 2);
    const d = Math.hypot(dx, dy) || 1;
    const sp = n0(get("speed"));
    e.tween = null;
    e.vx = (dx / d) * sp;
    e.vy = (dy / d) * sp;
    return "then";
  },
});

// 見た目を変えるノード（どれも「対象」と値が1つ）
function setter(type, title, keywords, desc, input, apply) {
  def(type, {
    kind: "action", category: "見た目", title, keywords, desc,
    inputs: [EXEC_IN, TARGET, ...[].concat(input)],
    outputs: [THEN],
    exec(api, node, get) {
      const e = get("target");
      if (alive(e)) apply(e, get, api, node);
      return "then";
    },
  });
}
setter("action.setText", "文字を変える", "Set Text 文字 テキスト", "対象の文字を変えます。{score} や {user} はそのまま差し込まれます。", str("text", "文字", "{user}"), (e, get) => { e.look.text = String(get("text") ?? ""); });
setter("action.setColor", "色を変える", "Set Color 色 カラー", "対象の塗り（文字なら文字の色）を変えます。#ff5c8a のように書きます。", str("color", "色", "#ff5c8a"), (e, get) => {
  if (e.look.shape === "text") e.look.textColor = String(get("color") ?? ""); else e.look.fill = String(get("color") ?? "");
});
setter("action.setEmoji", "絵文字を変える", "Set Emoji 絵文字", "対象を絵文字の形にして、その絵文字にします。", str("emoji", "絵文字", "⭐"), (e, get) => { e.look.shape = "emoji"; e.look.emoji = String(get("emoji") ?? ""); });
setter("action.setImage", "画像を変える", "Set Image Texture 画像 アイコン", "対象を画像の形にして、その URL の画像にします（イベントの「アイコンの URL」「ギフトの画像」をつなぐと便利）。", str("url", "画像の URL", ""), (e, get) => {
  const u = String(get("url") ?? "");
  if (u) { e.look.shape = "image"; e.look.src = u; }
});
setter("action.setVisible", "表示する／隠す", "Set Visibility Hidden 表示 非表示 隠す", "対象を表示する（はい）か、隠す（いいえ）かを決めます。", bool("visible", "表示する", true), (e, get, api) => { e.hidden = !api.truthy(get("visible")); });
setter("action.setScale", "大きさの倍率", "Set Scale 拡大 縮小 倍率", "対象の見た目の大きさを何倍にするか決めます（1 で元の大きさ）。", num("scale", "倍率", 1.5, { min: 0 }), (e, get) => { e.scale = Math.max(0, Math.min(50, n0(get("scale")))); });
setter("action.setRotation", "回転", "Set Rotation 回す 角度", "対象の角度を決めます（度）。", num("rotation", "角度", 0), (e, get) => { e.rotation = n0(get("rotation")); });
setter("action.setOpacity", "不透明度", "Set Opacity Alpha 透明 薄く", "対象の不透明度（0 で見えない・1 でくっきり）を決めます。", num("opacity", "不透明度", 1, { min: 0, max: 1 }), (e, get) => { e.opacity = Math.max(0, Math.min(1, n0(get("opacity")))); });
setter("action.setSize", "幅と高さ", "Set Size 大きさ ゲージ 伸ばす", "対象の幅と高さを決めます（左上はそのまま。ゲージを伸ばすのに便利）。空のピンは元のまま。", [num("w", "幅", "", { optional: true }), num("h", "高さ", "", { optional: true })], (e, get) => {
  if (!blank(get("w"))) e.w = Math.max(1, n0(get("w")));
  if (!blank(get("h"))) e.h = Math.max(1, n0(get("h")));
});
setter("action.setTag", "タグを変える", "Set Tag タグ", "対象のタグを変えます。", str("tag", "タグ", ""), (e, get) => { e.tag = String(get("tag") ?? ""); });

// ===============================
// 🟦 アクション：演出
// ===============================
def("action.playSound", {
  kind: "action", category: "演出", title: "音を鳴らす", keywords: "Play Sound SE 効果音 サウンド",
  desc: "アセットのサウンドを鳴らします。",
  fields: [field("sound", "sound", "サウンド", "")],
  inputs: [EXEC_IN, num("volume", "音量", 1, { min: 0, max: 1 })],
  outputs: [THEN],
  exec(api, node, get) {
    api.playSound(node.values?.sound, Math.max(0, Math.min(1, n0(get("volume")))));
    return "then";
  },
});
def("action.playEffect", {
  kind: "action", category: "演出", title: "エフェクトを出す", keywords: "Spawn Emitter Particle パーティクル エフェクト",
  desc: "アセットのエフェクトを、その座標に出します。",
  fields: [field("effect", "effect", "エフェクト", "")],
  inputs: [EXEC_IN, num("x", "X", 400), num("y", "Y", 300)],
  outputs: [THEN],
  exec(api, node, get) {
    api.playEffect(node.values?.effect, n0(get("x")), n0(get("y")));
    return "then";
  },
});
def("action.playEffectOn", {
  kind: "action", category: "演出", title: "オブジェクトの所にエフェクト", keywords: "Spawn Emitter Attached パーティクル エフェクト",
  desc: "対象の真ん中にエフェクトを出します。対象が空なら、このイベントのオブジェクト。",
  fields: [field("effect", "effect", "エフェクト", "")],
  inputs: [EXEC_IN, TARGET],
  outputs: [THEN],
  exec(api, node, get) {
    const e = get("target");
    if (alive(e)) api.playEffect(node.values?.effect, e.x + e.w / 2, e.y + e.h / 2);
    return "then";
  },
});
def("action.shake", {
  kind: "action", category: "演出", title: "画面を揺らす", keywords: "Camera Shake 揺れ 振動",
  desc: "ステージ全体を揺らします。",
  inputs: [EXEC_IN, num("strength", "強さ（px）", 12, { min: 0 }), num("seconds", "秒", 0.4, { min: 0.05 })],
  outputs: [THEN],
  exec(api, node, get) { api.shake(n0(get("strength")), n0(get("seconds"))); return "then"; },
});
def("action.flash", {
  kind: "action", category: "演出", title: "画面を光らせる", keywords: "Flash Fade 光 フラッシュ",
  desc: "ステージ全体をその色で一瞬光らせます。",
  inputs: [EXEC_IN, str("color", "色", "#ffffff"), num("seconds", "秒", 0.3, { min: 0.05 })],
  outputs: [THEN],
  exec(api, node, get) { api.flash(String(get("color") ?? "#ffffff"), n0(get("seconds"))); return "then"; },
});

// ===============================
// 🟦 アクション：ゲーム
// ===============================
def("action.emit", {
  kind: "action", category: "ゲーム", title: "合図を出す", keywords: "Call Custom Event シグナル 呼ぶ",
  desc: "同じギミックの「合図を受けたとき」を動かします。今のイベントの人・個数などもそのまま渡します。",
  fields: [field("name", "signal", "合図の名前", "合図")],
  inputs: [EXEC_IN],
  outputs: [THEN],
  exec(api, node, get, X) {
    api.signal(String(node.values?.name ?? ""), X);
    return "then";
  },
});
def("action.restart", {
  kind: "action", category: "ゲーム", title: "最初からやり直す", keywords: "Restart Reset Level リセット",
  desc: "オブジェクト・変数を始めの状態に戻して、「ゲームが始まったとき」から動かし直します。",
  inputs: [EXEC_IN],
  outputs: [],
  exec(api) { api.restart(); return null; },
});
def("action.print", {
  kind: "action", category: "ゲーム", title: "コンソールに書く（Print）", keywords: "Print String Log デバッグ ログ",
  desc: "下のコンソールに文字を書きます（確かめる用。配信画面には出ません）。{score} などを差し込めます。",
  inputs: [EXEC_IN, str("text", "文字", "こんにちは")],
  outputs: [THEN],
  exec(api, node, get, X) { api.log(api.format(String(get("text") ?? ""), X)); return "then"; },
});

// ===============================
// 🔢 変数
// ===============================
const varType = (g, name) => {
  const v = (g?.variables || []).find((x) => x.name === name);
  return v && typeof v.value === "number" ? "number" : v ? "string" : "any";
};
def("var.get", {
  kind: "var", category: "変数", title: "変数を読む（Get）", keywords: "Get Variable 変数 値",
  desc: "変数の今の値を読みます。",
  fields: [field("var", "var", "変数", "")],
  outputs: (node, g) => [pin("value", varType(g, node.values?.var), node.values?.var || "値")],
  compute: (api, node) => ({ value: api.getVar(node.values?.var) }),
});
def("var.set", {
  kind: "action", category: "変数", title: "変数に入れる（Set）", keywords: "Set Variable 代入 変数",
  desc: "変数に値を入れます。",
  fields: [field("var", "var", "変数", "")],
  inputs: (node, g) => [EXEC_IN, pin("value", varType(g, node.values?.var), "値", { default: varType(g, node.values?.var) === "number" ? 0 : "" })],
  outputs: (node, g) => [THEN, pin("value", varType(g, node.values?.var), "新しい値")],
  exec(api, node, get) {
    const v = api.setVar(node.values?.var, get("value"));
    return { next: "then", out: { value: v } };
  },
});
def("var.add", {
  kind: "action", category: "変数", title: "変数に足す", keywords: "Increment Add 加算 増やす 減らす スコア",
  desc: "変数に数を足します（マイナスなら引きます）。スコアを増やすときなどに。",
  fields: [field("var", "var", "変数", "")],
  inputs: [EXEC_IN, num("amount", "足す数", 1)],
  outputs: [THEN, num("value", "新しい値")],
  exec(api, node, get) {
    const v = api.setVar(node.values?.var, n0(api.getVar(node.values?.var)) + n0(get("amount")));
    return { next: "then", out: { value: v } };
  },
});

// ===============================
// 🟩 ピュア：計算
// ===============================
function math(type, symbol, title, keywords, fn, inputs = ["a", "b"], defs = [0, 1]) {
  def(type, {
    kind: "pure", category: "計算", title, compact: symbol, keywords,
    desc: `${title}を計算します。`,
    inputs: inputs.map((p, i) => num(p, p.toUpperCase(), defs[i] ?? 0)),
    outputs: [num("result", "答え")],
    compute: (api, node, get) => {
      const v = fn(...inputs.map((p) => n0(get(p))), api);
      return { result: Number.isFinite(v) ? v : 0 };
    },
  });
}
math("math.add", "+", "足し算", "Add Plus 足す たす +", (a, b) => a + b, ["a", "b"], [0, 1]);
math("math.sub", "−", "引き算", "Subtract Minus 引く ひく -", (a, b) => a - b, ["a", "b"], [0, 1]);
math("math.mul", "×", "かけ算", "Multiply Times かける *", (a, b) => a * b, ["a", "b"], [1, 2]);
math("math.div", "÷", "わり算", "Divide わる /", (a, b) => (b === 0 ? 0 : a / b), ["a", "b"], [1, 2]);
math("math.mod", "%", "あまり", "Modulo Remainder 余り", (a, b) => (b === 0 ? 0 : a % b), ["a", "b"], [0, 2]);
math("math.min", "MIN", "小さい方", "Min 最小", (a, b) => Math.min(a, b), ["a", "b"], [0, 10]);
math("math.max", "MAX", "大きい方", "Max 最大", (a, b) => Math.max(a, b), ["a", "b"], [0, 10]);
math("math.abs", "ABS", "絶対値", "Abs 絶対値 プラス", (a) => Math.abs(a), ["a"], [0]);
def("math.clamp", {
  kind: "pure", category: "計算", title: "範囲に収める（Clamp）", keywords: "Clamp 範囲 制限",
  desc: "値を「最小」と「最大」の間に収めます。",
  inputs: [num("value", "値", 0), num("min", "最小", 0), num("max", "最大", 100)],
  outputs: [num("result", "答え")],
  compute: (api, node, get) => ({ result: Math.min(n0(get("max")), Math.max(n0(get("min")), n0(get("value")))) }),
});
def("math.round", {
  kind: "pure", category: "計算", title: "整数にする", keywords: "Round Floor Ceil 四捨五入 切り捨て 切り上げ",
  desc: "四捨五入・切り捨て・切り上げで整数にします。",
  fields: [field("mode", "select", "しかた", "round", { options: [["round", "四捨五入"], ["floor", "切り捨て"], ["ceil", "切り上げ"]] })],
  inputs: [num("value", "値", 0)],
  outputs: [num("result", "答え")],
  compute: (api, node, get) => ({ result: Math[["floor", "ceil"].includes(node.values?.mode) ? node.values.mode : "round"](n0(get("value"))) }),
});
def("math.random", {
  kind: "pure", category: "計算", title: "ランダムな数", keywords: "Random Range 乱数 ランダム",
  desc: "「最小」から「最大」までのどれかの数（つながった先が読むたびに変わる）。「整数だけ」をオンにすると整数（両端を含む）。",
  fields: [field("int", "bool", "整数だけ", false)],
  inputs: [num("min", "最小", 0), num("max", "最大", 100)],
  outputs: [num("result", "数")],
  compute(api, node, get) {
    const a = n0(get("min"));
    const b = n0(get("max"));
    return { result: node.values?.int ? Math.floor(a + api.random() * (Math.floor(b) - a + 1)) : a + api.random() * (b - a) };
  },
});
def("expr", {
  kind: "pure", category: "計算", title: "式（Expression）", keywords: "Expression Math Formula 式 数式 計算",
  desc: "式で計算します。ピン A・B・C の値は式の中で a・b・c、変数は名前のまま（score）、ステージの大きさは W・H で読めます。例：a * 2 + score",
  fields: [field("expr", "expr", "式", "a + b")],
  inputs: [pin("a", "any", "A", { default: 0 }), pin("b", "any", "B", { default: 0 }), pin("c", "any", "C", { default: 0 })],
  outputs: [pin("result", "any", "答え")],
  compute(api, node, get, X) {
    const r = tryEval(String(node.values?.expr ?? ""), api.scope(X, { a: () => get("a"), b: () => get("b"), c: () => get("c") }));
    if (r.error) api.warnOnce(`expr:${node.id}:${node.values?.expr}`, `式が読めません: ${node.values?.expr} … ${r.error}`);
    return { result: r.value };
  },
});

// ===============================
// 🟩 ピュア：比べる・論理
// ===============================
function cmp(type, symbol, title, keywords, fn) {
  def(type, {
    kind: "pure", category: "比べる・論理", title, compact: symbol, keywords,
    desc: `A と B を比べて、${title}なら「はい」。`,
    inputs: [pin("a", "any", "A", { default: 0 }), pin("b", "any", "B", { default: 0 })],
    outputs: [bool("result", "結果")],
    compute: (api, node, get) => ({ result: fn(get("a"), get("b")) }),
  });
}
const same = (a, b) => (typeof a === "string" || typeof b === "string" ? String(a ?? "") === String(b ?? "") : n0(a) === n0(b));
cmp("cmp.eq", "＝", "同じ", "Equal == イコール 等しい", same);
cmp("cmp.neq", "≠", "違う", "Not Equal != 等しくない", (a, b) => !same(a, b));
cmp("cmp.lt", "＜", "A が小さい", "Less < 未満", (a, b) => n0(a) < n0(b));
cmp("cmp.lte", "≦", "A が B 以下", "Less Equal <= 以下", (a, b) => n0(a) <= n0(b));
cmp("cmp.gt", "＞", "A が大きい", "Greater > より大きい", (a, b) => n0(a) > n0(b));
cmp("cmp.gte", "≧", "A が B 以上", "Greater Equal >= 以上", (a, b) => n0(a) >= n0(b));
def("logic.and", {
  kind: "pure", category: "比べる・論理", title: "かつ（AND）", compact: "AND", keywords: "And かつ 両方",
  desc: "A も B も「はい」なら「はい」。",
  inputs: [bool("a", "A", true), bool("b", "B", true)], outputs: [bool("result", "結果")],
  compute: (api, node, get) => ({ result: api.truthy(get("a")) && api.truthy(get("b")) }),
});
def("logic.or", {
  kind: "pure", category: "比べる・論理", title: "または（OR）", compact: "OR", keywords: "Or または どちらか",
  desc: "A か B のどちらかが「はい」なら「はい」。",
  inputs: [bool("a", "A", false), bool("b", "B", false)], outputs: [bool("result", "結果")],
  compute: (api, node, get) => ({ result: api.truthy(get("a")) || api.truthy(get("b")) }),
});
def("logic.not", {
  kind: "pure", category: "比べる・論理", title: "ではない（NOT）", compact: "NOT", keywords: "Not 反対 逆",
  desc: "「はい」と「いいえ」を入れ替えます。",
  inputs: [bool("a", "A", false)], outputs: [bool("result", "結果")],
  compute: (api, node, get) => ({ result: !api.truthy(get("a")) }),
});

// ===============================
// 🟩 ピュア：文字
// ===============================
def("text.format", {
  kind: "pure", category: "文字", title: "文字を作る（Format）", keywords: "Format Append 文字 つなぐ 差し込む",
  desc: "「{a} さん +{b}点」のように、ピン A・B・C や変数（{score}）を差し込んだ文字を作ります。",
  fields: [field("template", "text", "文字", "{a} さん ありがとう！")],
  inputs: [pin("a", "any", "A", { default: "" }), pin("b", "any", "B", { default: "" }), pin("c", "any", "C", { default: "" })],
  outputs: [str("result", "文字")],
  compute: (api, node, get, X) => ({
    result: interpolate(String(node.values?.template ?? ""), api.scope(X, { a: () => get("a"), b: () => get("b"), c: () => get("c") })),
  }),
});
def("text.contains", {
  kind: "pure", category: "文字", title: "含む？", keywords: "Contains 含む 検索",
  desc: "文字に言葉が含まれていれば「はい」（大文字小文字は区別しない）。",
  inputs: [str("text", "文字", ""), str("part", "言葉", "")],
  outputs: [bool("result", "結果")],
  compute: (api, node, get) => ({ result: String(get("text") ?? "").toLowerCase().includes(String(get("part") ?? "").toLowerCase()) }),
});
def("text.length", {
  kind: "pure", category: "文字", title: "文字数", keywords: "Length Len 長さ",
  desc: "文字の数を数えます。",
  inputs: [str("text", "文字", "")],
  outputs: [num("result", "文字数")],
  compute: (api, node, get) => ({ result: [...String(get("text") ?? "")].length }),
});

// ===============================
// 🟩 ピュア：情報
// ===============================
def("get.entity", {
  kind: "pure", category: "情報", title: "オブジェクトの情報", keywords: "Break Get Actor Location 位置 座標 情報",
  desc: "オブジェクトの位置（真ん中）・速さ・大きさなどを取り出します。空なら、このイベントのオブジェクト。",
  inputs: [TARGET],
  outputs: [num("x", "X（中心）"), num("y", "Y（中心）"), num("vx", "速さ X"), num("vy", "速さ Y"), num("w", "幅"), num("h", "高さ"),
    num("rotation", "回転"), str("tag", "タグ"), str("text", "文字"), str("user", "出したときの人"), bool("valid", "まだある")],
  compute(api, node, get) {
    const e = get("target");
    if (!alive(e)) return { x: 0, y: 0, vx: 0, vy: 0, w: 0, h: 0, rotation: 0, tag: "", text: "", user: "", valid: false };
    return {
      x: e.x + e.w / 2, y: e.y + e.h / 2, vx: e.vx, vy: e.vy, w: e.w, h: e.h, rotation: e.rotation,
      tag: e.tag, text: e.look.text, user: e.data?.user ?? "", valid: true,
    };
  },
});
def("get.findTag", {
  kind: "pure", category: "情報", title: "タグで探す", keywords: "Find Get All Actors タグ 検索 数える count",
  desc: "タグが付いたオブジェクトを探します。「数」はいくつあるか（0 なら全部なくなった）。",
  fields: [field("pick", "select", "どれ", "first", { options: [["first", "最初の1つ"], ["last", "最後の1つ"], ["random", "どれか1つ"]] })],
  inputs: [str("tag", "タグ", "")],
  outputs: [pin("found", "entity", "オブジェクト"), num("count", "数")],
  compute(api, node, get) {
    const list = api.withTag(String(get("tag") ?? ""));
    const pick = node.values?.pick;
    const found = list.length ? (pick === "last" ? list[list.length - 1] : pick === "random" ? list[Math.floor(api.random() * list.length)] : list[0]) : null;
    return { found, count: list.length };
  },
});
def("get.object", {
  kind: "pure", category: "情報", title: "置いたオブジェクト", keywords: "Get Reference 参照 オブジェクト",
  desc: "ステージに置いたオブジェクト（プレハブなら出した最初の1つ）を指します。「文字を変える」などの対象につなぎます。",
  fields: [field("object", "object", "オブジェクト", "")],
  outputs: [pin("found", "entity", "オブジェクト")],
  compute: (api, node) => ({ found: api.instanceOf(node.values?.object) }),
});
def("get.stage", {
  kind: "pure", category: "情報", title: "ステージ", keywords: "Stage Screen Size Time 画面 大きさ 時間",
  desc: "ステージの幅・高さ・真ん中と、始まってからの秒数。",
  outputs: [num("w", "幅"), num("h", "高さ"), num("cx", "真ん中 X"), num("cy", "真ん中 Y"), num("time", "秒")],
  compute: (api) => ({ w: api.W(), h: api.H(), cx: api.W() / 2, cy: api.H() / 2, time: api.time() }),
});

// ===============================
// 🟪 関数・マクロ（自作のノード）
// ===============================
// ギミックの functions に [{id, name, kind: "function" | "macro", pure, desc, inputs, outputs, graph}] で入る。
// inputs / outputs は [{id: "p1", name: "強さ", type}]。id がそのままピンの名前になる。
// 実行ピン（exec）を入出力に持てるのはマクロだけ。
export const PARAM_TYPES = ["number", "string", "bool", "entity", "any"];
const PARAM_DEFAULTS = { number: 0, string: "", bool: false, any: "" };

/** 関数・マクロを id で探す */
export function fnOf(g, id) {
  return (g?.functions || []).find((f) => f.id === id) || null;
}

/** 入出力の1つを、ピンにする */
function paramPin(p) {
  if (p.type === "exec") return pin(p.id, "exec", p.name || "");
  if (p.type === "entity") return pin(p.id, "entity", p.name || "", { self: true });
  return pin(p.id, PIN_TYPE_LABELS[p.type] ? p.type : "any", p.name || "", { default: PARAM_DEFAULTS[p.type] ?? "" });
}
const params = (list, withExec) => (list || []).filter((p) => withExec || p.type !== "exec").map(paramPin);
const hasExec = (f) => [...(f?.inputs || []), ...(f?.outputs || [])].some((p) => p.type === "exec");
const lostName = (kind) => (kind === "macro" ? "（見つからないマクロ）" : "（見つからない関数）");

def("fn.entry", {
  kind: "entry", category: "関数", title: "入口", hidden: true, inner: "function",
  desc: "関数の始まり。呼ばれると、ここから右へ実行します。右のピンは、呼んだ側から渡された入力の値です。",
  titleOf: (node, g) => fnOf(g, node.values?.fn)?.name || "入口",
  outputs: (node, g) => [THEN, ...params(fnOf(g, node.values?.fn)?.inputs, false)],
});
def("fn.return", {
  kind: "entry", category: "関数", title: "出口（Return）", hidden: true, inner: "function", keywords: "Return 戻る 返す 出口",
  desc: "ここに着くと関数が終わり、左のピンの値を出力として、呼んだ所へ戻ります。分岐ごとに出口を置いても大丈夫です。",
  inputs: (node, g) => [EXEC_IN, ...params(fnOf(g, node.values?.fn)?.outputs, false)],
  exec(api, node, get, X) {
    api.returnFrom(node, get, X);
    return null;
  },
});
def("macro.in", {
  kind: "entry", category: "マクロ", title: "入口", hidden: true, inner: "macro",
  desc: "マクロの始まり。呼んだ所の実行ピンから流れてくると、同じ名前のピンから続きます。値のピンは、呼んだ所につながっている値を読みます。",
  titleOf: (node, g) => fnOf(g, node.values?.fn)?.name || "入口",
  outputs: (node, g) => params(fnOf(g, node.values?.fn)?.inputs, true),
});
def("macro.out", {
  kind: "entry", category: "マクロ", title: "出口", hidden: true, inner: "macro", keywords: "Output 出口 戻る",
  desc: "ここに流れてくると、呼んだ所の同じ名前の実行ピンから続きます（左の値のピンが、呼んだ所の出力になります）。",
  inputs: (node, g) => params(fnOf(g, node.values?.fn)?.outputs, true),
  exec(api, node, get, X, pinIn) {
    api.leaveMacro(node, get, X, pinIn);
    return null;
  },
});
def("call.function", {
  kind: "action", category: "関数", title: "関数を呼ぶ", hidden: true, keywords: "Function Call 関数",
  desc: "自分で作った関数を呼びます。",
  fields: [field("fn", "function", "呼ぶ関数", "", { onNode: false })],
  isPure: (node, g) => !!fnOf(g, node.values?.fn)?.pure,
  kindOf: (node, g) => (fnOf(g, node.values?.fn)?.pure ? "pure" : "action"),
  titleOf: (node, g) => fnOf(g, node.values?.fn)?.name || lostName("function"),
  descOf: (node, g) => fnOf(g, node.values?.fn)?.desc || "",
  inputs(node, g) {
    const f = fnOf(g, node.values?.fn);
    const ps = params(f?.inputs, false);
    return f?.pure ? ps : [EXEC_IN, ...ps];
  },
  outputs(node, g) {
    const f = fnOf(g, node.values?.fn);
    const ps = params(f?.outputs, false);
    return f?.pure ? ps : [THEN, ...ps];
  },
  exec: (api, node, get, X) => ({ next: "then", out: api.callFunction(node, get, X) }),
  compute: (api, node, get, X) => api.callFunction(node, get, X),
});
def("call.macro", {
  kind: "flow", category: "マクロ", title: "マクロを呼ぶ", hidden: true, keywords: "Macro マクロ",
  desc: "自分で作ったマクロを呼びます。",
  fields: [field("fn", "macro", "呼ぶマクロ", "", { onNode: false })],
  // 実行ピンが1つも無いマクロは、計算ノードと同じ（読まれるたびに中身を計算する）
  isPure: (node, g) => { const f = fnOf(g, node.values?.fn); return !!f && !hasExec(f); },
  kindOf: (node, g) => { const f = fnOf(g, node.values?.fn); return f && !hasExec(f) ? "pure" : "flow"; },
  titleOf: (node, g) => fnOf(g, node.values?.fn)?.name || lostName("macro"),
  descOf: (node, g) => fnOf(g, node.values?.fn)?.desc || "",
  inputs: (node, g) => params(fnOf(g, node.values?.fn)?.inputs, true),
  outputs: (node, g) => params(fnOf(g, node.values?.fn)?.outputs, true),
  exec(api, node, get, X, pinIn) {
    api.enterMacro(node, pinIn, X);
    return null;
  },
  compute: (api, node, get, X) => api.pureMacro(node, X),
});

/** ノードの仲間（呼ぶノードは、呼ぶ先がピュアかで変わる） */
export function nodeKind(node, g) {
  const d = NODE_TYPES[node?.type];
  return d?.kindOf ? d.kindOf(node, g) : d?.kind;
}

/** ノードの見出し（呼ぶノードは関数・マクロの名前） */
export function nodeTitle(node, g) {
  const d = NODE_TYPES[node?.type];
  return d?.titleOf ? d.titleOf(node, g) : d?.title || "";
}

/** そのノードを置けるグラフか（null ＝ イベントグラフ、"function"、"macro"） */
export function allowedIn(type, where) {
  const d = NODE_TYPES[type];
  if (!d) return false;
  if (d.inner) return d.inner === where;
  if (d.kind === "event") return where === null;
  return true;
}

// ===============================
// 並べ方（パレットの順番）と小道具
// ===============================
export const CATEGORIES = ["イベント", "TikTok LIVE", "関数", "マクロ", "フロー", "オブジェクト", "見た目", "演出", "ゲーム", "変数", "計算", "比べる・論理", "文字", "情報"];

export const PIN_COLORS = {
  exec: "#ffffff", number: "#9be35b", string: "#ff6cd9", bool: "#ff5b5b", entity: "#4ec3ff", any: "#c8c8d8",
};

export const PIN_TYPE_LABELS = { exec: "実行", number: "数", string: "文字", bool: "はい／いいえ", entity: "オブジェクト", any: "なんでも" };

/** ノードのピン（変数の種類などで変わるので、ギミックも見る） */
export function pinsOf(node, g) {
  const d = NODE_TYPES[node?.type];
  if (!d) return { inputs: [], outputs: [] };
  return {
    inputs: typeof d.inputs === "function" ? d.inputs(node, g) : d.inputs,
    outputs: typeof d.outputs === "function" ? d.outputs(node, g) : d.outputs,
  };
}

/** つないでよい組み合わせか（実行は実行どうし。オブジェクトはオブジェクトかなんでも。数・文字・はい／いいえは自動で変換） */
export function canConnect(outType, inType) {
  if (outType === "exec" || inType === "exec") return outType === inType;
  if (outType === "any" || inType === "any") return true;
  if (outType === "entity" || inType === "entity") return outType === inType;
  return true;
}

/** ノードの設定の既定値を入れた新しいノード */
export function newNode(type, x, y, values = {}, id) {
  const d = NODE_TYPES[type];
  const v = {};
  for (const f of d?.fields || []) v[f.name] = f.default;
  return { id: id || `n-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, type, x: Math.round(x), y: Math.round(y), values: { ...v, ...values } };
}

/** ギミックのブループリントから、アーティストモードが送れる合図の名前を集める */
export function graphSignals(graph) {
  const names = new Set();
  for (const n of graph?.nodes || []) {
    if (n.type === "event.signal" && String(n.values?.name ?? "").trim()) names.add(String(n.values.name).trim());
  }
  return [...names];
}
