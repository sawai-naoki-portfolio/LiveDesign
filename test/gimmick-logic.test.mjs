// test/gimmick-logic.test.mjs
// クリエイターモードのギミックの計算部分の検査（式・ギミックの検査・ブループリント・エンジンの世界）。`npm test` で実行する。
// 配線（保存・配布・オーバーレイへの添え物）は gimmick-flow.test.mjs が見る。
import { t, section, finish } from "./helpers/harness.mjs";
import {
  sanitizeGimmick, gimmickSummary, gimmickSignals, referencedGimmickIds, GIMMICK_LIMITS,
} from "../lib/studio/gimmick.js";
import { sanitizeScene } from "../lib/studio/scene.js";
import {
  evalNumber, evalBool, evalExpr, tryEval, interpolate, checkExpr,
} from "../public/js/studio/shared/gimmick/expr.js";
import { createWorld, payloadFromEvent, matchCommand } from "../public/js/studio/shared/gimmick/world.js";
import { noteFreq, parseNotes } from "../public/js/studio/shared/gimmick/synth.js";
import { normalizeObject, signalNames, createObject } from "../public/js/studio/shared/gimmick/defaults.js";
import {
  NODE_TYPES, CATEGORIES, pinsOf, canConnect, newNode, graphSignals, nodeKind, nodeTitle, allowedIn,
} from "../public/js/studio/shared/gimmick/nodes.js";
import { coerce } from "../public/js/studio/shared/gimmick/graph.js";
import { GIMMICK_TEMPLATES } from "../public/js/studio/creator/templates.js";
import {
  createFunction, addParam, removeParam, updateParam, setPure, deleteFunction, duplicateFunction, callSites, collapseToFunction, pruneLinks,
} from "../public/js/studio/creator/functions.js";

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const scope = (vars = {}) => ({ get: (n) => vars[n] });

section("式（expr.js）");
{
  t("四則演算と優先順位", evalNumber("1 + 2 * 3 - 4 / 2", {}) === 5);
  t("かっこ", evalNumber("(1 + 2) * 3", {}) === 9);
  t("余り・単項マイナス", evalNumber("-7 % 3", {}) === -1);
  t("0 で割っても 0（止まらない）", evalNumber("5 / 0", {}) === 0 && evalNumber("5 % 0", {}) === 0);
  t("比較と論理", evalBool("3 >= 2 && !(1 > 2) || 0", {}) === true);
  t("and / or / not でも書ける", evalBool("1 and not 0", {}) === true);
  t("三項演算子", evalExpr("score > 5 ? \"多い\" : \"少ない\"", scope({ score: 9 })) === "多い");
  t("変数を読む", evalNumber("score + count * 10", scope({ score: 5, count: 3 })) === 35);
  t("知らない名前は 0", evalNumber("nothing + 1", {}) === 1);
  t("日本語の変数名", evalNumber("スコア * 2", scope({ スコア: 21 })) === 42);
  t("全角の記号でも書ける", evalNumber("３", {}) === 0 && evalNumber("2 ＋ 3 × 4", {}) === 14);
  t("1つの = は比較", evalBool("score = 10", scope({ score: 10 })) === true);
  t("文字の足し算はつなぐ", evalExpr("\"やった\" + 1", {}) === "やった1");
  t("「」でも文字を書ける", evalExpr("「あ」 + 「い」", {}) === "あい");
  t("文字どうしの比較", evalBool("user == \"さくら\"", scope({ user: "さくら" })) === true);
  t("関数（min / max / clamp / round）", evalNumber("min(3, 1, 2) + max(1, 5) + clamp(15, 0, 10) + round(1.26, 1)", {}) === 1 + 5 + 10 + 1.3);
  t("random は scope の乱数を使う", evalNumber("random(10, 20)", { random: () => 0.5 }) === 15);
  t("randint は両端を含む", evalNumber("randint(1, 6)", { random: () => 0.999 }) === 6);
  t("pick は引数のどれか", evalExpr("pick(\"a\", \"b\")", { random: () => 0.7 }) === "b");
  t("has（含むか）", evalBool("has(comment, \"草\")", scope({ comment: "草生える" })) === true);
  t("count はタグの数を世界に聞く", evalNumber("count(\"ball\")", { count: (tag) => (tag === "ball" ? 7 : 0) }) === 7);
  t("self.x を読める", evalNumber("self.x + 1", scope({ self: { x: 41 } })) === 42);
  t("知らない関数はエラー", !!tryEval("alert(1)", {}).error);
  t("読めない式はエラーで値は 0", tryEval("1 +", {}).value === 0 && !!tryEval("1 +", {}).error);
  t("checkExpr は理由を返す", checkExpr("(1 + 2") !== null && checkExpr("1 + 2") === null);
  t("式が深すぎるものは断る", !!tryEval("(".repeat(60) + "1" + ")".repeat(60), {}).error);
}

section("式は JavaScript を動かさない");
{
  t("constructor を辿れない", tryEval("constructor.constructor(\"return 1\")()", {}).value === 0);
  t("__proto__ は読めない", evalExpr("self.__proto__", scope({ self: { x: 1 } })) === 0);
  t("toString などのプロトタイプの値は読めない", evalExpr("self.toString", scope({ self: {} })) === 0);
  t("メソッド呼び出しの形は書けない", !!tryEval("user.slice(0)", scope({ user: "abc" })).error);
  t("配列の添え字は書けない", !!tryEval("a[0]", {}).error);
  t("代入は書けない（== とみなす）", evalBool("score = 1", scope({ score: 2 })) === false);
  t("文字が長くなりすぎない", String(evalExpr("\"" + "x".repeat(300) + "\" + \"" + "y".repeat(300) + "\"", {})).length <= 2000);
}

section("文字への差し込み");
{
  const s = scope({ user: "さくら", count: 3, score: 1.236 });
  t("{式} を計算して差し込む", interpolate("{user} さん +{count * 10}点", s) === "さくら さん +30点");
  t("小数は2桁まで", interpolate("{score}", s) === "1.24");
  t("読めない {…} はそのまま残す", interpolate("{1 +} と {oops", s) === "{1 +} と {oops");
  t("{ } が無ければそのまま", interpolate("ふつうの文", s) === "ふつうの文");
}

section("ギミックの検査（lib/studio/gimmick.js）");
{
  const raw = {
    name: "x".repeat(200), kind: "hack", width: 99999, height: "300", gravity: "abc",
    variables: [
      { name: "score", value: 1 }, { name: "スコア", value: "あ" }, { name: "1bad", value: 0 },
      { name: "a b", value: 0 }, { name: "score", value: 9 }, { name: "__proto__", value: 1 },
    ],
    objects: [{ id: "o1", x: "10", look: { shape: "rect" }, ["__proto__"]: { polluted: true } }, { id: "o1" }, null, 42],
    graph: {
      nodes: [
        { id: "a", type: "event.signal", x: "10", y: 20, values: { name: "drop", ["__proto__"]: { polluted: true } } },
        { id: "b", type: "action.spawn", x: 300, y: 0, values: { prefab: "o1" } },
        { id: "b", type: "action.print" },               // id の重複
        { id: "c", type: "<script>", x: 0 },             // 種類の形が違う
        { id: "d", type: "flow.branch", x: 1e9 },        // 座標が大きすぎる
        null,
      ],
      links: [
        { from: "a", fromPin: "then", to: "b", toPin: "exec" },
        { from: "a", fromPin: "then", to: "b", toPin: "exec" },       // 重複
        { from: "a", fromPin: "then", to: "zzz", toPin: "exec" },     // 無いノード
        { from: "a", fromPin: "bad pin!", to: "b", toPin: "exec" },   // ピンの形が違う
        { from: "b", fromPin: "then", to: "b", toPin: "exec" },       // 自分につなぐ
      ],
      comments: [{ x: 0, y: 0, w: 5, h: 5, text: "メモ" }],
    },
    sounds: [{ name: "s" }],
    effects: Array.from({ length: GIMMICK_LIMITS.effects + 10 }, () => ({ name: "e" })),
  };
  const g = sanitizeGimmick(raw, "gid");
  t("id は保存先のもの", g.id === "gid");
  t("名前は 80 文字まで", g.name.length === 80);
  t("知らない種類は other", g.kind === "other");
  t("ステージの大きさは上限まで・文字の数も数として読む", g.width === GIMMICK_LIMITS.size && g.height === 300);
  t("重力が読めなければ既定値", g.gravity === 1200);
  t("変数の名前は式で読めるものだけ・重複は最初だけ・__proto__ は使えない", g.variables.map((v) => v.name).join(",") === "score,スコア");
  t("式で別の意味を持つ名前は変数にできない", sanitizeGimmick({ variables: [{ name: "W" }, { name: "self" }, { name: "time" }, { name: "ok" }] }, "z").variables.map((v) => v.name).join() === "ok");
  t("重なった変数は最初の値", g.variables[0].value === 1);
  t("オブジェクトの id の重複は振り直す", g.objects.length === 2 && g.objects[0].id === "o1" && g.objects[1].id !== "o1");
  t("数の文字は数にする", g.objects[0].x === 10 && g.graph.nodes[0].x === 10);
  t("__proto__ は残らない", !Object.prototype.hasOwnProperty.call(g.objects[0], "__proto__") && !Object.prototype.hasOwnProperty.call(g.graph.nodes[0].values, "__proto__") && ({}).polluted === undefined);
  t("ノードの種類の形が違うものは捨てる", g.graph.nodes.map((n) => n.type).join() === "event.signal,action.spawn,action.print,flow.branch");
  t("ノードの id の重複は振り直す", new Set(g.graph.nodes.map((n) => n.id)).size === 4 && g.graph.nodes[2].id !== "b");
  t("座標は上限まで", g.graph.nodes[3].x === 100000);
  t("つながりは、両端があって形の合うものだけ・重複なし", g.graph.links.length === 1 && g.graph.links[0].to === "b");
  t("コメントは小さすぎない大きさにする", g.graph.comments[0].w >= 80 && g.graph.comments[0].text === "メモ");
  t("エフェクトの数に上限", g.effects.length === GIMMICK_LIMITS.effects);
  t("合図の名前を集める（サーバー）", gimmickSignals(g).join() === "drop");
  t("合図の名前を集める（ブラウザ）", graphSignals(g.graph).join() === "drop" && signalNames(g).join() === "drop");
  t("一覧の要約", gimmickSummary(g).objects === 2 && gimmickSummary(g).nodes === 4 && gimmickSummary(g).signals[0] === "drop");
  t("壊れた本文でも空のギミックになる", sanitizeGimmick(null, "z").graph.nodes.length === 0 && sanitizeGimmick("x", "z").name === "無題のギミック");
  t("ノードの数に上限", sanitizeGimmick({ graph: { nodes: Array.from({ length: GIMMICK_LIMITS.nodes + 50 }, () => ({ type: "action.print" })) } }, "z").graph.nodes.length === GIMMICK_LIMITS.nodes);
}

