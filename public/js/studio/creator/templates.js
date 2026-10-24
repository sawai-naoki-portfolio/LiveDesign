// public/js/studio/creator/templates.js
// クリエイターモードの「テンプレートから作る」。ゲーム・エフェクト・サウンド・その他のひな形。
// どれも、そのままアーティストモードに置いて配信で使えるところまで作ってあり、
// 動きはブループリント（ノード）で組んである。ノードの組み方の見本にもなるよう、まとまりごとにコメントで囲む。
// 自作の関数・マクロの見本：ブロック崩し（関数「ボールを打ち出す」）・演出パック（マクロ「花火を1発」）・
// コメント投票（ピュア関数「棒の幅」）。ジャンルごとのミニゲームは minigames.js。
import { createBlankGimmick } from "../shared/gimmick/defaults.js";
import { sound, effect, obj, blueprint } from "./templatekit.js";
import { MINIGAME_TEMPLATES } from "./minigames.js";

// ===============================
// 🎮 ブロック崩し（ギフトでボールが増える）
// ===============================
function breakout() {
  const g = createBlankGimmick("game", "ギフトでブロック崩し");
  g.description = "ギフトでボールが増え、ブロックを全部壊すと花火。「!でかい」で大きなボール";
  g.background = "#0b0b1add";
  g.gravity = 0;
  const colors = ["#ff5c8a", "#ffc93c", "#5cff9d", "#3ce0ff"];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 8; c++) {
      g.objects.push(obj({
        name: `ブロック ${r + 1}-${c + 1}`, tag: "block", x: 24 + c * 95, y: 70 + r * 40, w: 86, h: 30,
        look: { shape: "rect", fill: colors[r], radius: 6, glow: 8, glowColor: colors[r] }, body: { type: "static" },
      }));
    }
  }
  const ball = obj({
    name: "ボール", tag: "ball", prefab: true, x: 380, y: 480, w: 26, h: 26,
    look: { shape: "ellipse", fill: "#ffffff", glow: 14, glowColor: "#3ce0ff" },
    body: { type: "dynamic", gravity: 0, bounce: 1, friction: 0, edges: "bounce" },
  });
  const score = obj({ name: "スコア", x: 20, y: 14, w: 360, h: 44, look: { shape: "text", text: "SCORE {score}", font: "Orbitron", fontSize: 30, textColor: "#ffffff" } });
  const info = obj({ name: "説明", x: 380, y: 14, w: 400, h: 44, look: { shape: "text", text: "🎁 ギフトでボール追加", font: "Noto Sans JP", fontSize: 22, textColor: "#ffffffaa" } });
  g.objects.push(ball, score, info);
  const hit = sound("blip", "当たった");
  const coin = sound("coin");
  const fanfare = sound("fanfare");
  const spark = effect("burst", { count: 24, speed: 300, size: 10 }, "ブロックが壊れる");
  const fireworks = effect("fireworks");
  g.sounds.push(hit, coin, fanfare);
  g.effects.push(spark, fireworks);
  g.variables.push({ name: "score", value: 0, exposed: false, label: "" }, { name: "speed", value: 420, exposed: true, label: "ボールの速さ" });

  const b = blueprint(g);
  // 関数「ボールを打ち出す」：X の位置の下から斜め上へ。出したボールを出力に返す（何か所からでも呼べる）
  const shoot = b.fn({
    name: "ボールを打ち出す", desc: "X の位置の下から、ボールを斜め上へ打ち出します。出したボールを返します。",
    inputs: [["X", "number"]], outputs: [["ボール", "entity"]],
  });
  let r = shoot.row("関数：入口 → 出す → 出口（出口の「ボール」が呼んだ所の出力になる）", "#9b6bff");
  const fe = r.n("fn.entry", 0, 0);
  const sp = r.n("action.spawn", 1, 0, { prefab: ball.id, at: "xy", y: 520 });
  const fr = r.n("fn.return", 2.3, 0);
  const vx = r.n("expr", 0, 160, { expr: "pick(-1, 1) * speed * 0.7" });
  const vg = r.n("var.get", 0, 350, { var: "speed" });
  const neg = r.n("math.mul", 1, 360, { b: -1 });
  shoot.go(fe, sp, fr);
  shoot.wire(fe, "p1", sp, "x");
  shoot.wire(vx, "result", sp, "vx");
  shoot.wire(vg, "value", neg, "a");
  shoot.wire(neg, "result", sp, "vy");
  shoot.wire(sp, "spawned", fr, "p2");
  r.end();

  r = b.row("合図「ボール」で、自作の関数「ボールを打ち出す」を呼ぶ（ダブルクリックで中身が開く）", "#4ec3ff");
  const sig = r.n("event.signal", 0, 0, { name: "ボール" });
  const call = r.n("call.function", 1, 0, { fn: shoot.f.id });
  const rx = r.n("expr", 0, 300, { expr: "random(100, W - 100)" });
  b.go(sig, call);
  b.wire(rx, "result", call, "p1");
  r.end();

  r = b.row("始まったら1つ。ギフトが来たら、個数ぶん（5個まで・全部で30個まで）", "#ff5c8a");
  const st = r.n("event.start", 0, 0);
  const em0 = r.n("action.emit", 1, 0, { name: "ボール" });
  b.go(st, em0);
  const gf = r.n("event.gift", 0, 120);
  const br = r.n("flow.branch", 1, 120);
  const fl = r.n("flow.forLoop", 2, 120, { first: 1 });
  const em1 = r.n("action.emit", 3, 100, { name: "ボール" });
  const cs = r.n("action.playSound", 3, 220, { sound: coin.id, volume: 0.6 });
  const many = r.n("get.findTag", 1, 300, { tag: "ball" });
  const lt = r.n("cmp.lt", 2, 380, { b: 30 });
  const mn = r.n("math.min", 2, 480, { b: 5 });
  b.go(gf, br);
  b.go([br, "true"], fl);
  b.go([fl, "body"], em1);
  b.go([fl, "completed"], cs);
  b.wire(many, "count", lt, "a");
  b.wire(lt, "result", br, "cond");
  b.wire(gf, "count", mn, "a");
  b.wire(mn, "result", fl, "last");
  r.end();

  r = b.row("「!でかい」で大きなボール（同じ関数を真ん中から呼び、返ってきたボールを大きくする）", "#9b6bff");
  const ch = r.n("event.chat", 0, 0, { match: "command", keyword: "!でかい" });
  const big = r.n("call.function", 1, 0, { fn: shoot.f.id, p1: 400 });
  const size = r.n("action.setSize", 2, 0, { w: 70, h: 70 });
  b.go(ch, big, size);
  b.wire(big, "p2", size, "target");
  r.end();

  r = b.row("ボールがブロックに当たったら壊して +10点", "#ffb03c");
  const co = r.n("event.collide", 0, 0, { a: "ball", b: "block" });
  const ds = r.n("action.destroy", 1, 0, { effect: spark.id });
  const add = r.n("var.add", 2, 0, { var: "score", amount: 10 });
  const hs = r.n("action.playSound", 3, 0, { sound: hit.id, volume: 0.5 });
  b.go(co, ds, add, hs);
  b.wire(co, "other", ds, "target");
  r.end();

  r = b.row("ブロックを全部壊したら花火で最初から", "#5cff9d");
  const wh = r.n("event.when", 0, 0);
  const left = r.n("get.findTag", 0, 140, { tag: "block" });
  const zero = r.n("cmp.eq", 1, 240, { b: 0 });
  const s1 = r.n("action.playSound", 1, 0, { sound: fanfare.id });
  const e1 = r.n("action.playEffect", 2, 0, { effect: fireworks.id, x: 240, y: 240 });
  const e2 = r.n("action.playEffect", 3, 0, { effect: fireworks.id, x: 560, y: 210 });
  const fla = r.n("action.flash", 4, 0, { seconds: 0.4 });
  const pr = r.n("action.print", 5, 0, { text: "クリア！ score = {score}" });
  const dl = r.n("flow.delay", 6, 0, { seconds: 4 });
  const rs = r.n("action.restart", 7, 0);
  b.go(wh, s1, e1, e2, fla, pr, dl);
  b.go([dl, "completed"], rs);
  b.wire(left, "count", zero, "a");
  b.wire(zero, "result", wh, "cond");
  r.end();
  return b.done();
}