section("シーンにギミック枠を置ける");
{
  const scene = sanitizeScene({
    elements: [
      { id: "g1", type: "gimmick", cfg: { gimmickId: "abc-123", vars: [{ name: "goal", value: 5 }] } },
      { id: "grp", type: "group", children: [{ id: "g2", type: "gimmick", cfg: { gimmickId: "def-456" } }] },
    ],
    rules: [{ id: "r", trigger: { type: "gift" }, actions: [{ kind: "gimmick", target: "g1", signal: "drop" }] }],
  }, "s1");
  t("ギミック枠は捨てられない", scene.elements[0].type === "gimmick" && scene.elements[0].cfg.gimmickId === "abc-123");
  t("パラメーターは配列で残る（日本語の名前も）", scene.elements[0].cfg.vars[0].name === "goal");
  t("ルールの「ギミックに合図」は残る", scene.rules[0].actions[0].kind === "gimmick");
  t("置いてあるギミックの ID を集める（グループの中も）", referencedGimmickIds(scene.elements).join() === "abc-123,def-456");
}

section("音（synth.js）");
{
  t("A4 は 440Hz", near(noteFreq("A4"), 440));
  t("C5 は 523.25Hz", near(noteFreq("C5"), 523.2511, 1e-3));
  t("# と b", near(noteFreq("C#4"), noteFreq("Db4")));
  t("休符は null", noteFreq("-") === null && noteFreq("H9") === null);
  t("音符の列（区切りは空白・読点）", parseNotes("C5 E5、G5").length === 3);
}

section("ノードの種類（nodes.js）");
{
  const all = Object.values(NODE_TYPES);
  t("ノードが 60 種類以上ある", all.length >= 60);
  t("どのノードにも名前・仲間・説明がある", all.every((d) => d.title && CATEGORIES.includes(d.category) && d.desc));
  t("イベントは実行ピン then から始まる", all.filter((d) => d.kind === "event").every((d) => pinsOf({ type: d.type, values: {} }, {}).outputs[0]?.name === "then"));
  // 関数・マクロを呼ぶノードのピンは、呼ぶ先の入出力で決まる（下の「関数とマクロ」で見る）
  t("アクションとフローは実行ピンの入口と、実行する手順を持つ", all.filter((d) => (d.kind === "action" || d.kind === "flow") && !d.type.startsWith("call.")).every((d) => typeof d.exec === "function" && pinsOf({ type: d.type, values: {} }, {}).inputs.some((p) => p.type === "exec")));
  t("ピュアと変数を読むノードは実行ピンが無く、計算する手順を持つ", all.filter((d) => d.kind === "pure" || d.kind === "var").every((d) => typeof d.compute === "function" && !pinsOf({ type: d.type, values: {} }, {}).inputs.some((p) => p.type === "exec")));
  t("ノードの中でピンの名前が重ならない", all.every((d) => {
    const { inputs, outputs } = pinsOf({ type: d.type, values: { at: "xy", outs: 8 } }, {});
    return new Set(inputs.map((p) => p.name)).size === inputs.length && new Set(outputs.map((p) => p.name)).size === outputs.length;
  }));
  t("ピンの名前は保存できる形", all.every((d) => {
    const { inputs, outputs } = pinsOf({ type: d.type, values: { at: "xy", outs: 8 } }, {});
    return [...inputs, ...outputs].every((p) => /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(p.name));
  }));
  t("実行は実行どうしだけつなげる", canConnect("exec", "exec") && !canConnect("exec", "number") && !canConnect("number", "exec"));
  t("オブジェクトはオブジェクトかなんでもへ", canConnect("entity", "entity") && canConnect("entity", "any") && !canConnect("entity", "number") && !canConnect("string", "entity"));
  t("数・文字・はい／いいえはつなげる（自動で変換）", canConnect("number", "string") && canConnect("bool", "number") && canConnect("string", "bool"));
  t("変数のピンは変数の種類になる", pinsOf({ type: "var.get", values: { var: "s" } }, { variables: [{ name: "s", value: "" }] }).outputs[0].type === "string"
    && pinsOf({ type: "var.get", values: { var: "n" } }, { variables: [{ name: "n", value: 0 }] }).outputs[0].type === "number");
  t("「順番に」は出口の数を変えられる", pinsOf({ type: "flow.sequence", values: { outs: 5 } }, {}).outputs.length === 5);
  t("「出す」は座標を選んだときだけ X・Y のピン", pinsOf({ type: "action.spawn", values: { at: "xy" } }, {}).inputs.some((p) => p.name === "x") && !pinsOf({ type: "action.spawn", values: { at: "randomTop" } }, {}).inputs.some((p) => p.name === "x"));
  t("新しいノードには設定の既定値が入る", newNode("event.every", 0, 0).values.seconds === 1 && newNode("event.signal", 0, 0, { name: "x" }).values.name === "x");
  t("値の変換", coerce("12", "number") === 12 && coerce("abc", "number") === 0 && coerce(3.14159, "string") === "3.14" && coerce("いいえ", "bool") === false && coerce("0", "bool") === false && coerce({ dead: true }, "entity") === null && coerce("5", "any") === 5);
  t("全角の数字も数として読む（コメントの「４２」）", coerce("４２", "number") === 42 && coerce("４２", "any") === 42 && coerce("４２です", "any") === "４２です");
  t("式の isnum()：数として読めるか", evalNumber("isnum(\"42\") + isnum(\"４２\") + isnum(\" 7 \") + isnum(3)") === 4 && evalNumber("isnum(\"42です\") + isnum(\"\") + isnum(\"abc\")") === 0 && evalNumber("num(\"１２\") + 1") === 13);
}

// ===============================
// ブループリントを動かす（world.js + graph.js）
// ===============================
const ball = { id: "ball", name: "ボール", tag: "ball", prefab: true, w: 20, h: 20, body: { type: "dynamic", edges: "bounce", bounce: 0.5 } };
const floor = { id: "floor", name: "床", tag: "floor", x: 0, y: 280, w: 400, h: 20, body: { type: "static" } };

/** テスト用にノードを組む小道具 */
function bp(prefix = "n") {
  const nodes = [];
  const links = [];
  return {
    nodes, links,
    graph() { return { nodes, links }; },
    n(type, values = {}) { const node = newNode(type, 0, 0, values, `${prefix}${nodes.length}`); nodes.push(node); return node; },
    go(...chain) {
      for (let i = 0; i < chain.length - 1; i++) {
        const [a, pin] = Array.isArray(chain[i]) ? chain[i] : [chain[i], "then"];
        links.push({ from: a.id, fromPin: pin, to: (Array.isArray(chain[i + 1]) ? chain[i + 1][0] : chain[i + 1]).id, toPin: "exec" });
      }
    },
    wire(a, aPin, b, bPin) { links.push({ from: a.id, fromPin: aPin, to: b.id, toPin: bPin }); },
  };
}

function makeWorld(b, extra = {}, opts = {}) {
  const logs = [];
  const sounds = [];
  const traced = [];
  let seed = 0.25;
  const world = createWorld({
    width: 400, height: 300, gravity: 1000,
    variables: [{ name: "score", value: 0 }, { name: "goal", value: 3, exposed: true }, { name: "secret", value: 7 }, { name: "who", value: "" }],
    objects: [ball, floor, { id: "label", look: { shape: "text", text: "score {score}" } }],
    sounds: [{ id: "snd", name: "コイン" }],
    effects: [{ id: "fx", name: "爆発", count: 10 }],
    graph: { nodes: b.nodes, links: b.links },
    ...extra,
  }, {
    random: () => { seed = (seed * 9301 + 0.49297) % 1; return seed; },
    onLog: (text, level) => logs.push({ text, level }),
    onSound: (s, v) => sounds.push([s.id, v]),
    onTrace: (id, gid) => traced.push(gid ? `${gid}/${id}` : id),
    ...opts,
  });
  return { world, logs, sounds, traced };
}
const run = (world, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) world.step(1 / 60); };
const balls = (world) => world.entities.filter((e) => e.tag === "ball").length;
const texts = (logs) => logs.filter((l) => l.level === "info").map((l) => l.text);

section("ブループリント：イベント → アクション、データのピン");
{
  const b = bp();
  const st = b.n("event.start");
  const pr = b.n("action.print", { text: "start" });
  b.go(st, pr);
  const sig = b.n("event.signal", { name: "Drop" });
  const sp = b.n("action.spawn", { prefab: "ball", at: "xy", x: 100, y: 50 });
  const snd = b.n("action.playSound", { sound: "snd" });
  b.go(sig, sp, snd);
  b.wire(sig, "count", sp, "count");
  const vol = b.n("math.div", { a: 1, b: 2 });
  b.wire(vol, "result", snd, "volume");
  const { world, logs, sounds, traced } = makeWorld(b);
  world.start();
  t("「ゲームが始まったとき」から実行の線をたどる", texts(logs).includes("start"));
  t("プレハブは始めには出ない", balls(world) === 0);
  t("合図の名前は大文字小文字を区別しない", world.signal("drop", { count: 3 }) === 1);
  t("イベントの出力ピン（個数）を入力ピンにつなげる", balls(world) === 3);
  t("座標のピン（真ん中）", world.entities.filter((e) => e.tag === "ball").every((e) => e.x + e.w / 2 === 100));
  t("計算ノードの答えを音量に", sounds.length === 1 && sounds[0][1] === 0.5);
  t("動いたノードを知らせる（エディタで光らせる）", traced.includes(sig.id) && traced.includes(sp.id) && !traced.includes(vol.id));
  t("知らない合図は何もしない", world.signal("nope") === 0);
  t("止めている間は合図を受けない", (() => { world.stop(); const n = world.signal("drop"); world.running = true; return n === 0; })());
  run(world, 3);
  t("重力で落ちて床の上に積もる", world.entities.filter((e) => e.tag === "ball").every((e) => e.y + e.h <= 281 && e.y > 200));
  t("文字の差し込みは描くときに計算する", world.textOf(world.entities.find((e) => e.srcId === "label")) === "score 0");
}

section("ブループリント：分岐・順番に・くり返す・待つ");
{
  const b = bp();
  const sig = b.n("event.signal", { name: "go" });
  const seq = b.n("flow.sequence", { outs: 3 });
  b.go(sig, seq);
  const p1 = b.n("action.print", { text: "first" });
  const br = b.n("flow.branch");
  const gt = b.n("cmp.gt", { b: 2 });
  b.wire(sig, "count", gt, "a");
  b.wire(gt, "result", br, "cond");
  const yes = b.n("action.print", { text: "many" });
  const no = b.n("action.print", { text: "few" });
  b.go([seq, "then0"], p1);
  b.go([seq, "then1"], br);
  b.go([br, "true"], yes);
  b.go([br, "false"], no);
  const loop = b.n("flow.forLoop", { first: 1, last: 4 });
  const add = b.n("var.add", { var: "score" });
  b.wire(loop, "index", add, "amount");
  const done = b.n("action.print", { text: "loop {score}" });
  b.go([seq, "then2"], loop);
  b.go([loop, "body"], add);
  b.go([loop, "completed"], done);
  const sigW = b.n("event.signal", { name: "wait" });
  const dl = b.n("flow.delay", { seconds: 1 });
  const after = b.n("action.print", { text: "after" });
  b.go(sigW, dl);
  b.go([dl, "completed"], after);
  const { world, logs } = makeWorld(b);
  world.start();
  world.signal("go", { count: 5 });
  t("「順番に」は 1 → 2 → 3 の順に全部", texts(logs).join("|") === "first|many|loop 10");
  world.signal("go", { count: 1 });
  t("「分岐」は条件で出口を選ぶ", texts(logs).includes("few"));
  t("「くり返す」の今の数を使える（1+2+3+4 を2回）", world.vars.score === 20);
  world.signal("wait");
  run(world, 0.5);
  t("「待つ」の途中ではまだ", !texts(logs).includes("after") && world.pendingCount === 1);
  run(world, 0.6);
  t("「待つ」のあとに続きを実行する", texts(logs).includes("after") && world.pendingCount === 0);
}

section("ブループリント：一度だけ・交互に・確率・クールダウン");
{
  const b = bp();
  const once = b.n("flow.doOnce");
  const ff = b.n("flow.flipFlop");
  const cd = b.n("flow.cooldown", { seconds: 2 });
  const p1 = b.n("action.print", { text: "once" });
  const pa = b.n("action.print", { text: "A" });
  const pb = b.n("action.print", { text: "B" });
  const pc = b.n("action.print", { text: "cd" });
  const s1 = b.n("event.signal", { name: "once" });
  const s2 = b.n("event.signal", { name: "reset" });
  const s3 = b.n("event.signal", { name: "ff" });
  const s4 = b.n("event.signal", { name: "cd" });
  b.go(s1, once, p1);
  b.links.push({ from: s2.id, fromPin: "then", to: once.id, toPin: "reset" });
  b.go(s3, ff);
  b.go([ff, "a"], pa);
  b.go([ff, "b"], pb);
  b.go(s4, cd, pc);
  const { world, logs } = makeWorld(b);
  world.start();
  world.signal("once"); world.signal("once");
  t("「一度だけ」は最初の1回だけ", texts(logs).filter((x) => x === "once").length === 1);
  world.signal("reset"); world.signal("once");
  t("「もう一度」に流すと、また通る", texts(logs).filter((x) => x === "once").length === 2);
  world.signal("ff"); world.signal("ff"); world.signal("ff");
  t("「交互に」は A → B → A", texts(logs).filter((x) => x === "A" || x === "B").join("") === "ABA");
  world.signal("cd"); world.signal("cd");
  run(world, 2.1);
  world.signal("cd");
  t("「クールダウン」の間は通らない", texts(logs).filter((x) => x === "cd").length === 2);
}

section("ブループリント：ぶつかったとき・条件が成り立ったとき");
{
  const b = bp();
  const sig = b.n("event.signal", { name: "drop" });
  const sp = b.n("action.spawn", { prefab: "ball", at: "xy", y: 50 });
  const px = b.n("math.mul", { b: 100 });
  b.wire(sig, "count", px, "a");
  b.wire(px, "result", sp, "x");
  b.go(sig, sp);
  const co = b.n("event.collide", { a: "ball", b: "floor" });
  const add = b.n("var.add", { var: "score", amount: 1 });
  const fx = b.n("action.playEffectOn", { effect: "fx" });
  b.go(co, add, fx);
  const wh = b.n("event.when");
  const vs = b.n("var.get", { var: "score" });
  const vg = b.n("var.get", { var: "goal" });
  const ge = b.n("cmp.gte");
  b.wire(vs, "value", ge, "a");
  b.wire(vg, "value", ge, "b");
  b.wire(ge, "result", wh, "cond");
  const goal = b.n("action.print", { text: "goal {score}" });
  b.go(wh, goal);
  const { world, logs } = makeWorld(b);
  world.start();
  world.signal("drop", { count: 1 });
  let sawParticles = false;
  for (let k = 0; k < 90; k++) { world.step(1 / 60); sawParticles ||= world.particles.length > 0; }
  t("ぶつかった自分の所にエフェクト（対象が空ならこのイベントのオブジェクト）", sawParticles);
  for (let i = 2; i <= 3; i++) { world.signal("drop", { count: i }); run(world, 1.5); }
  t("触れるたびに数える（跳ねてまた触れたらまた数える）", world.vars.score >= 3);
  run(world, 2);
  const now = world.vars.score;
  run(world, 1);
  t("触れたままなら増え続けない", world.vars.score === now);
  t("条件が成り立った瞬間に1回だけ", texts(logs).filter((x) => x.startsWith("goal")).length === 1);
}

section("ブループリント：配信のイベント");
{
  const b = bp();
  const gf = b.n("event.gift", { giftName: "ローズ, ドーナツ", minCoins: 10 });
  const fmt = b.n("text.format", { template: "gift {a} {b} {c}" });
  const pg = b.n("action.print");
  b.wire(gf, "user", fmt, "a"); b.wire(gf, "gift", fmt, "b"); b.wire(gf, "coins", fmt, "c");
  b.wire(fmt, "result", pg, "text");
  b.go(gf, pg);
  const ch = b.n("event.chat", { match: "command", keyword: "!jump" });
  const pc = b.n("action.print");
  b.wire(ch, "args", pc, "text");
  b.go(ch, pc);
  const k = b.n("event.chat", { match: "contains", keyword: "草" });
  b.go(k, b.n("action.print", { text: "kusa" }));
  const lk = b.n("event.like", { every: 10 });
  const pl = b.n("action.print");
  const lf = b.n("text.format", { template: "like x{a}" });
  b.wire(lk, "count", lf, "a"); b.wire(lf, "result", pl, "text");
  b.go(lk, pl);
  const fo = b.n("event.follow");
  const pf = b.n("action.print", { text: "follow {user}" });
  b.go(fo, pf);
  const { world, logs } = makeWorld(b);
  world.start();
  const ev = (type, x = {}) => ({ type, user: { name: "さくら", avatar: "" }, ...x });
  world.liveEvent(ev("gift", { gift: { name: "ローズ" }, coins: 5, count: 5 }));
  world.liveEvent(ev("gift", { gift: { name: "ドーナツ" }, coins: 30, count: 1 }));
  world.liveEvent(ev("gift", { gift: { name: "ライオン" }, coins: 30000, count: 1 }));
  t("ギフトの名前と最低コインで絞る・出力ピンで人とギフトを渡す", texts(logs).filter((x) => x.startsWith("gift")).join("|") === "gift さくら ドーナツ 30");
  world.liveEvent(ev("chat", { text: "!jump 3" }));
  world.liveEvent(ev("chat", { text: "!jumper" }));
  t("コマンドは区切りまで（!jumper には当たらない）・後ろの文字", texts(logs).includes("3") && !texts(logs).includes(""));
  world.liveEvent(ev("chat", { text: "草生える" }));
  t("含む", texts(logs).includes("kusa"));
  world.liveEvent(ev("like", { likes: 25 }));
  world.liveEvent(ev("like", { likes: 5 }));
  t("いいねは塊で届いても跨いだ回数ぶん", texts(logs).filter((x) => x.startsWith("like")).join("|") === "like x2|like x1");
  world.liveEvent(ev("follow"));
  t("文字の {user} はイベントの人", texts(logs).includes("follow さくら"));
  const before = logs.length;
  world.liveEvent(ev("share"));
  t("つないでいないイベントは何もしない", logs.length === before);
  t("payloadFromEvent", payloadFromEvent({ type: "gift", user: { name: "a", avatar: "https://x/a.png" }, gift: { name: "g", picture: "p" }, count: 2, coins: 10 }).coins === 10);
  t("matchCommand は rules.js と同じ決まり", matchCommand("!go now", "!go") === "now" && matchCommand("!gone", "!go") === null);
  t("コマンドは全角の「！」・全角スペースでも", matchCommand("！ジャンプ　３", "!ジャンプ") === "3" && matchCommand("ｼﾞｬﾝﾌﾟ", "ジャンプ") === "");
}

section("ブループリント：守り（止まらない・増えすぎない）");
{
  const b = bp();
  const lp = b.n("event.signal", { name: "loop" });
  b.go(lp, b.n("action.emit", { name: "loop" }));
  const many = b.n("event.signal", { name: "many" });
  b.go(many, b.n("action.spawn", { prefab: "ball", at: "random", count: 1000 }));
  // 実行の線をぐるぐる回す（自分に戻る）
  const spin = b.n("event.signal", { name: "spin" });
  const a1 = b.n("var.add", { var: "score", amount: 1 });
  b.go(spin, a1);
  b.links.push({ from: a1.id, fromPin: "then", to: a1.id, toPin: "exec" });
  // 計算ノードをぐるぐるつなぐ
  const deep = b.n("event.signal", { name: "deep" });
  const m1 = b.n("math.add");
  const m2 = b.n("math.add");
  b.wire(m1, "result", m2, "a");
  b.wire(m2, "result", m1, "a");
  const pd = b.n("action.print");
  b.wire(m1, "result", pd, "text");
  b.go(deep, pd);
  const bad = b.n("event.signal", { name: "bad" });
  const ex = b.n("expr", { expr: "1 +" });
  const pb2 = b.n("action.print");
  b.wire(ex, "result", pb2, "text");
  b.go(bad, pb2, b.n("action.print", { text: "still running" }));
  const nos = b.n("event.signal", { name: "nosound" });
  b.go(nos, b.n("action.playSound", { sound: "" }), b.n("action.print", { text: "after missing sound" }));
  const { world, logs } = makeWorld(b);
  world.start();
  world.signal("loop");
  t("合図の繰り返しは打ち切る", logs.some((l) => l.level === "warn" && l.text.includes("繰り返し")));
  world.signal("many");
  t("1つのノードで出せる数に上限", balls(world) === 60);
  for (let i = 0; i < 10; i++) world.signal("many");
  t("全体の数にも上限", world.entities.length <= 400);
  world.signal("spin");
  t("実行の線がぐるぐる回っても止まる", logs.some((l) => l.level === "warn" && l.text.includes("ぐるぐる")) && world.vars.score > 100);
  world.signal("deep");
  t("計算のつながりがぐるぐるでも止まる", logs.some((l) => l.text.includes("深すぎ")));
  world.signal("bad");
  t("読めない式は 0 にして続ける", texts(logs).includes("still running") && logs.some((l) => l.text.includes("式が読めません")));
  world.signal("nosound");
  t("選ばれていないサウンドは飛ばして続ける", texts(logs).includes("after missing sound"));
  t("知らない種類のノードは無視する", (() => { const w2 = createWorld({ graph: { nodes: [{ id: "x", type: "event.nope" }], links: [] } }); w2.start(); w2.step(0.1); return true; })());
}