// ===============================
// 🎮 ギフトの雨（ギフトの画像が降って積もる）
// ===============================
function giftRain() {
  const g = createBlankGimmick("game", "ギフトの雨");
  g.description = "ギフトの画像が降ってきて床に積もる。合計コインが目標に届くと花火";
  g.width = 1080;
  g.height = 720;
  g.gravity = 1400;
  const floor = obj({ name: "床", tag: "floor", x: 0, y: 700, w: 1080, h: 20, look: { shape: "rect", fill: "#ffffff22", radius: 10 }, body: { type: "static" } });
  const gift = obj({
    name: "ギフト", tag: "gift", prefab: true, x: 0, y: 0, w: 72, h: 72,
    look: { shape: "emoji", emoji: "🎁" },
    body: { type: "dynamic", gravity: 1, bounce: 0.35, friction: 2, edges: "bounce", spin: 0 },
    life: 30,
  });
  const total = obj({ name: "合計", x: 290, y: 20, w: 500, h: 70, look: { shape: "text", text: "🎁 {coins_total} / {goal}", font: "M PLUS Rounded 1c", fontSize: 48, fontWeight: 900, textColor: "#ffffff", outline: 6, outlineColor: "#000000" } });
  const last = obj({ name: "最後の人", x: 290, y: 90, w: 500, h: 44, look: { shape: "text", text: "{last} さん ありがとう！", font: "Noto Sans JP", fontSize: 28, textColor: "#ffe66d", outline: 5, outlineColor: "#000000" }, hidden: true });
  g.objects.push(floor, gift, total, last);
  const drop = sound("drop", "ぽとっ");
  const fanfare = sound("fanfare");
  const fireworks = effect("fireworks");
  const sparkle = effect("sparkle");
  g.sounds.push(drop, fanfare);
  g.effects.push(fireworks, sparkle);
  g.variables.push(
    { name: "coins_total", value: 0, exposed: false, label: "" },
    { name: "goal", value: 1000, exposed: true, label: "目標のコイン" },
    { name: "last", value: "", exposed: false, label: "" },
  );

  const b = blueprint(g);
  let r = b.row("ギフトが来たら、ギフトの画像を個数ぶん降らせる（10個まで）", "#ff5c8a");
  const gf = r.n("event.gift", 0, 0);
  const sp = r.n("action.spawn", 1, 0, { prefab: gift.id, at: "randomTop" });
  const add = r.n("var.add", 2, 0, { var: "coins_total" });
  const set = r.n("var.set", 3, 0, { var: "last" });
  const show = r.n("action.setVisible", 4, 0, { visible: true });
  const snd = r.n("action.playSound", 5, 0, { sound: drop.id, volume: 0.6 });
  const mn = r.n("math.min", 1, 330, { b: 10 });
  const rv = r.n("math.random", 1, 440, { min: -120, max: 120 });
  const lastRef = r.n("get.object", 3, 220, { object: last.id });
  b.go(gf, sp, add, set, show, snd);
  b.wire(gf, "count", mn, "a");
  b.wire(mn, "result", sp, "count");
  b.wire(rv, "result", sp, "vx");
  b.wire(gf, "giftImage", sp, "image");
  b.wire(gf, "coins", add, "amount");
  b.wire(gf, "user", set, "value");
  b.wire(lastRef, "found", show, "target");
  r.end();

  r = b.row("合図「降らせる」：その人のアイコンを降らせる", "#4ec3ff");
  const sig = r.n("event.signal", 0, 0, { name: "降らせる" });
  const sp2 = r.n("action.spawn", 1, 0, { prefab: gift.id, at: "randomTop" });
  const cnt = r.n("expr", 0, 260, { expr: "max(1, min(a, 10))" });
  b.go(sig, sp2);
  b.wire(sig, "count", cnt, "a");
  b.wire(cnt, "result", sp2, "count");
  b.wire(sig, "avatar", sp2, "image");
  r.end();

  r = b.row("合計コインが目標に届いたら花火", "#5cff9d");
  const wh = r.n("event.when", 0, 0);
  const vt = r.n("var.get", 0, 120, { var: "coins_total" });
  const vgoal = r.n("var.get", 0, 200, { var: "goal" });
  const ge = r.n("cmp.gte", 1, 150);
  const s1 = r.n("action.playSound", 1, 0, { sound: fanfare.id });
  const e1 = r.n("action.playEffect", 2, 0, { effect: fireworks.id, x: 270, y: 250 });
  const e2 = r.n("action.playEffect", 3, 0, { effect: fireworks.id, x: 810, y: 215 });
  const e3 = r.n("action.playEffect", 4, 0, { effect: sparkle.id, x: 540, y: 360 });
  const sh = r.n("action.shake", 5, 0, { strength: 14, seconds: 0.6 });
  const tx = r.n("action.setText", 6, 0, { text: "🎉 目標達成！" });
  const totalRef = r.n("get.object", 5, 240, { object: total.id });
  b.go(wh, s1, e1, e2, e3, sh, tx);
  b.wire(vt, "value", ge, "a");
  b.wire(vgoal, "value", ge, "b");
  b.wire(ge, "result", wh, "cond");
  b.wire(totalRef, "found", tx, "target");
  r.end();
  return b.done();
}

// ===============================
// 🎮 綱引きバトル（コメントで赤と青が引っぱり合う）
// ===============================
function tugOfWar() {
  const g = createBlankGimmick("game", "コメント綱引き");
  g.description = "コメント「!赤」「!青」で旗を引っぱり合う。端まで引いたチームの勝ち";
  g.width = 1200;
  g.height = 300;
  g.background = "#0b0b1acc";
  const track = obj({ name: "線", x: 100, y: 170, w: 1000, h: 8, look: { shape: "rect", fill: "#ffffff55", radius: 4 } });
  const red = obj({ name: "赤の陣地", x: 40, y: 120, w: 110, h: 110, look: { shape: "emoji", emoji: "🟥" } });
  const blue = obj({ name: "青の陣地", x: 1050, y: 120, w: 110, h: 110, look: { shape: "emoji", emoji: "🟦" } });
  const flag = obj({ name: "旗", tag: "flag", x: 560, y: 110, w: 80, h: 80, look: { shape: "emoji", emoji: "🚩" }, motion: { type: "swing", speed: 0.8, amount: 8 } });
  const scoreText = obj({ name: "人数", x: 300, y: 20, w: 600, h: 60, look: { shape: "text", text: "🟥 {red}  vs  {blue} 🟦", font: "Dela Gothic One", fontSize: 40, fontWeight: 400, textColor: "#ffffff" } });
  const howto = obj({ name: "遊び方", x: 300, y: 240, w: 600, h: 40, look: { shape: "text", text: "コメントで「!赤」か「!青」", font: "Noto Sans JP", fontSize: 24, textColor: "#ffffffaa" } });
  const win = obj({ name: "勝ち", x: 250, y: 90, w: 700, h: 120, hidden: true, look: { shape: "text", text: "", font: "Dela Gothic One", fontSize: 72, fontWeight: 400, textColor: "#ffe66d", outline: 8, outlineColor: "#000000" } });
  g.objects.push(track, red, blue, flag, scoreText, howto, win);
  const blip = sound("blip", "引いた");
  const fanfare = sound("fanfare");
  const fw = effect("fireworks");
  g.sounds.push(blip, fanfare);
  g.effects.push(fw);
  g.variables.push(
    { name: "pos", value: 0, exposed: false, label: "" },
    { name: "red", value: 0, exposed: false, label: "" },
    { name: "blue", value: 0, exposed: false, label: "" },
    { name: "goal", value: 20, exposed: true, label: "勝つまでの回数" },
    { name: "done", value: 0, exposed: false, label: "" },
  );

  const b = blueprint(g);
  let r = b.row("コメント「!赤」「!青」を合図に変える（アーティストモードのルールからも合図「赤」「青」を送れる）", "#ff5c8a");
  const cr = r.n("event.chat", 0, 0, { match: "command", keyword: "!赤" });
  const er = r.n("action.emit", 1, 0, { name: "赤" });
  const cb = r.n("event.chat", 0, 220, { match: "command", keyword: "!青" });
  const eb = r.n("action.emit", 1, 220, { name: "青" });
  b.go(cr, er);
  b.go(cb, eb);
  r.end();

  const pull = (name, sign, varName, color) => {
    const rr = b.row(`合図「${name}」：まだ勝負がついていなければ、旗を${sign < 0 ? "左" : "右"}へ1つ`, color);
    const sig = rr.n("event.signal", 0, 0, { name });
    const br = rr.n("flow.branch", 1, 0);
    const done = rr.n("var.get", 0, 280, { var: "done" });
    const eq = rr.n("cmp.eq", 1, 200, { b: 0 });
    const p = rr.n("var.add", 2, 0, { var: "pos", amount: sign });
    const c = rr.n("var.add", 3, 0, { var: varName, amount: 1 });
    const mv = rr.n("action.moveTo", 4, 0, { y: 150, seconds: 0.25 });
    const s = rr.n("action.playSound", 5, 0, { sound: blip.id, volume: 0.4 });
    const fx = rr.n("expr", 3, 200, { expr: "W / 2 + pos / goal * 460" });
    const flagRef = rr.n("get.object", 3, 300, { object: flag.id });
    b.go(sig, br);
    b.go([br, "true"], p, c, mv, s);
    b.wire(done, "value", eq, "a");
    b.wire(eq, "result", br, "cond");
    b.wire(fx, "result", mv, "x");
    b.wire(flagRef, "found", mv, "target");
    rr.end();
  };
  pull("赤", -1, "red", "#ff5c5c");
  pull("青", 1, "blue", "#5c9dff");

  const winRow = (expr, label, color, x) => {
    const rr = b.row(`${label}（旗が端まで来たら）`, color);
    const wh = rr.n("event.when", 0, 0);
    const cond = rr.n("expr", 0, 140, { expr });
    const d = rr.n("var.set", 1, 0, { var: "done", value: 1 });
    const t = rr.n("action.setText", 2, 0, { text: label });
    const v = rr.n("action.setVisible", 3, 0, { visible: true });
    const s = rr.n("action.playSound", 4, 0, { sound: fanfare.id });
    const e = rr.n("action.playEffect", 5, 0, { effect: fw.id, x, y: 120 });
    const f = rr.n("action.flash", 6, 0, { color, seconds: 0.5 });
    const dl = rr.n("flow.delay", 7, 0, { seconds: 5 });
    const rs = rr.n("action.restart", 8, 0);
    const winRef = rr.n("get.object", 2, 240, { object: win.id });
    b.go(wh, d, t, v, s, e, f, dl);
    b.go([dl, "completed"], rs);
    b.wire(cond, "result", wh, "cond");
    b.wire(winRef, "found", t, "target");
    b.wire(winRef, "found", v, "target");
    rr.end();
  };
  winRow("pos <= -goal", "🟥 赤チームの勝ち！", "#ff5c5c", 240);
  winRow("pos >= goal", "🟦 青チームの勝ち！", "#5c9dff", 960);
  return b.done();
}