section("ブループリント：パラメーター・やり直し・見た目を変える");
{
  const b = bp();
  const sig = b.n("event.signal", { name: "set" });
  const sp = b.n("action.spawn", { prefab: "ball", at: "center" });
  const sz = b.n("action.setSize", { w: 100 });
  const tx = b.n("action.setText", { text: "{user}" });
  const fl = b.n("get.findTag", { tag: "floor" });
  const hide = b.n("action.setVisible", { visible: false });
  const set = b.n("var.set", { var: "who" });
  b.go(sig, sp, sz, tx, hide, set);
  b.wire(sp, "spawned", sz, "target");
  b.wire(sp, "spawned", tx, "target");
  b.wire(fl, "found", hide, "target");
  b.wire(sig, "user", set, "value");
  const sn = b.n("event.signal", { name: "num" });
  const setNum = b.n("var.set", { var: "score", value: "12abc" });
  b.go(sn, setNum);
  const rs = b.n("event.signal", { name: "restart" });
  b.go(rs, b.n("action.restart"));
  const { world } = makeWorld(b, {}, { overrides: [{ name: "goal", value: "99" }, { name: "secret", value: 1 }] });
  world.start();
  t("公開した変数だけ上書きできる（種類は元に合わせる）", world.vars.goal === 99 && world.vars.secret === 7);
  world.signal("set", { user: "さくら" });
  const e = world.entities.find((x) => x.tag === "ball");
  t("幅は左上をそのままに変える（空の高さは元のまま）", e.w === 100 && e.h === 20 && near(e.x, 190));
  t("文字の差し込みは出したときの人", world.textOf(e) === "さくら");
  t("「タグで探す」の答えを対象に（隠す）", world.entities.find((x) => x.tag === "floor").hidden === true);
  t("文字の変数に文字を入れる", world.vars.who === "さくら");
  world.signal("num");
  t("数の変数には数だけが入る", world.vars.score === 0);
  world.signal("restart");
  world.step(1 / 60);
  t("やり直すと始めの状態", balls(world) === 0 && world.vars.who === "" && world.entities.find((x) => x.tag === "floor").hidden === false);
}

section("ブループリント：オブジェクトが出てきたとき・画面の端・クリック");
{
  const b = bp();
  const sig = b.n("event.signal", { name: "go" });
  b.go(sig, b.n("action.spawn", { prefab: "ball", at: "xy", x: 50, y: 50, count: 2 }));
  const born = b.n("event.spawned", { object: "ball" });
  const vel = b.n("action.setVelocity", { vx: 0, vy: 0 });
  const mul = b.n("math.mul", { b: 100 });
  b.wire(born, "index", mul, "a");
  b.wire(mul, "result", vel, "vx");
  b.go(born, vel);
  const edge = b.n("event.edge", { tag: "ball", side: "bottom" });
  b.go(edge, b.n("var.add", { var: "score", amount: 1 }));
  const click = b.n("event.click", { tag: "floor" });
  b.go(click, b.n("action.print", { text: "clicked {x}" }));
  // 床は物理なし（ボールが画面の下の端まで落ちるように）
  const { world, logs } = makeWorld(b, { objects: [{ ...ball, body: { ...ball.body, bounce: 0 } }, { ...floor, body: { type: "none" } }] });
  world.start();
  world.signal("go");
  const bs = world.entities.filter((x) => x.tag === "ball");
  t("出てきた1個ずつに動く（何個目かで速さを変える）", bs.length === 2 && bs[0].vx === 0 && bs[1].vx === 100);
  run(world, 3);
  t("下の端に着いたら1回ずつ（止まっている間は数えない）", world.vars.score === 2);
  world.click(200, 290);
  world.click(200, 10);
  t("クリックはタグで絞る・座標を受け取れる", texts(logs).join("|") === "clicked 200");
  t("「今すぐ動かす」（エディタ）", world.fireNode(click.id) === true && world.fireNode("nope") === false);
}

section("関数とマクロ：ピンと置ける場所");
{
  const g = {
    functions: [
      { id: "f1", name: "2倍", kind: "function", inputs: [{ id: "p1", name: "数", type: "number" }], outputs: [{ id: "p2", name: "答え", type: "number" }] },
      { id: "f2", name: "2乗", kind: "function", pure: true, inputs: [{ id: "p1", name: "数", type: "number" }], outputs: [{ id: "p2", name: "答え", type: "number" }] },
      { id: "m1", name: "2回", kind: "macro", inputs: [{ id: "p1", name: "実行", type: "exec" }, { id: "p2", name: "対象", type: "entity" }], outputs: [{ id: "p3", name: "済", type: "exec" }] },
      { id: "m2", name: "足す100", kind: "macro", inputs: [{ id: "p1", name: "数", type: "number" }], outputs: [{ id: "p2", name: "答え", type: "number" }] },
    ],
  };
  const call = (type, fn) => ({ type, values: { fn } });
  const names = (list) => list.map((p) => `${p.name}:${p.type}`).join(",");
  t("関数を呼ぶノード：実行ピン＋入出力", names(pinsOf(call("call.function", "f1"), g).inputs) === "exec:exec,p1:number" && names(pinsOf(call("call.function", "f1"), g).outputs) === "then:exec,p2:number");
  t("ピュア関数は実行ピンが無い（計算ノードと同じ緑）", !pinsOf(call("call.function", "f2"), g).inputs.some((p) => p.type === "exec") && nodeKind(call("call.function", "f2"), g) === "pure" && nodeKind(call("call.function", "f1"), g) === "action");
  t("見出しは関数の名前", nodeTitle(call("call.function", "f1"), g) === "2倍" && nodeTitle(call("call.function", "zz"), g).includes("見つからない"));
  t("マクロは実行ピンをいくつでも持てる", names(pinsOf(call("call.macro", "m1"), g).inputs) === "p1:exec,p2:entity" && pinsOf(call("call.macro", "m1"), g).inputs[1].self === true);
  t("実行ピンの無いマクロは計算ノード", nodeKind(call("call.macro", "m2"), g) === "pure" && nodeKind(call("call.macro", "m1"), g) === "flow");
  t("入口は入力を出し、出口は出力を受ける", names(pinsOf({ type: "fn.entry", values: { fn: "f1" } }, g).outputs) === "then:exec,p1:number" && names(pinsOf({ type: "fn.return", values: { fn: "f1" } }, g).inputs) === "exec:exec,p2:number");
  t("マクロの入口・出口は実行ピンも含む", names(pinsOf({ type: "macro.in", values: { fn: "m1" } }, g).outputs) === "p1:exec,p2:entity" && names(pinsOf({ type: "macro.out", values: { fn: "m1" } }, g).inputs) === "p3:exec");
  t("置ける場所：イベントはイベントグラフだけ・出口は関数（マクロ）の中だけ", allowedIn("event.gift", null) && !allowedIn("event.gift", "function") && allowedIn("fn.return", "function") && !allowedIn("fn.return", "macro") && !allowedIn("fn.return", null) && allowedIn("macro.out", "macro") && allowedIn("action.print", "macro"));
}