// ===============================
// ✨ 演出パック（合図でキラキラ・花火・ハート）
// ===============================
function effectPack() {
  const g = createBlankGimmick("effect", "演出パック");
  g.description = "合図「花火」「キラキラ」「ハート」「紙吹雪」で画面いっぱいの演出。大きなギフトでも自動で花火";
  g.width = 1920;
  g.height = 1080;
  g.gravity = 0;
  const fw = effect("fireworks", { count: 160 });
  const sparkle = effect("sparkle", { count: 50, size: 26 });
  const hearts = effect("hearts", { count: 40, speed: 500 });
  const confetti = effect("confetti", { count: 160, speed: 1100 });
  const ring = effect("shockwave", { sizeEnd: 700 });
  g.effects.push(fw, sparkle, hearts, confetti, ring);
  const boom = sound("explosion", "ドーン");
  const magic = sound("magic");
  const fan = sound("fanfare");
  g.sounds.push(boom, magic, fan);

  const b = blueprint(g);
  // マクロ「花火を1発」：ランダムな場所に花火と音 → 「間隔」秒待ってから続き（マクロの中では「待つ」が使える）
  const shot = b.fn({
    kind: "macro", name: "花火を1発", desc: "ランダムな場所に花火を1発。「間隔」秒待ってから続きへ進みます。",
    inputs: [["実行", "exec"], ["間隔", "number"]], outputs: [["続き", "exec"]],
  });
  let r = shot.row("マクロ：入口 → 花火 → 音 → 待つ → 出口", "#ffc93c");
  const mi = r.n("macro.in", 0, 0);
  const me = r.n("action.playEffect", 1, 0, { effect: fw.id });
  const ms = r.n("action.playSound", 2, 0, { sound: boom.id, volume: 0.6 });
  const md = r.n("flow.delay", 3, 0);
  const mo = r.n("macro.out", 4, 0);
  const rx = r.n("expr", 0, 150, { expr: "random(W * 0.2, W * 0.8)" });
  const ry = r.n("expr", 1, 190, { expr: "random(H * 0.2, H * 0.5)" });
  shot.go([mi, "p1"], me, ms, md);
  shot.go([md, "completed"], [mo, null, "p3"]);
  shot.wire(rx, "result", me, "x");
  shot.wire(ry, "result", me, "y");
  shot.wire(mi, "p2", md, "seconds");
  r.end();

  r = b.row("合図「花火」：マクロ「花火を1発」を3回つなぐ（場所は読むたびに変わるランダム）", "#ffc93c");
  const sig = r.n("event.signal", 0, 0, { name: "花火" });
  const shots = [0.45, 0.45, 0].map((sec, i) => r.n("call.macro", 1 + i, 0, { fn: shot.f.id, p2: sec }));
  const rg = r.n("action.playEffect", 4, 0, { effect: ring.id, x: 960, y: 540 });
  b.go(sig, [shots[0], null, "p1"]);
  b.go([shots[0], "p3"], [shots[1], null, "p1"]);
  b.go([shots[1], "p3"], [shots[2], null, "p1"]);
  b.go([shots[2], "p3"], rg);
  r.end();

  r = b.row("合図「キラキラ」：3回くり返して、最後に音", "#4ec3ff");
  const sk = r.n("event.signal", 0, 0, { name: "キラキラ" });
  const loop = r.n("flow.forLoop", 1, 0, { first: 1, last: 3 });
  const ke = r.n("action.playEffect", 2, -20, { effect: sparkle.id });
  const ks = r.n("action.playSound", 2, 200, { sound: magic.id, volume: 0.6 });
  const kx = r.n("math.random", 1, 220, { min: 0, max: 1920 });
  const ky = r.n("math.random", 1, 340, { min: 0, max: 1080 });
  b.go(sk, loop);
  b.go([loop, "body"], ke);
  b.go([loop, "completed"], ks);
  b.wire(kx, "result", ke, "x");
  b.wire(ky, "result", ke, "y");
  r.end();

  r = b.row("合図「ハート」：順番に3か所から", "#ff5c8a");
  const sh = r.n("event.signal", 0, 0, { name: "ハート" });
  const seq = r.n("flow.sequence", 1, 0, { outs: 3 });
  b.go(sh, seq);
  [480, 960, 1440].forEach((x, i) => {
    const e = r.n("action.playEffect", 2, i * 170 - 60, { effect: hearts.id, x, y: 1020 });
    b.go([seq, `then${i}`], e);
  });
  r.end();

  r = b.row("合図「紙吹雪」：左右の下から", "#5cff9d");
  const sc = r.n("event.signal", 0, 0, { name: "紙吹雪" });
  const c1 = r.n("action.playEffect", 1, 0, { effect: confetti.id, x: 192, y: 1100 });
  const c2 = r.n("action.playEffect", 2, 0, { effect: confetti.id, x: 1728, y: 1100 });
  const cs = r.n("action.playSound", 3, 0, { sound: fan.id, volume: 0.7 });
  b.go(sc, c1, c2, cs);
  r.end();

  r = b.row("配信のイベントで自動：大きなギフト（100コイン〜）で花火（3秒あける）・フォローでハート", "#9b6bff");
  const gf = r.n("event.gift", 0, 0, { minCoins: 100 });
  const cd = r.n("flow.cooldown", 1, 0, { seconds: 3 });
  const eg = r.n("action.emit", 2, 0, { name: "花火" });
  const fo = r.n("event.follow", 0, 330);
  const ef = r.n("action.emit", 1, 330, { name: "ハート" });
  b.go(gf, cd, eg);
  b.go(fo, ef);
  r.end();
  return b.done();
}

// ===============================
// ✨ いいねで大爆発（ゲージが溜まると爆発）
// ===============================
function likeBomb() {
  const g = createBlankGimmick("effect", "いいねで大爆発");
  g.description = "いいねでゲージが溜まり、満タンで爆弾がドカン！ 目標はパラメーターで変えられる";
  g.width = 900;
  g.height = 500;
  g.gravity = 0;
  const bomb = obj({ name: "爆弾", tag: "bomb", x: 370, y: 120, w: 160, h: 160, look: { shape: "emoji", emoji: "💣" }, motion: { type: "pulse", speed: 1.2, amount: 6 } });
  const back = obj({ name: "ゲージの枠", x: 150, y: 330, w: 600, h: 40, look: { shape: "rect", fill: "#0b0b1acc", stroke: "#ffffff", strokeWidth: 3, radius: 20 } });
  const bar = obj({ name: "ゲージ", tag: "gauge", x: 155, y: 335, w: 1, h: 30, look: { shape: "rect", fill: "#ff5c8a", radius: 15, glow: 12, glowColor: "#ff5c8a" } });
  const label = obj({ name: "数", x: 150, y: 380, w: 600, h: 60, look: { shape: "text", text: "❤️ {likes} / {goal}", font: "M PLUS Rounded 1c", fontSize: 40, fontWeight: 900, textColor: "#ffffff", outline: 6, outlineColor: "#000000" } });
  g.objects.push(back, bar, bomb, label);
  const boomFx = effect("burst", { count: 140, speed: 900, size: 24 });
  const ring = effect("shockwave", { sizeEnd: 900 });
  const smoke = effect("smoke");
  g.effects.push(boomFx, ring, smoke);
  const boom = sound("explosion");
  const tick = sound("blip", "ピッ");
  g.sounds.push(boom, tick);
  g.variables.push({ name: "likes", value: 0, exposed: false, label: "" }, { name: "goal", value: 300, exposed: true, label: "爆発までのいいね" });

  const b = blueprint(g);
  let r = b.row("いいねの数だけゲージを伸ばす（幅 = いいね ÷ 目標 × 590）", "#ff5c8a");
  const lk = r.n("event.like", 0, 0, { every: 0 });
  const add = r.n("var.add", 1, 0, { var: "likes" });
  const sz = r.n("action.setSize", 2, 0);
  const gauge = r.n("get.object", 1, 200, { object: bar.id });
  const w = r.n("expr", 1, 290, { expr: "max(1, min(1, likes / goal) * 590)" });
  b.go(lk, add, sz);
  b.wire(lk, "count", add, "amount");
  b.wire(gauge, "found", sz, "target");
  b.wire(w, "result", sz, "w");
  r.end();

  r = b.row("合図「爆発」ですぐ満タンに", "#4ec3ff");
  const sig = r.n("event.signal", 0, 0, { name: "爆発" });
  const set = r.n("var.set", 1, 0, { var: "likes" });
  const goal = r.n("var.get", 0, 280, { var: "goal" });
  b.go(sig, set);
  b.wire(goal, "value", set, "value");
  r.end();

  r = b.row("満タンになったら爆発して、2秒後に元へ", "#ffb03c");
  const wh = r.n("event.when", 0, 0);
  const vl = r.n("var.get", 0, 120, { var: "likes" });
  const vg = r.n("var.get", 0, 200, { var: "goal" });
  const ge = r.n("cmp.gte", 1, 160);
  const bombRef = r.n("get.object", 1, 300, { object: bomb.id });
  const gaugeRef = r.n("get.object", 8, 300, { object: bar.id });
  const steps = [
    r.n("action.setEmoji", 1, 0, { emoji: "💥" }),
    r.n("action.setScale", 2, 0, { scale: 1.6 }),
    r.n("action.playEffectOn", 3, 0, { effect: boomFx.id }),
    r.n("action.playEffectOn", 4, 0, { effect: ring.id }),
    r.n("action.playEffectOn", 5, 0, { effect: smoke.id }),
    r.n("action.playSound", 6, 0, { sound: boom.id }),
    r.n("action.shake", 7, 0, { strength: 30, seconds: 0.8 }),
    r.n("action.flash", 8, 0, { color: "#fff2a8", seconds: 0.5 }),
  ];
  const dl = r.n("flow.delay", 9, 0, { seconds: 2 });
  const after = [
    r.n("var.set", 10, 0, { var: "likes", value: 0 }),
    r.n("action.setSize", 11, 0, { w: 1 }),
    r.n("action.setEmoji", 12, 0, { emoji: "💣" }),
    r.n("action.setScale", 13, 0, { scale: 1 }),
  ];
  b.go(wh, ...steps, dl);
  b.go([dl, "completed"], ...after);
  b.wire(vl, "value", ge, "a");
  b.wire(vg, "value", ge, "b");
  b.wire(ge, "result", wh, "cond");
  for (const n of [steps[0], steps[1], steps[2], steps[3], steps[4], after[2], after[3]]) b.wire(bombRef, "found", n, "target");
  b.wire(gaugeRef, "found", after[1], "target");
  r.end();

  r = b.row("あと少し（8割）になったら知らせる", "#5cff9d");
  const near = r.n("event.when", 0, 0);
  const cond = r.n("expr", 0, 140, { expr: "likes >= goal * 0.8 && likes < goal" });
  const ts = r.n("action.playSound", 1, 0, { sound: tick.id, volume: 0.5 });
  const pr = r.n("action.print", 2, 0, { text: "あと {goal - likes} いいね！" });
  b.go(near, ts, pr);
  b.wire(cond, "result", near, "cond");
  r.end();
  return b.done();
}