section("関数とマクロ：動かす");
{
  // 関数「2倍」：入口 → 出口（答え = 数 × 2）。中でスコアも足す（副作用のある関数）
  const fb = bp("f");
  const fe = fb.n("fn.entry");
  const fadd = fb.n("var.add", { var: "score", amount: 1 });
  const fr = fb.n("fn.return");
  const fmul = fb.n("math.mul", { b: 2 });
  fb.go(fe, fadd, fr);
  fb.wire(fe, "p1", fmul, "a");
  fb.wire(fmul, "result", fr, "p2");
  // ピュア関数「2乗」：入口の実行ピンをつながず、出口の値だけ
  const pb = bp("q");
  const pe = pb.n("fn.entry");
  const pr = pb.n("fn.return");
  const pm = pb.n("math.mul");
  pb.wire(pe, "p1", pm, "a");
  pb.wire(pe, "p1", pm, "b");
  pb.wire(pm, "result", pr, "p2");
  // 関数「符号」：分岐して出口が2つ。出口のあとは動かない
  const sb = bp("s");
  const se = sb.n("fn.entry");
  const sbr = sb.n("flow.branch");
  const sgt = sb.n("cmp.gt", { b: 0 });
  sb.wire(se, "p1", sgt, "a");
  sb.wire(sgt, "result", sbr, "cond");
  const sPlus = sb.n("fn.return", { p2: "plus" });
  const sMinus = sb.n("fn.return", { p2: "minus" });
  sb.go(se, sbr);
  sb.go([sbr, "true"], sPlus);
  sb.go([sbr, "false"], sMinus);
  const sSeq = sb.n("flow.sequence", { outs: 2 });
  // 関数の中の「待つ」は使えない
  const wb = bp("w");
  const we = wb.n("fn.entry");
  const wd = wb.n("flow.delay", { seconds: 0.1 });
  const wp = wb.n("action.print", { text: "never" });
  wb.go(we, wd);
  wb.go([wd, "completed"], wp);
  // 自分を呼び続ける関数
  const rb = bp("r");
  const re = rb.n("fn.entry");
  const rc = rb.n("call.function", { fn: "rec" });
  const rr = rb.n("fn.return");
  rb.go(re, rc, rr);
  // 関数の中のイベントは動かない
  rb.n("event.signal", { name: "inner" });
  void sSeq;

  // マクロ「2回足す」：入口の実行 → 足す → 足す → 出口（済）。出力「スコア」
  const mb = bp("m");
  const mi = mb.n("macro.in");
  const ma1 = mb.n("var.add", { var: "score" });
  const ma2 = mb.n("var.add", { var: "score" });
  const mo = mb.n("macro.out");
  const mg = mb.n("var.get", { var: "score" });
  mb.go([mi, "p1"], ma1, ma2, mo);
  mb.links.push({ from: ma2.id, fromPin: "then", to: mo.id, toPin: "p3" });
  mb.links.splice(mb.links.findIndex((l) => l.to === mo.id && l.toPin === "exec"), 1);
  mb.wire(mi, "p2", ma1, "amount");
  mb.wire(mi, "p2", ma2, "amount");
  mb.wire(mg, "value", mo, "p4");
  // マクロ「あとで」：待ってから出口
  const db = bp("d");
  const di = db.n("macro.in");
  const dd = db.n("flow.delay", { seconds: 1 });
  const dout = db.n("macro.out");
  db.links.push({ from: di.id, fromPin: "p1", to: dd.id, toPin: "exec" });
  db.links.push({ from: dd.id, fromPin: "completed", to: dout.id, toPin: "p2" });
  // マクロ「最初だけ」：一度だけ（呼んだ場所ごとに別々）
  const ob = bp("o");
  const oi = ob.n("macro.in");
  const oo = ob.n("flow.doOnce");
  const oout = ob.n("macro.out");
  ob.links.push({ from: oi.id, fromPin: "p1", to: oo.id, toPin: "exec" });
  ob.links.push({ from: oo.id, fromPin: "then", to: oout.id, toPin: "p2" });
  // マクロ「大小」：出口の実行ピンが2つ
  const bb = bp("b");
  const bi = bb.n("macro.in");
  const bbr = bb.n("flow.branch");
  const bgt = bb.n("cmp.gt", { b: 10 });
  const bout = bb.n("macro.out");
  bb.wire(bi, "p2", bgt, "a");
  bb.wire(bgt, "result", bbr, "cond");
  bb.links.push({ from: bi.id, fromPin: "p1", to: bbr.id, toPin: "exec" });
  bb.links.push({ from: bbr.id, fromPin: "true", to: bout.id, toPin: "p3" });
  bb.links.push({ from: bbr.id, fromPin: "false", to: bout.id, toPin: "p4" });
  // 実行ピンの無いマクロ「足す100」
  const xb = bp("x");
  const xi = xb.n("macro.in");
  const xo = xb.n("macro.out");
  const xa = xb.n("math.add", { b: 100 });
  xb.wire(xi, "p1", xa, "a");
  xb.wire(xa, "result", xo, "p2");

  const N = (type, name) => ({ id: "p" + name, name, type });
  const functions = [
    { id: "dbl", name: "2倍", kind: "function", inputs: [N("number", "1")], outputs: [N("number", "2")], graph: fb.graph() },
    { id: "sq", name: "2乗", kind: "function", pure: true, inputs: [N("number", "1")], outputs: [N("number", "2")], graph: pb.graph() },
    { id: "sign", name: "符号", kind: "function", inputs: [N("number", "1")], outputs: [N("string", "2")], graph: sb.graph() },
    { id: "wait", name: "待つ関数", kind: "function", inputs: [], outputs: [], graph: wb.graph() },
    { id: "rec", name: "自分を呼ぶ", kind: "function", inputs: [], outputs: [], graph: rb.graph() },
    { id: "twice", name: "2回足す", kind: "macro", inputs: [N("exec", "1"), N("number", "2")], outputs: [N("exec", "3"), N("number", "4")], graph: mb.graph() },
    { id: "later", name: "あとで", kind: "macro", inputs: [N("exec", "1")], outputs: [N("exec", "2")], graph: db.graph() },
    { id: "once", name: "最初だけ", kind: "macro", inputs: [N("exec", "1")], outputs: [N("exec", "2")], graph: ob.graph() },
    { id: "big", name: "大小", kind: "macro", inputs: [N("exec", "1"), N("number", "2")], outputs: [N("exec", "3"), N("exec", "4")], graph: bb.graph() },
    { id: "plus", name: "足す100", kind: "macro", inputs: [N("number", "1")], outputs: [N("number", "2")], graph: xb.graph() },
  ];

  const b = bp();
  // 2倍：21 → 42、関数の中のスコア +1
  const s1 = b.n("event.signal", { name: "dbl" });
  const c1 = b.n("call.function", { fn: "dbl", p1: 21 });
  const p1 = b.n("action.print");
  b.go(s1, c1, p1);
  b.wire(c1, "p2", p1, "text");
  // 2乗：合図の個数を2乗（ピュア関数を2つつなぐ）
  const s2 = b.n("event.signal", { name: "sq" });
  const c2 = b.n("call.function", { fn: "sq" });
  const c2b = b.n("call.function", { fn: "sq" });
  const p2 = b.n("action.print");
  b.wire(s2, "count", c2, "p1");
  b.wire(c2, "p2", c2b, "p1");
  b.wire(c2b, "p2", p2, "text");
  b.go(s2, p2);
  // 符号
  const s3 = b.n("event.signal", { name: "sign" });
  const c3 = b.n("call.function", { fn: "sign" });
  const p3 = b.n("action.print");
  b.wire(s3, "count", c3, "p1");
  b.wire(c3, "p2", p3, "text");
  b.go(s3, c3, p3);
  // 待つ関数・自分を呼ぶ関数・無い関数：続きは動く
  const s4 = b.n("event.signal", { name: "bad" });
  b.go(s4, b.n("call.function", { fn: "wait" }), b.n("call.function", { fn: "rec" }), b.n("call.function", { fn: "gone" }), b.n("action.print", { text: "after bad" }));
  // 2回足す：5 を2回で +10、出口のあとに続き・出力のスコアを読む
  const s5 = b.n("event.signal", { name: "twice" });
  const c5 = b.n("call.macro", { fn: "twice", p2: 5 });
  const p5 = b.n("action.print");
  b.links.push({ from: s5.id, fromPin: "then", to: c5.id, toPin: "p1" });
  b.links.push({ from: c5.id, fromPin: "p3", to: p5.id, toPin: "exec" });
  b.wire(c5, "p4", p5, "text");
  // あとで
  const s6 = b.n("event.signal", { name: "later" });
  const c6 = b.n("call.macro", { fn: "later" });
  b.links.push({ from: s6.id, fromPin: "then", to: c6.id, toPin: "p1" });
  const p6 = b.n("action.print", { text: "later {user}" });
  b.links.push({ from: c6.id, fromPin: "p2", to: p6.id, toPin: "exec" });
  // 最初だけ（呼ぶ場所が2つ）
  const s7 = b.n("event.signal", { name: "once" });
  const seq = b.n("flow.sequence", { outs: 2 });
  b.go(s7, seq);
  const c7a = b.n("call.macro", { fn: "once" });
  const c7b = b.n("call.macro", { fn: "once" });
  b.links.push({ from: seq.id, fromPin: "then0", to: c7a.id, toPin: "p1" });
  b.links.push({ from: seq.id, fromPin: "then1", to: c7b.id, toPin: "p1" });
  b.links.push({ from: c7a.id, fromPin: "p2", to: b.n("action.print", { text: "once A" }).id, toPin: "exec" });
  b.links.push({ from: c7b.id, fromPin: "p2", to: b.n("action.print", { text: "once B" }).id, toPin: "exec" });
  // 大小
  const s8 = b.n("event.signal", { name: "big" });
  const c8 = b.n("call.macro", { fn: "big" });
  b.links.push({ from: s8.id, fromPin: "then", to: c8.id, toPin: "p1" });
  b.wire(s8, "count", c8, "p2");
  b.links.push({ from: c8.id, fromPin: "p3", to: b.n("action.print", { text: "big" }).id, toPin: "exec" });
  b.links.push({ from: c8.id, fromPin: "p4", to: b.n("action.print", { text: "small" }).id, toPin: "exec" });
  // 足す100（実行ピンなし）
  const s9 = b.n("event.signal", { name: "plus" });
  const c9 = b.n("call.macro", { fn: "plus", p1: 1 });
  const p9 = b.n("action.print");
  b.wire(c9, "p2", p9, "text");
  b.go(s9, p9);
  // 入力ピンの種類を変えた（オブジェクト → 数）ら、合わなくなった線は使わず、書いた値を使う
  const s10 = b.n("event.signal", { name: "stale" });
  const c10 = b.n("call.function", { fn: "dbl", p1: 4 });
  const p10 = b.n("action.print");
  b.wire(b.n("get.findTag", { tag: "floor" }), "found", c10, "p1");
  b.wire(c10, "p2", p10, "text");
  b.go(s10, c10, p10);

  const { world, logs, traced } = makeWorld(b, { functions });
  world.start();
  world.signal("dbl");
  t("関数：入力を渡して、出口の値を受け取る", texts(logs).at(-1) === "42");
  t("関数の中のアクションも動く（スコア +1）", world.vars.score === 1);
  t("関数の中で動いたノードも、どのグラフかと一緒に知らせる", traced.includes(`dbl/${fadd.id}`));
  world.signal("sq", { count: 3 });
  t("ピュア関数：読まれるたびに計算（3 の2乗の2乗）", texts(logs).at(-1) === "81");
  world.signal("sign", { count: 5 });
  world.signal("sign", { count: -2 });
  t("出口は分岐ごとに置ける", texts(logs).slice(-2).join() === "plus,minus");
  world.signal("bad");
  t("関数の中の「待つ」は使えない（理由を出して続ける）", logs.some((l) => l.level === "warn" && l.text.includes("関数の中では「待つ」")) && texts(logs).includes("after bad"));
  t("自分を呼び続ける関数は深さで止める", logs.some((l) => l.level === "warn" && l.text.includes("呼ぶ深さ")));
  t("消された関数を呼んでも止まらない", logs.some((l) => l.text.includes("呼ぶ関数が見つかりません")));
  run(world, 0.3);
  t("関数の中で待っていた続きは動かない", !texts(logs).includes("never") && world.pendingCount === 0);
  t("関数・マクロの中のイベントは動かない", world.signal("inner") === 0);
  const before = world.vars.score;
  world.signal("twice");
  t("マクロ：中身を広げたのと同じ（5 を2回足す）", world.vars.score === before + 10);
  t("マクロ：出口の実行ピンから続き、出力の値を読める", texts(logs).at(-1) === String(before + 10));
  world.signal("later", { user: "さくら" });
  run(world, 0.5);
  t("マクロの中では「待つ」が使える（まだ）", !texts(logs).some((x) => x.startsWith("later")));
  run(world, 0.6);
  t("待ったあと、呼んだ所の続きを動かす（イベントの人も読める）", texts(logs).includes("later さくら"));
  world.signal("once");
  world.signal("once");
  t("マクロの「一度だけ」は呼んだ場所ごとに別々", texts(logs).filter((x) => x.startsWith("once")).join() === "once A,once B");
  world.signal("big", { count: 50 });
  world.signal("big", { count: 1 });
  t("マクロは出口の実行ピンを複数持てる", texts(logs).slice(-2).join() === "big,small");
  world.signal("plus");
  t("実行ピンの無いマクロは計算ノードとして読める", texts(logs).at(-1) === "101");
  world.signal("stale");
  t("入力の種類が合わなくなった線は使わない（書いた値を使う）", texts(logs).at(-1) === "8");
  world.reset();
  world.start();
  world.signal("once");
  t("やり直すと「一度だけ」も元に戻る", texts(logs).filter((x) => x.startsWith("once")).length === 4);
}