// ===============================
// 🔊 効果音パック
// ===============================
function soundPack() {
  const g = createBlankGimmick("sound", "効果音パック");
  g.description = "合図の名前で効果音を鳴らす（コイン・ジャンプ・爆発…）。鳴るたびに音符が浮かぶ";
  g.width = 300;
  g.height = 300;
  g.gravity = 0;
  const notes = effect("hearts", { emoji: "🎵 🎶", count: 6, speed: 180, gravity: -60, life: 1.4, size: 40, sizeEnd: 26 }, "音符");
  g.effects.push(notes);
  const speaker = obj({ name: "スピーカー", x: 100, y: 100, w: 100, h: 100, look: { shape: "emoji", emoji: "🔊" }, motion: { type: "float", speed: 0.5, amount: 6 } });
  g.objects.push(speaker);
  const keys = [["coin", "コイン"], ["jump", "ジャンプ"], ["explosion", "爆発"], ["laser", "レーザー"], ["powerup", "パワーアップ"], ["hit", "ヒット"], ["fanfare", "ファンファーレ"], ["lose", "ざんねん"], ["magic", "きらきら"], ["alarm", "警報"]];

  const b = blueprint(g);
  let r = b.row("音符を浮かべる（合図「音符」。ほかのイベントから呼ぶ）", "#9b6bff");
  const ns = r.n("event.signal", 0, 0, { name: "音符" });
  const ne = r.n("action.playEffect", 1, 0, { effect: notes.id, x: 150, y: 210 });
  b.go(ns, ne);
  r.end();

  r = b.row("合図の名前で鳴らす（アーティストモードのルールの「🎮 ギミックに合図」で選べる）", "#4ec3ff");
  keys.forEach(([key, name], i) => {
    const s = sound(key, name);
    g.sounds.push(s);
    const col = (i % 2) * 3;
    const dy = Math.floor(i / 2) * 260;
    const sig = r.n("event.signal", col, dy, { name });
    const ps = r.n("action.playSound", col + 1, dy, { sound: s.id });
    const em = r.n("action.emit", col + 2, dy, { name: "音符" });
    b.go(sig, ps, em);
  });
  r.end();

  r = b.row("配信のイベントでも鳴らす", "#ff5c8a");
  const gf = r.n("event.gift", 0, 0);
  const gs = r.n("action.playSound", 1, 0, { sound: g.sounds[0].id, volume: 0.8 });
  const ge = r.n("action.emit", 2, 0, { name: "音符" });
  const fo = r.n("event.follow", 0, 340);
  const fs = r.n("action.playSound", 1, 340, { sound: g.sounds[4].id, volume: 0.8 });
  b.go(gf, gs, ge);
  b.go(fo, fs);
  r.end();
  return b.done();
}

// ===============================
// 🧩 コメント投票
// ===============================
function vote() {
  const g = createBlankGimmick("other", "コメント投票");
  g.description = "コメント「1」「2」「3」で投票。棒グラフがその場で伸びる。合図「リセット」で0から";
  g.width = 900;
  g.height = 420;
  g.background = "#0b0b1acc";
  const title = obj({ name: "お題", x: 50, y: 20, w: 800, h: 70, look: { shape: "text", text: "{title}", font: "Dela Gothic One", fontSize: 44, fontWeight: 400, textColor: "#ffffff" } });
  g.objects.push(title);
  const colors = ["#ff5c8a", "#ffc93c", "#3ce0ff"];
  const bars = [];
  for (let i = 0; i < 3; i++) {
    const y = 120 + i * 95;
    g.objects.push(obj({ name: `選択肢 ${i + 1}`, x: 40, y, w: 220, h: 70, look: { shape: "text", text: `${i + 1}. {opt${i + 1}}`, font: "Noto Sans JP", fontSize: 30, textColor: "#ffffff" } }));
    const bar = obj({ name: `棒 ${i + 1}`, tag: `bar${i + 1}`, x: 280, y: y + 12, w: 4, h: 46, look: { shape: "rect", fill: colors[i], radius: 10, glow: 10, glowColor: colors[i] } });
    bars.push(bar);
    g.objects.push(bar);
    g.objects.push(obj({ name: `票 ${i + 1}`, x: 760, y, w: 110, h: 70, look: { shape: "text", text: `{v${i + 1}}票`, font: "Orbitron", fontSize: 30, textColor: "#ffffff" } }));
  }
  g.variables.push(
    { name: "title", value: "どれが好き？ コメントで番号！", exposed: true, label: "お題" },
    { name: "opt1", value: "たこ焼き", exposed: true, label: "選択肢 1" },
    { name: "opt2", value: "お好み焼き", exposed: true, label: "選択肢 2" },
    { name: "opt3", value: "もんじゃ", exposed: true, label: "選択肢 3" },
    { name: "v1", value: 0, exposed: false, label: "" },
    { name: "v2", value: 0, exposed: false, label: "" },
    { name: "v3", value: 0, exposed: false, label: "" },
  );
  const blip = sound("blip", "投票");
  g.sounds.push(blip);

  const b = blueprint(g);
  // ピュア関数「棒の幅」：票の数から、全体に対する割合の幅を計算する（実行ピンなし。計算ノードのように使える）
  const width = b.fn({
    name: "棒の幅", pure: true, desc: "票の数から、棒の幅（全体の票に対する割合 × 460px）を計算します。",
    inputs: [["票", "number"]], outputs: [["幅", "number"]],
  });
  let r = width.row("ピュア関数：入口の「票」から幅を計算して、出口へ（実行の線はいらない）", "#3fae5c");
  const we = r.n("fn.entry", 0, 0);
  const wx = r.n("expr", 1, 60, { expr: "max(4, a / max(1, v1 + v2 + v3) * 460)" });
  const wr = r.n("fn.return", 2, 0);
  width.wire(we, "p1", wx, "a");
  width.wire(wx, "result", wr, "p2");
  r.end();

  r = b.row("コメント「1」「2」「3」で票を足して、グラフを直す", "#ff5c8a");
  for (let i = 1; i <= 3; i++) {
    const dy = (i - 1) * 260;
    const ch = r.n("event.chat", 0, dy, { match: "exact", keyword: String(i) });
    const add = r.n("var.add", 1, dy, { var: `v${i}`, amount: 1 });
    const em = r.n("action.emit", 2, dy, { name: "グラフ" });
    const s = r.n("action.playSound", 3, dy, { sound: blip.id, volume: 0.3 });
    b.go(ch, add, em, s);
  }
  r.end();

  r = b.row("合図「グラフ」：票の割合で棒の幅を決める", "#4ec3ff");
  const sig = r.n("event.signal", 0, 0, { name: "グラフ" });
  const seq = r.n("flow.sequence", 1, 0, { outs: 3 });
  b.go(sig, seq);
  bars.forEach((bar, i) => {
    const dy = i * 260;
    const sz = r.n("action.setSize", 2, dy);
    const ref = r.n("get.object", 1, dy + 130, { object: bar.id });
    const votes = r.n("var.get", 0, dy + 200, { var: `v${i + 1}` });
    const w = r.n("call.function", 1, dy + 200, { fn: width.f.id });
    b.go([seq, `then${i}`], sz);
    b.wire(ref, "found", sz, "target");
    b.wire(votes, "value", w, "p1");
    b.wire(w, "p2", sz, "w");
  });
  r.end();

  r = b.row("合図「リセット」で0から", "#5cff9d");
  const rs = r.n("event.signal", 0, 0, { name: "リセット" });
  const re = r.n("action.restart", 1, 0);
  b.go(rs, re);
  r.end();
  return b.done();
}