section("関数とマクロ：保存するときの検査");
{
  const g = sanitizeGimmick({
    graph: { nodes: [{ id: "a", type: "call.function", values: { fn: "f1" } }] },
    functions: [
      {
        id: "f1", name: "x".repeat(100), kind: "function", pure: true, desc: "説明",
        inputs: [{ id: "p1", name: "数", type: "number" }, { id: "p1", name: "重複", type: "string" }, { id: "bad id", name: "", type: "hack" }, { id: "p9", type: "exec" }],
        outputs: [{ id: "p2", name: "答え", type: "number" }],
        graph: { nodes: [{ id: "e", type: "fn.entry", values: { fn: "f1" } }], links: [] },
      },
      { id: "m1", name: "", kind: "macro", pure: true, inputs: [{ id: "p1", name: "実行", type: "exec" }], outputs: [], graph: null },
      { id: "m1", name: "重複", kind: "hack" },
      null,
    ],
  }, "z");
  const [f, m, h] = g.functions;
  t("関数とマクロを保存できる", g.functions.length === 3 && f.kind === "function" && m.kind === "macro" && h.kind === "function");
  t("id の重複は振り直す", h.id !== "m1");
  t("名前は 60 文字まで・空なら仲間の名前", f.name.length === 60 && m.name === "マクロ" && h.name === "重複");
  t("入出力の id は重ならないように振り直す", f.inputs.map((p) => p.id).join() === "p1,p2,p3" && f.outputs[0].id === "p4");
  t("知らない種類は「なんでも」・名前が空なら「入力」", f.inputs[2].type === "any" && f.inputs[2].name === "入力");
  t("関数は実行ピンを入出力に持てない（マクロは持てる）", !f.inputs.some((p) => p.type === "exec") && m.inputs[0].type === "exec");
  t("ピュアは関数だけ", f.pure === true && m.pure === false);
  t("中のブループリントも検査する", f.graph.nodes.length === 1 && m.graph.nodes.length === 0);
  t("一覧の要約は関数の数と、中のノードも数える", gimmickSummary(g).functions === 3 && gimmickSummary(g).nodes === 2);
  const many = sanitizeGimmick({ functions: Array.from({ length: GIMMICK_LIMITS.functions + 5 }, () => ({ kind: "function" })) }, "z");
  t("関数・マクロの数に上限", many.functions.length === GIMMICK_LIMITS.functions);
  const big = sanitizeGimmick({
    graph: { nodes: Array.from({ length: GIMMICK_LIMITS.nodes }, () => ({ type: "action.print" })) },
    functions: Array.from({ length: 20 }, () => ({ graph: { nodes: Array.from({ length: GIMMICK_LIMITS.functionNodes + 10 }, () => ({ type: "action.print" })) } })),
  }, "z");
  t("関数1つのノードの数に上限", big.functions[0].graph.nodes.length === GIMMICK_LIMITS.functionNodes);
  t("全部合わせたノードの数にも上限", big.graph.nodes.length + big.functions.reduce((n, x) => n + x.graph.nodes.length, 0) === GIMMICK_LIMITS.totalNodes);
  t("入出力の数に上限", sanitizeGimmick({ functions: [{ inputs: Array.from({ length: 40 }, () => ({ type: "number" })) }] }, "z").functions[0].inputs.length === GIMMICK_LIMITS.params);
}

section("関数とマクロ：エディタの操作（functions.js）");
{
  const g = { variables: [{ name: "score", value: 0 }], objects: [], sounds: [], effects: [], graph: { nodes: [], links: [], comments: [] }, functions: [] };
  const f = createFunction(g, "function");
  const m = createFunction(g, "macro");
  t("作ると入口と出口がつながっている", f.graph.nodes.map((n) => n.type).join() === "fn.entry,fn.return" && f.graph.links.length === 1 && m.graph.links[0].fromPin === "p1" && m.inputs[0].type === "exec");
  t("名前は重ならない", createFunction(g, "function").name === "新しい関数 2");
  const a = addParam(g, f.id, "in", "number");
  const r = addParam(g, f.id, "out", "number");
  t("入力・出力を足す（id は p1, p2 …）", a.id === "p1" && r.id === "p2" && a.name === "入力");
  t("関数には実行の入出力は足せない", addParam(g, f.id, "in", "exec").type === "number");
  // 呼ぶノードをつなぐ
  const ev = newNode("event.signal", 0, 0, { name: "x" }, "e");
  const call = newNode("call.function", 300, 0, { fn: f.id }, "c");
  const pr = newNode("action.print", 600, 0, {}, "p");
  g.graph.nodes.push(ev, call, pr);
  g.graph.links.push({ from: "e", fromPin: "then", to: "c", toPin: "exec" }, { from: "e", fromPin: "count", to: "c", toPin: "p1" }, { from: "c", fromPin: "p2", to: "p", toPin: "text" }, { from: "c", fromPin: "then", to: "p", toPin: "exec" });
  t("呼んでいる数", callSites(g, f.id) === 1);
  updateParam(g, f.id, "p1", { type: "entity" });
  t("入力の種類を変えると、合わなくなった線は外れる", !g.graph.links.some((l) => l.toPin === "p1") && g.graph.links.length === 3);
  removeParam(g, f.id, "p2");
  t("出力を消すと、そのピンの線も外れる", !g.graph.links.some((l) => l.fromPin === "p2"));
  setPure(g, f.id, true);
  t("ピュアにすると、呼ぶノードの実行の線も外れる", !g.graph.links.some((l) => l.to === "c" || l.from === "c"));
  setPure(g, f.id, false);
  const dup = duplicateFunction(g, f.id);
  t("複製は別の id・入口も新しい id を指す", dup.id !== f.id && dup.graph.nodes.every((n) => n.values.fn === dup.id) && dup.graph.nodes[0].id !== f.graph.nodes[0].id);
  t("消すと、呼んでいるノードも消える", deleteFunction(g, f.id) === 1 && !g.graph.nodes.some((n) => n.id === "c") && !g.functions.some((x) => x.id === f.id));
  pruneLinks(g);
  t("消したあとも、残りの線は壊れない", g.graph.links.every((l) => g.graph.nodes.some((n) => n.id === l.from) && g.graph.nodes.some((n) => n.id === l.to)));

  // 関数にまとめる：合図 → 足す → 表示 のうち「足す」と、足す数を計算するノードをまとめる
  const h = { ...g, graph: { nodes: [], links: [], comments: [] }, functions: [] };
  const b = bp("k");
  const s0 = b.n("event.signal", { name: "go" });
  const mul = b.n("math.mul", { b: 2 });
  const add = b.n("var.add", { var: "score" });
  const out = b.n("action.print", { text: "{score}" });
  b.go(s0, add, out);
  b.wire(s0, "count", mul, "a");
  b.wire(mul, "result", add, "amount");
  h.graph = { nodes: b.nodes, links: b.links, comments: [] };
  t("イベントはまとめられない", typeof collapseToFunction(h, h.graph, new Set([s0.id, add.id]), "function") === "string");
  const res = collapseToFunction(h, h.graph, new Set([mul.id, add.id]), "function");
  t("まとめると、元の場所に呼ぶノードが1つ", typeof res === "object" && h.graph.nodes.length === 3 && h.graph.nodes.some((n) => n.type === "call.function"));
  t("外から来る値は入力になる（合図の個数）", res.fn.inputs.length === 1 && res.fn.inputs[0].type === "number");
  const world = createWorld({ ...h, variables: [{ name: "score", value: 0 }] }, { onLog: () => {} });
  world.start();
  world.signal("go", { count: 4 });
  t("まとめても同じように動く（4 × 2 を足す）", world.vars.score === 8);
  const calc = { ...g, graph: { nodes: [], links: [], comments: [] }, functions: [] };
  const c = bp("c");
  const ce = c.n("event.signal", { name: "go" });
  const m1 = c.n("math.add", { b: 10 });
  const cp = c.n("action.print");
  c.go(ce, cp);
  c.wire(ce, "count", m1, "a");
  c.wire(m1, "result", cp, "text");
  calc.graph = { nodes: c.nodes, links: c.links, comments: [] };
  const res2 = collapseToFunction(calc, calc.graph, new Set([m1.id]), "function");
  t("計算のノードだけをまとめるとピュア関数", res2.fn.pure === true && res2.fn.outputs.length === 1);
  const logs = [];
  const w2 = createWorld(calc, { onLog: (text, level) => logs.push({ text, level }) });
  w2.start();
  w2.signal("go", { count: 5 });
  t("ピュア関数にまとめても同じ答え", texts(logs).at(-1) === "15");
  const mac = { ...g, graph: { nodes: [], links: [], comments: [] }, functions: [] };
  const mb = bp("m");
  const me = mb.n("event.signal", { name: "go" });
  const md = mb.n("flow.delay", { seconds: 0.2 });
  const mp = mb.n("action.print", { text: "done" });
  mb.go(me, md);
  mb.go([md, "completed"], mp);
  mac.graph = { nodes: mb.nodes, links: mb.links, comments: [] };
  t("「待つ」は関数にはまとめられない", typeof collapseToFunction(mac, mac.graph, new Set([md.id]), "function") === "string");
  const res3 = collapseToFunction(mac, mac.graph, new Set([md.id]), "macro");
  t("マクロにはまとめられる（実行の入口・出口つき）", typeof res3 === "object" && res3.fn.inputs.some((p) => p.type === "exec") && res3.fn.outputs.some((p) => p.type === "exec"));
  const logs3 = [];
  const w3 = createWorld(mac, { onLog: (text, level) => logs3.push({ text, level }) });
  w3.start();
  w3.signal("go");
  run(w3, 0.3);
  t("マクロにまとめても同じように動く（待ってから表示）", texts(logs3).includes("done"));
}