// ===============================
// 🧩 白紙
// ===============================
function blank() {
  const g = createBlankGimmick("other");
  const b = blueprint(g);
  const r = b.row("ここから作ります（右クリックでノードを追加）", "#ffffff");
  const st = r.n("event.start", 0, 0);
  const pr = r.n("action.print", 1, 0, { text: "ゲームが始まりました" });
  b.go(st, pr);
  r.end();
  return b.done();
}

export const GIMMICK_TEMPLATES = [
  { id: "blank", kind: "other", name: "白紙", desc: "何も無いステージから作る", build: blank },
  { id: "breakout", kind: "game", name: "ギフトでブロック崩し", desc: "ギフトでボールが増える。物理・当たり判定・スコアの見本", build: breakout },
  { id: "giftrain", kind: "game", name: "ギフトの雨", desc: "ギフトの画像が降って積もる。目標コインで花火", build: giftRain },
  { id: "tug", kind: "game", name: "コメント綱引き", desc: "「!赤」「!青」で引っぱり合う対戦ゲーム", build: tugOfWar },
  { id: "effects", kind: "effect", name: "演出パック", desc: "合図で花火・キラキラ・ハート・紙吹雪", build: effectPack },
  { id: "likebomb", kind: "effect", name: "いいねで大爆発", desc: "いいねゲージが満タンで爆弾がドカン", build: likeBomb },
  { id: "sounds", kind: "sound", name: "効果音パック", desc: "コイン・ジャンプ・爆発…10種類の効果音", build: soundPack },
  { id: "vote", kind: "other", name: "コメント投票", desc: "コメントの番号で投票、棒グラフが伸びる", build: vote },
  // ジャンルごとのミニゲーム（ホームでは別の段に並ぶ）
  ...MINIGAME_TEMPLATES,
];