section("テンプレート（関数・マクロの見本）");
{
  for (const tpl of GIMMICK_TEMPLATES) {
    const g = sanitizeGimmick(JSON.parse(JSON.stringify(tpl.build())), "tpl");
    const logs = [];
    const traced = [];
    const world = createWorld(g, { onLog: (text, level) => logs.push({ text, level }), onTrace: (id, gid) => traced.push(gid || ""), random: () => 0.5 });
    world.start();
    run(world, 1);
    for (const name of signalNames(g)) world.signal(name, { user: "a", count: 2, coins: 10 });
    world.liveEvent({ type: "chat", user: { name: "a" }, text: "!でかい" });
    world.liveEvent({ type: "chat", user: { name: "a" }, text: "2" });
    world.liveEvent({ type: "chat", user: { name: "a" }, text: "ジャンプ" });
    world.liveEvent({ type: "gift", user: { name: "a" }, gift: { name: "ローズ", coins: 1 }, count: 1 });
    run(world, 3);
    const warns = logs.filter((l) => l.level === "warn");
    t(`「${tpl.name}」は保存しても形が変わらず、警告なしで動く`, warns.length === 0 && g.graph.links.length === tpl.build().graph.links.length);
    // （やり直し・次のレースのように、勝負がついてから呼ぶものもあるので、どれか1つ）
    if (g.functions.length) t(`「${tpl.name}」の自作の関数・マクロが動く`, g.functions.some((f) => traced.includes(f.id) || f.pure));
  }
  const vote = sanitizeGimmick(GIMMICK_TEMPLATES.find((x) => x.id === "vote").build(), "v");
  const w = createWorld(vote, { onLog: () => {} });
  w.start();
  w.liveEvent({ type: "chat", user: { name: "a" }, text: "1" });
  w.liveEvent({ type: "chat", user: { name: "a" }, text: "1" });
  w.liveEvent({ type: "chat", user: { name: "b" }, text: "2" });
  const bar = (tag) => w.entities.find((e) => e.tag === tag);
  t("投票：ピュア関数「棒の幅」で幅を計算する（2票:1票）", Math.round(bar("bar1").w) === Math.round(2 / 3 * 460) && Math.round(bar("bar2").w) === Math.round(460 / 3) && bar("bar3").w === 4);
}

section("ミニゲーム（5ジャンル）");
{
  const make = (id, random = () => 0.5) => {
    const tpl = GIMMICK_TEMPLATES.find((x) => x.id === id);
    const g = sanitizeGimmick(JSON.parse(JSON.stringify(tpl.build())), id);
    const logs = [];
    const world = createWorld(g, { onLog: (text, level) => logs.push({ text, level }), random });
    world.start();
    return { g, world, logs, tpl };
  };
  const by = (world, name) => world.entities.find((e) => e.name === name && !e.dead);
  const say = (world, text, name = "さくら") => world.liveEvent({ type: "chat", user: { name }, text });
  const send = (world, name = "たろう", count = 1, coins = 1) => world.liveEvent({ type: "gift", user: { name }, gift: { name: "ローズ", coins }, count });
  const quiet = (logs) => !logs.some((l) => l.level === "warn");
  const minis = GIMMICK_TEMPLATES.filter((x) => x.group === "minigame");
  t("ミニゲームは6つ・ジャンルがすべて違う", minis.length === 6 && new Set(minis.map((x) => x.genre)).size === 6);
  t("どれも自作の関数かマクロを使っている", minis.every((x) => x.build().functions.length >= 2));
  t("アーティストモードに見せる合図は、外から送る意味のあるものだけ（スロットの「回す」）", minis.map((x) => signalNames(x.build()).join("|")).join(",") === ",,回す,,,");

  // 🏃 障害物ジャンプ
  {
    const { world, logs } = make("mg-runner");
    run(world, 0.2);
    const p = by(world, "プレイヤー");
    t("ジャンプ：地面に立っている", world.vars.landed === 1 && Math.round(p.y + p.h) === 360);
    say(world, "ジャンプ！");
    run(world, 0.1);
    t("ジャンプ：コメント「ジャンプ」で関数「ジャンプ」が跳ばせ、名前が出る", p.vy < 0 && p.y < 280 && world.vars.last.includes("さくら"));
    const vy = p.vy;
    say(world, "ジャンプ");
    run(world, 0.02);
    t("ジャンプ：空中ではもう一度跳べない", p.vy > vy);
    run(world, 1);
    t("ジャンプ：着地すると、また跳べる", world.vars.landed === 1);
    say(world, "ｼﾞｬﾝﾌﾟ");
    run(world, 0.05);
    t("ジャンプ：半角のｼﾞｬﾝﾌﾟでも跳ぶ", p.vy < 0);
    run(world, 1);
    world.liveEvent({ type: "like", user: { name: "いいね" }, likes: 5 });
    run(world, 0.05);
    t("ジャンプ：いいね5件でも跳ぶ", p.vy < 0 && world.vars.last.includes("いいね"));
    t("ジャンプ：障害物が右の外から走ってくる", world.entities.some((e) => e.tag === "rock" && !e.dead && e.vx < -300));
    // 誰も跳ばなければ、いつかはぶつかる
    for (let k = 0; k < 20 * 60 && !world.vars.over; k++) world.step(1 / 60);
    t("ジャンプ：ぶつかるとゲームオーバー（距離がベストに残る・顔が変わる）", world.vars.over === 1 && world.vars.best >= 30 && world.vars.best === world.vars.score && p.look.emoji === "😵" && !by(world, "ゲームオーバー").hidden);
    const frozen = world.vars.score;
    run(world, 1);
    t("ジャンプ：ゲームオーバー中は距離がのびない", world.vars.score === frozen);
    run(world, 2.1);
    t("ジャンプ：3秒後に関数「やり直す」で 0 m から（障害物は片付く）", world.vars.over === 0 && world.vars.score < 10 && p.look.emoji === "🐱" && by(world, "ゲームオーバー").hidden && world.vars.best >= 30 && !world.entities.some((e) => e.tag === "rock" && !e.dead && e.x < 900));
    send(world, "ギフト太郎");
    run(world, 0.1);
    t("ジャンプ：ギフトでむてき（タグが hero になる）", p.tag === "hero" && p.look.emoji === "🦸" && world.vars.last.includes("ギフト太郎"));
    run(world, 3);
    t("ジャンプ：3秒でむてきが終わる", p.tag === "player" && p.look.emoji === "🐱");
    t("ジャンプ：警告なし", quiet(logs));
  }

  // 🚀 コメント迎撃
  {
    const { world, logs } = make("mg-shooter");
    const bullets = () => world.entities.filter((e) => e.tag === "bullet" && !e.dead);
    run(world, 0.2);
    say(world, "いけー", "さくら");
    run(world, 0.02);
    t("迎撃：コメントで関数「弾を撃つ」が1発（撃った人を覚えている）", bullets().length === 1 && bullets()[0].vy < 0 && bullets()[0].data.user === "さくら");
    send(world);
    run(world, 0.02);
    t("迎撃：ギフトで5方向（横の速さが -340〜340）", bullets().length === 6 && bullets().map((e) => Math.round(e.vx)).sort((a, b) => a - b).join() === "-340,-170,0,0,170,340");
    run(world, 3);
    const foe = world.entities.find((e) => e.tag === "enemy" && !e.dead);
    const cannon = by(world, "ロケット");
    // ロケットを敵の真下に止めて撃つ
    cannon.vx = 0;
    cannon.x = foe.x + foe.w / 2 - cannon.w / 2;
    say(world, "当たれ", "はなこ");
    run(world, 1);
    const pop = world.entities.find((e) => e.tag === "pop");
    t("迎撃：弾が敵に当たると +10点・撃った人の名前が浮かぶ", world.vars.score === 10 && foe.dead && pop?.data.user === "はなこ" && world.textOf(pop) === "+10 はなこ");
    run(world, 14);
    t("迎撃：敵が下まで来るとライフが減り、0 でゲームオーバー", world.vars.over === 1 && world.vars.life <= 0 && world.vars.best === 10 && !by(world, "ゲームオーバー").hidden);
    say(world, "撃つ");
    run(world, 0.02);
    t("迎撃：ゲームオーバー中は撃てない", bullets().length === 0);
    run(world, 4.2);
    t("迎撃：4秒後に関数「やり直す」でライフ満タン", world.vars.over === 0 && world.vars.life === 3 && world.vars.score === 0 && world.vars.best === 10);
    t("迎撃：警告なし", quiet(logs));
  }

  // 🎰 ギフトスロット
  {
    const { world, logs } = make("mg-slot", () => 0);
    const msg = by(world, "メッセージ");
    const reels = world.entities.filter((e) => e.tag === "reel");
    send(world, "さくら");
    run(world, 0.5);
    t("スロット：ギフトで回り始める（回っている間は絵柄が変わる）", world.vars.spinning === 1 && world.textOf(msg) === "🎰 さくら さんのスロット！");
    run(world, 1.1);
    t("スロット：1.2秒後に左から止まる（マクロ「リールを止める」）", world.vars.spin1 === 0 && world.vars.spin3 === 1 && reels[0].scale > 1);
    run(world, 2);
    t("スロット：3つそろうと JACKPOT（ピュア関数「役」）", world.vars.jackpots === 1 && world.textOf(msg).includes("JACKPOT") && reels.every((e) => e.look.emoji === "🍒" && e.scale === 1));
    run(world, 3);
    t("スロット：終わると止まる", world.vars.spinning === 0);
    send(world, "たろう", 3);
    run(world, 0.2);
    send(world, "はなこ");
    t("スロット：個数ぶんと、回っている間のギフトは順番待ち", world.vars.queue === 3 && world.vars.nextWho === "はなこ");
    run(world, 40);
    t("スロット：順番待ちを全部回す（待つをはさんだ合図の連鎖は止めない）", world.vars.queue === 0 && world.vars.spinning === 0 && world.vars.jackpots === 5);
    say(world, "！スロット", "全角");
    run(world, 0.1);
    t("スロット：コメント「!スロット」（全角の！でも）で1回", world.vars.spinning === 1 && world.vars.who === "全角");
    t("スロット：警告なし", quiet(logs));
  }
  {
    // 絵柄が順に変わる乱数：はずれ
    let i = 0;
    const seq = [0, 0.3, 0.7, 0.9];
    const { world } = make("mg-slot", () => seq[i++ % seq.length]);
    send(world, "さくら");
    run(world, 6);
    const hands = new Set([world.vars.s1, world.vars.s2, world.vars.s3]);
    const text = world.textOf(by(world, "メッセージ"));
    t("スロット：そろわなければ「ざんねん」・2つなら「あたり」", hands.size === 3 ? text.includes("ざんねん") : hands.size === 2 ? text.includes("あたり") : text.includes("JACKPOT"));
  }

  // 🏇 コメント競馬
  {
    const { world, logs } = make("mg-race");
    const rabbit = by(world, "うさぎ");
    for (let k = 0; k < 5; k++) { say(world, "1", `ファン${k}`); run(world, 0.05); }
    run(world, 0.3);
    t("競馬：コメント「1」で関数「進める」が1番の子を前へ", world.vars.p1 > 80 && Math.abs(rabbit.x + rabbit.w / 2 - (95 + world.vars.p1)) < 1 && world.vars.p2 === 0);
    say(world, "１", "全角");
    run(world, 0.3);
    t("競馬：全角の「１」でも進む", world.vars.p1 > 100);
    send(world, "ギフト", 3);
    run(world, 0.3);
    t("競馬：ギフトでいちばん後ろの子がターボ（同じなら全員）", world.vars.p2 > 50 && world.vars.p3 > 50 && world.vars.p4 > 50);
    for (let k = 0; k < 80 && !world.vars.over; k++) { say(world, "1", "最後の人"); run(world, 0.05); }
    run(world, 0.3);
    const win = by(world, "勝ち");
    t("競馬：ゴールしたら勝った子と、とどめの応援を発表", world.vars.over === 1 && world.vars.winner === "うさぎ" && !win.hidden && world.textOf(win).includes("最後の人"));
    const p2 = world.vars.p2;
    say(world, "2");
    run(world, 0.1);
    t("競馬：決まったあとは進まない", world.vars.p2 === p2);
    run(world, 5.5);
    t("競馬：5秒後に関数「次のレース」でスタートへ", world.vars.over === 0 && world.vars.round === 2 && world.vars.p1 === 0 && Math.round(rabbit.x) === 60 && win.hidden);
    t("競馬：警告なし", quiet(logs));
  }

  // 🐉 ミニモンスター（乱数 0.5：5番のタコスミン・みずタイプ・Lv.1・HP 29 が出る）
  {
    const { world, logs } = make("mg-monsters");
    run(world, 0.8);
    const wild = by(world, "あいて");
    const buddy = by(world, "相棒");
    t("モンスター：番号から表を引いて登場（名前・絵文字・タイプ・HP）", world.vars.state === 1 && world.vars.wildName === "タコスミン" && wild.look.emoji === "🐙" && world.vars.wildType === "みず" && world.vars.wildMax === 29 && Math.round(wild.x + wild.w / 2) === 710 && world.vars.msg.includes("とびだしてきた"));
    say(world, "!たたかう");
    t("モンスター：!たたかう でふつうのダメージ", world.vars.wildHp === 25 && world.vars.msg === "さくら さんの パンチ！ 4 ダメージ");
    say(world, "！くさ", "はなこ");
    t("モンスター：相性がいいと 2倍（全角の！でも）", world.vars.wildHp === 17 && world.vars.msg.includes("こうかは ばつぐんだ"));
    say(world, "!ほのお", "たろう");
    t("モンスター：相性が悪いと半分", world.vars.wildHp === 15 && world.vars.msg.includes("いまひとつ"));
    run(world, 0.2);
    const bar = world.entities.find((e) => e.tag === "wildbar");
    t("モンスター：HP のバーが縮む（半分を切ると黄色）", Math.round(bar.w) === Math.round(340 * 15 / 29) && bar.look.fill === "#5cff9d");
    say(world, "!ボール", "さくら");
    t("モンスター：!ボール でつかまえ玉（投げている間はこうげきできない）", world.vars.state === 3 && world.vars.msg.includes("つかまえ玉を なげた"));
    say(world, "!たたかう");
    t("モンスター：…こうげきは数えない", world.vars.wildHp === 15);
    run(world, 2.2);
    t("モンスター：弱らせるとつかまえやすい → 図鑑に登録・経験値でレベルアップ", world.vars.caught === 1 && world.vars.dex === "🐙" && world.vars.dexCount === 1 && world.vars.lv === 2 && world.vars.teamMax === 70 && world.vars.msg.includes("つかまえた"));
    run(world, 3.2);
    t("モンスター：3秒後に次のモンスター", world.vars.state === 1 && world.vars.wildHp === world.vars.wildMax);
    say(world, "!ボール");
    run(world, 2.5);
    t("モンスター：元気なうちはにげられやすい（あいては玉から出てくる）", world.vars.state === 1 && world.vars.caught === 1 && world.vars.msg.includes("とびだした") && !wild.hidden);
    world.vars.teamHp = 10;
    send(world, "ギフト太郎");
    t("モンスター：ギフトで相棒が全回復＋スーパーつかまえ玉", world.vars.teamHp === world.vars.teamMax && world.vars.state === 3 && world.vars.msg.includes("スーパーつかまえ玉"));
    run(world, 2.5);
    t("モンスター：同じモンスターは図鑑に二重に載らない", world.vars.caught === 2 && world.vars.dexCount === 1 && world.vars.dex === "🐙");
    run(world, 3.2);
    for (let k = 0; k < 20 && world.vars.wildHp > 0; k++) say(world, "!くさ", "みんな");
    run(world, 0.05);
    t("モンスター：HP が 0 になるとたおして経験値", world.vars.state === 2 && world.vars.msg.includes("たおした"));
    run(world, 2.7);
    const hp = world.vars.teamHp;
    run(world, 4.6);
    t("モンスター：あいても一定時間ごとにこうげきしてくる", world.vars.teamHp < hp && world.vars.msg.includes("の こうげき"));
    world.vars.teamHp = 1;
    for (let k = 0; k < 6 * 60 && world.vars.state !== 4; k++) world.step(1 / 60);
    t("モンスター：相棒がたおれると、ひとやすみ（あいてはにげる）", world.vars.state === 4 && buddy.opacity < 1 && world.vars.msg.includes("にげていった"));
    let waited = 0;
    while (world.vars.state === 4 && waited < 600) { world.step(1 / 60); waited++; }
    t("モンスター：4秒後に HP 満タンで次のモンスター", world.vars.state === 1 && waited > 200 && world.vars.teamHp === world.vars.teamMax && buddy.opacity === 1);
    const before = world.vars.teamHp;
    world.vars.teamHp = before - 10;
    world.liveEvent({ type: "like", user: { name: "いいね" }, likes: 20 });
    t("モンスター：いいね20件で +5 回復", world.vars.teamHp === before - 5 && world.entities.some((e) => e.tag === "pop" && world.textOf(e) === "❤ +5"));
    world.vars.lv = 5;
    run(world, 0.1);
    t("モンスター：レベル5で「おや…？」", world.vars.evo === 2 && world.vars.msg.includes("ようすが"));
    run(world, 1.7);
    t("モンスター：マクロ「しんか」で 🐣 ピヨッチ に", buddy.look.emoji === "🐣" && world.vars.buddyName === "ピヨッチ" && world.vars.msg.includes("しんかした"));
    world.vars.lv = 10;
    run(world, 2);
    t("モンスター：レベル10で 🦅 ソラワシ に", buddy.look.emoji === "🦅" && world.vars.buddyName === "ソラワシ");
    t("モンスター：警告なし", quiet(logs));
  }
  {
    const { world } = make("mg-monsters", () => 0.01);
    run(world, 0.8);
    t("モンスター：たまにレアの「ユメユニ」（レベル +3）", world.vars.wildName === "ユメユニ" && world.vars.wildType === "ゆめ" && world.vars.wildLv === 4 && world.vars.msg.includes("レア"));
  }
  t("式の choose()：n 番目を選ぶ（範囲の外は 0）", evalExpr("choose(2, \"a\", \"b\", \"c\")", scope()) === "b" && evalExpr("choose(9, 1, 2)", scope()) === 0 && evalExpr("choose(1.9, 10, 20)", scope()) === 10);

  // 🔢 数当てゲーム
  {
    const { world, logs } = make("mg-guess");
    const ans = world.vars.answer;
    t("数当て：始まると答えが 1〜100 に決まる", ans >= 1 && ans <= 100 && world.vars.lo === 1 && world.vars.hi === 100 && world.vars.center === "？");
    say(world, "こんにちは");
    say(world, "500");
    say(world, "42です");
    t("数当て：数でないコメント・範囲の外の数は数えない", world.vars.tries === 0);
    say(world, String(ans - 10), "さくら");
    t("数当て：小さすぎると「もっと大きい」・範囲が上がる", world.vars.lo === ans - 9 && world.vars.hint.includes("もっと大きい") && world.vars.hint.includes("さくら") && world.vars.tries === 1);
    say(world, String(ans + 10), "はなこ");
    t("数当て：大きすぎると「もっと小さい」・範囲が下がる", world.vars.hi === ans + 9 && world.vars.hint.includes("もっと小さい"));
    run(world, 0.5);
    const bar = world.entities.find((e) => e.tag === "range");
    t("数当て：関数「範囲を表示」で棒が残りの範囲に縮む", Math.round(bar.w) === Math.round(19 / 100 * 700) && Math.round(bar.x) === Math.round(100 + (ans - 10) / 100 * 700));
    send(world, "ギフト");
    t("数当て：ギフトで範囲が答えのほうへ半分に", world.vars.lo <= ans && world.vars.hi >= ans && world.vars.hi - world.vars.lo <= 10 && world.vars.hint.includes("ヒント"));
    const wide = String(ans).replace(/[0-9]/g, (d) => String.fromCharCode(0xff10 + Number(d)));
    say(world, wide, "全角さん");
    t("数当て：全角の数字でも正解できる", world.vars.over === 1 && world.vars.center === String(ans) && world.vars.hint.includes("全角さん"));
    say(world, "1");
    t("数当て：正解のあとは受け付けない", world.vars.tries === 3);
    run(world, 6.2);
    t("数当て：6秒後に関数「新しい問題」", world.vars.over === 0 && world.vars.tries === 0 && world.vars.center === "？" && world.vars.hi === 100);
    t("数当て：警告なし", quiet(logs));
  }
}

section("部品の既定値");
{
  t("既定値と重ねる", normalizeObject({ look: { fill: "#fff" } }).look.shape === "rect" && normalizeObject({}).body.type === "none");
  t("形からオブジェクトを作る", createObject("text").look.shape === "text" && !!createObject("text").id);
}

finish();
