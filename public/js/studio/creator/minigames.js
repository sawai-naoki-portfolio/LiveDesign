// public/js/studio/creator/minigames.js
// ジャンルごとのミニゲームのテンプレート（アクション・シューティング・運・レース・推理・RPG）。
// どれも配信の視聴者がコメント・いいね・ギフトで遊べて、勝負がつくと少し待って自動でもう一度始まる。
// 自作の関数・マクロの見本も兼ねる（ジャンプ・弾を撃つ・リールを止める・進める・範囲を表示 など）。
// 組み方は templates.js と同じ（templatekit.js の blueprint() で、まとまりごとにコメントで囲む）。
import { createBlankGimmick } from "../shared/gimmick/defaults.js";
import { sound, effect, obj, blueprint } from "./templatekit.js";

/** 文字のオブジェクト */
const label = (name, x, y, w, h, text, o = {}) => obj({
  name, x, y, w, h, hidden: !!o.hidden,
  look: {
    shape: "text", text, font: o.font || "Noto Sans JP", fontSize: o.size || 28, fontWeight: o.weight ?? 800,
    textColor: o.color || "#ffffff", outline: o.outline ?? 0, outlineColor: "#000000",
  },
});
const v = (name, value, label2 = "") => ({ name, value, exposed: !!label2, label: label2 });

// ===============================
// 🏃 アクション：障害物ジャンプ
// ===============================
function runner() {
  const g = createBlankGimmick("game", "障害物ジャンプ");
  g.description = "コメント「ジャンプ」かいいねで、みんなで跳んで障害物をよける。ギフトで3秒むてき";
  g.width = 960;
  g.height = 420;
  g.background = "#0b0b1add";
  g.gravity = 2600;
  const ground = obj({ name: "地面", tag: "ground", x: 0, y: 360, w: 960, h: 60, look: { shape: "rect", fill: "#1d1d2e", radius: 0 }, body: { type: "static" } });
  const edge = obj({ name: "地面の線", x: 0, y: 356, w: 960, h: 4, look: { shape: "rect", fill: "#5cff9d", radius: 0, glow: 10, glowColor: "#5cff9d" } });
  const player = obj({
    name: "プレイヤー", tag: "player", x: 130, y: 290, w: 70, h: 70, look: { shape: "emoji", emoji: "🐱" },
    body: { type: "dynamic", gravity: 1, bounce: 0, friction: 0, edges: "stop" },
  });
  const rock = obj({ name: "障害物", tag: "rock", prefab: true, w: 56, h: 64, look: { shape: "emoji", emoji: "🌵" }, body: { type: "none", edges: "destroy" } });
  const dist = label("距離", 20, 14, 320, 50, "{score} m", { font: "Orbitron", size: 34 });
  const best = label("ベスト", 620, 14, 320, 50, "BEST {best} m", { font: "Orbitron", size: 26, color: "#ffe66d" });
  const last = label("最後に跳んだ人", 230, 74, 500, 40, "{last}", { size: 22, color: "#ffffffcc", weight: 700 });
  const howto = label("遊び方", 130, 372, 700, 40, "💬「ジャンプ」・❤ いいね5件で跳ぶ　🎁 ギフトで3秒むてき", { size: 20, color: "#ffffffaa", weight: 700 });
  const over = label("ゲームオーバー", 180, 130, 600, 110, "GAME OVER", { font: "Dela Gothic One", size: 72, weight: 400, color: "#ff5c8a", outline: 8, hidden: true });
  // 背景：月と、ゆっくり流れる雲（端まで行くと反対側から）
  const moon = obj({ name: "月", x: 820, y: 60, w: 60, h: 60, opacity: 0.85, look: { shape: "emoji", emoji: "🌙" } });
  const clouds = [[180, 120, 90, -18], [560, 170, 70, -28], [900, 100, 80, -22]].map(([x, y, w, vx], i) => obj({
    name: `雲 ${i + 1}`, x, y, w, h: w * 0.6, opacity: 0.35, look: { shape: "emoji", emoji: "☁️" }, body: { type: "none", vx, edges: "wrap" },
  }));
  g.objects.push(moon, ...clouds, ground, edge, player, rock, dist, best, last, howto, over);
  const sJump = sound("jump");
  const sLose = sound("lose");
  const sPower = sound("powerup");
  const sHit = sound("hit");
  const smash = effect("burst", { count: 30, speed: 380, size: 10 }, "こわれる");
  g.sounds.push(sJump, sLose, sPower, sHit);
  g.effects.push(smash);
  g.variables.push(
    v("score", 0), v("best", 0), v("over", 0), v("landed", 0),
    v("last", "コメント「ジャンプ」で跳ぶ！"),
    v("speed", 380, "障害物の速さ"), v("jump", 1000, "ジャンプの強さ"),
  );

  const b = blueprint(g);
  // 関数「ジャンプ」：地面にいるときだけ跳ぶ。跳べたかどうかを返す（コメント・いいねの両方から呼ぶ）
  const jumpFn = b.fn({ name: "ジャンプ", desc: "地面にいて、ゲーム中なら上へ跳びます。跳べたら「跳んだ」が「はい」。", outputs: [["跳んだ", "bool"]] });
  let r = jumpFn.row("関数：地面にいて、ゲーム中なら上へはじく → 出口「跳んだ」（はい）。跳べなければ別の出口（いいえ）", "#9b6bff");
  const je = r.n("fn.entry", 0, 0);
  const jb = r.n("flow.branch", 1, 0);
  const jc = r.n("expr", 0, 130, { expr: "landed == 1 && over == 0" });
  const jng = r.n("fn.return", 1, 330, { p1: false });
  const jl = r.n("var.set", 2, 0, { var: "landed", value: 0 });
  const jv = r.n("action.setVelocity", 3, 0, { vx: 0 });
  const jp = r.n("get.object", 2, 190, { object: player.id });
  const jy = r.n("expr", 2, 340, { expr: "-jump" });
  const js = r.n("action.playSound", 4, 0, { sound: sJump.id, volume: 0.5 });
  const jok = r.n("fn.return", 5, 0, { p1: true });
  jumpFn.go(je, jb);
  jumpFn.go([jb, "true"], jl, jv, js, jok);
  jumpFn.go([jb, "false"], jng);
  jumpFn.wire(jc, "result", jb, "cond");
  jumpFn.wire(jp, "found", jv, "target");
  jumpFn.wire(jy, "result", jv, "vy");
  r.end();

  // 関数「やり直す」：ゲームオーバーのあと、障害物を片付けて 0 m から
  const resetFn = b.fn({ name: "やり直す", desc: "障害物を片付けて、距離を 0 m からもう一度始めます（ベストは残す）。" });
  r = resetFn.row("関数：障害物を片付ける → 距離 0 → 顔を戻す → 「GAME OVER」を隠す（ベストは残るので「最初からやり直す」ではなく自分で戻す）", "#9b6bff");
  const re = r.n("fn.entry", 0, 0);
  const rd = r.n("action.destroyTag", 1, 0, { tag: "rock" });
  const rs = r.n("var.set", 2, 0, { var: "score", value: 0 });
  const ro = r.n("var.set", 3, 0, { var: "over", value: 0 });
  const rf = r.n("action.setEmoji", 4, 0, { emoji: "🐱" });
  const rh = r.n("action.setVisible", 5, 0, { visible: false });
  const rr = r.n("fn.return", 6, 0);
  const rp = r.n("get.object", 3, 200, { object: player.id });
  const rv = r.n("get.object", 4, 200, { object: over.id });
  resetFn.go(re, rd, rs, ro, rf, rh, rr);
  resetFn.wire(rp, "found", rf, "target");
  resetFn.wire(rv, "found", rh, "target");
  r.end();

  r = b.row("コメント「ジャンプ」・いいね5件ごとに、自作の関数「ジャンプ」を呼ぶ。跳べたら名前を出す", "#4ec3ff");
  [["event.chat", { match: "contains", keyword: "ジャンプ" }], ["event.like", { every: 5 }]].forEach(([type, values], i) => {
    const dy = i * 340;
    const ev = r.n(type, 0, dy, values);
    const call = r.n("call.function", 1, dy, { fn: jumpFn.f.id });
    const br = r.n("flow.branch", 2, dy);
    const fmt = r.n("text.format", 2, dy + 140, { template: i ? "❤ {a} のいいねでジャンプ！" : "🐾 {a} のジャンプ！" });
    const set = r.n("var.set", 3, dy, { var: "last" });
    b.go(ev, call, br);
    b.go([br, "true"], set);
    b.wire(call, "p1", br, "cond");
    b.wire(ev, "user", fmt, "a");
    b.wire(fmt, "result", set, "value");
  });
  r.end();

  r = b.row("地面に着いたら、また跳べるようにする（むてき中の「hero」も）", "#5cff9d");
  const land = r.n("event.collide", 0, 0, { a: "player hero", b: "ground" });
  b.go(land, r.n("var.set", 1, 0, { var: "landed", value: 1 }));
  r.end();

  r = b.row("障害物を出す：1.4秒ごとに 70% で、右の外から走ってくる（距離がのびるほど速い）", "#ffc93c");
  const every = r.n("event.every", 0, 0, { seconds: 1.4 });
  const playing = r.n("expr", 0, 180, { expr: "over == 0" });
  const ob = r.n("flow.branch", 1, 0);
  const ch = r.n("flow.chance", 2, 0, { percent: 70 });
  const sp = r.n("action.spawn", 3, 0, { prefab: rock.id, at: "xy", y: 328 });
  const sx = r.n("expr", 2, 140, { expr: "W + 40" });
  const svx = r.n("expr", 2, 330, { expr: "-(speed + score * 0.5)" });
  const emo = r.n("action.setEmoji", 4, 0);
  const pick = r.n("expr", 4, 160, { expr: "pick(\"🌵\", \"🌵\", \"🪨\", \"🔥\")" });
  b.go(every, ob);
  b.go([ob, "true"], ch);
  b.go([ch, "yes"], sp, emo);
  b.wire(playing, "result", ob, "cond");
  b.wire(sx, "result", sp, "x");
  b.wire(svx, "result", sp, "vx");
  b.wire(sp, "spawned", emo, "target");
  b.wire(pick, "result", emo, "emoji");
  r.end();

  r = b.row("ゲーム中は 0.1 秒ごとに +1 m", "#4ec3ff");
  const tick = r.n("event.every", 0, 0, { seconds: 0.1 });
  const tb = r.n("flow.branch", 1, 0);
  const tc = r.n("expr", 0, 180, { expr: "over == 0" });
  b.go(tick, tb);
  b.go([tb, "true"], r.n("var.add", 2, 0, { var: "score", amount: 1 }));
  b.wire(tc, "result", tb, "cond");
  r.end();

  r = b.row("障害物にぶつかったらゲームオーバー → ベストを残して、3秒後に自作の関数「やり直す」", "#ff5c8a");
  const hit = r.n("event.collide", 0, 0, { a: "player", b: "rock" });
  const hc = r.n("expr", 0, 240, { expr: "over == 0" });
  const hb = r.n("flow.branch", 1, 0);
  const ho = r.n("var.set", 2, 0, { var: "over", value: 1 });
  const hbest = r.n("var.set", 3, 0, { var: "best" });
  const hmax = r.n("expr", 3, 180, { expr: "max(best, score)" });
  const hface = r.n("action.setEmoji", 4, 0, { emoji: "😵" });
  const hshow = r.n("action.setVisible", 5, 0, { visible: true });
  const hp = r.n("get.object", 4, 170, { object: player.id });
  const hv = r.n("get.object", 5, 170, { object: over.id });
  const hs = r.n("action.playSound", 6, 0, { sound: sLose.id });
  const hk = r.n("action.shake", 7, 0, { strength: 14, seconds: 0.4 });
  const hd = r.n("flow.delay", 8, 0, { seconds: 3 });
  const hr = r.n("call.function", 9, 0, { fn: resetFn.f.id });
  b.go(hit, hb);
  b.go([hb, "true"], ho, hbest, hface, hshow, hs, hk, hd);
  b.go([hd, "completed"], hr);
  b.wire(hc, "result", hb, "cond");
  b.wire(hmax, "result", hbest, "value");
  b.wire(hp, "found", hface, "target");
  b.wire(hv, "found", hshow, "target");
  r.end();

  r = b.row("ギフトで3秒むてき（タグを「hero」にすると障害物に当たらない。むてき中は障害物を壊して +20 m）", "#9b6bff");
  const gift = r.n("event.gift", 0, 0);
  const gc = r.n("expr", 0, 340, { expr: "over == 0" });
  const gb = r.n("flow.branch", 1, 0);
  const gt = r.n("action.setTag", 2, 0, { tag: "hero" });
  const gf = r.n("action.setEmoji", 3, 0, { emoji: "🦸" });
  const gs = r.n("action.playSound", 4, 0, { sound: sPower.id, volume: 0.6 });
  const gl = r.n("var.set", 5, 0, { var: "last" });
  const gfmt = r.n("text.format", 5, 170, { template: "🦸 {a} のギフトで むてき！" });
  const gd = r.n("flow.delay", 6, 0, { seconds: 3 });
  const gt2 = r.n("action.setTag", 7, 0, { tag: "player" });
  const gf2 = r.n("action.setEmoji", 8, 0, { emoji: "🐱" });
  const gp = r.n("get.object", 1, 170, { object: player.id });
  b.go(gift, gb);
  b.go([gb, "true"], gt, gf, gs, gl, gd);
  b.go([gd, "completed"], gt2, gf2);
  b.wire(gc, "result", gb, "cond");
  b.wire(gift, "user", gfmt, "a");
  b.wire(gfmt, "result", gl, "value");
  for (const n of [gt, gf, gt2, gf2]) b.wire(gp, "found", n, "target");
  const smashHit = r.n("event.collide", 0, 520, { a: "hero", b: "rock" });
  const sd = r.n("action.destroy", 1, 520, { effect: smash.id });
  const sa = r.n("var.add", 2, 520, { var: "score", amount: 20 });
  const ss = r.n("action.playSound", 3, 520, { sound: sHit.id, volume: 0.5 });
  b.go(smashHit, sd, sa, ss);
  b.wire(smashHit, "other", sd, "target");
  r.end();
  return b.done();
}

// ===============================
// 🚀 シューティング：コメント迎撃
// ===============================
function shooter() {
  const g = createBlankGimmick("game", "コメント迎撃");
  g.description = "コメントするたびにロケットが弾を撃つ。落ちてくる敵を撃ち落とそう。ギフトで5方向に連射";
  g.width = 720;
  g.height = 960;
  g.background = "#05051add";
  g.gravity = 0;
  const cannon = obj({
    name: "ロケット", tag: "cannon", x: 320, y: 810, w: 80, h: 80, rotation: -45, look: { shape: "emoji", emoji: "🚀" },
    body: { type: "none", vx: 220, bounce: 1, edges: "bounce" },
  });
  const bullet = obj({
    name: "弾", tag: "bullet", prefab: true, w: 12, h: 30, life: 2,
    look: { shape: "ellipse", fill: "#5cf2ff", glow: 14, glowColor: "#5cf2ff" }, body: { type: "none", edges: "destroy" },
  });
  const enemy = obj({ name: "敵", tag: "enemy", prefab: true, w: 64, h: 64, look: { shape: "emoji", emoji: "👾" }, motion: { type: "swing", speed: 1.5, amount: 12 }, body: { type: "none" } });
  const pop = obj({
    name: "得点", tag: "pop", prefab: true, w: 260, h: 40, life: 0.9,
    look: { shape: "text", text: "+10 {user}", fontSize: 24, fontWeight: 800, textColor: "#ffe66d", outline: 4, outlineColor: "#000000" },
    body: { type: "none", vy: -90 },
  });
  const line = obj({ name: "防衛ライン", x: 0, y: 930, w: 720, h: 6, look: { shape: "rect", fill: "#ff5c5c", radius: 0, glow: 12, glowColor: "#ff5c5c" } });
  const score = label("スコア", 20, 14, 340, 50, "SCORE {score}", { font: "Orbitron", size: 32 });
  const best = label("ハイスコア", 380, 14, 320, 50, "HI {best}", { font: "Orbitron", size: 26, color: "#ffe66d" });
  const life = label("ライフ", 20, 64, 200, 44, "❤️ ×{life}", { size: 28 });
  const howto = label("遊び方", 40, 112, 640, 36, "💬 コメントで発射　❤ いいね10件で1発　🎁 ギフトで5方向", { size: 20, color: "#ffffffaa", weight: 700 });
  const over = label("ゲームオーバー", 60, 400, 600, 120, "GAME OVER", { font: "Dela Gothic One", size: 76, weight: 400, color: "#ff5c8a", outline: 8, hidden: true });
  // 背景：またたく星と惑星
  const stars = [[60, 220], [180, 420], [300, 160], [460, 330], [620, 210], [90, 610], [250, 720], [520, 560], [660, 680], [380, 820]]
    .map(([x, y], i) => obj({ name: `星 ${i + 1}`, x, y, w: 10 + (i % 3) * 4, h: 10 + (i % 3) * 4, opacity: 0.7, look: { shape: "star", fill: "#ffffff", glow: 6, glowColor: "#a8f0ff" }, motion: { type: "blink", speed: 0.6 + (i % 4) * 0.25, amount: 10 } }));
  const planet = obj({ name: "惑星", x: 540, y: 420, w: 120, h: 120, opacity: 0.55, look: { shape: "emoji", emoji: "🪐" }, motion: { type: "float", speed: 0.4, amount: 8 } });
  g.objects.push(...stars, planet, line, cannon, bullet, enemy, pop, score, best, life, howto, over);
  const sLaser = sound("laser", "発射");
  const sHit = sound("hit");
  const sPower = sound("powerup");
  const sLose = sound("lose");
  const sAlarm = sound("explosion", "やられた");
  const boom = effect("burst", { count: 36, speed: 420, size: 12 }, "撃ち落とす");
  g.sounds.push(sLaser, sHit, sPower, sLose, sAlarm);
  g.effects.push(boom);
  g.variables.push(v("score", 0), v("best", 0), v("over", 0), v("life", 3), v("maxLife", 3, "ライフ"), v("enemySpeed", 90, "敵の速さ"));

  const b = blueprint(g);
  // 関数「弾を撃つ」：ロケットの先から上へ撃つ。横の速さを変えると斜めに飛ぶ（ギフトの5方向に使う）
  const shoot = b.fn({
    name: "弾を撃つ", desc: "ロケットの先から上へ弾を撃ちます。「横の速さ」で斜めにも。撃った弾を返します。",
    inputs: [["横の速さ", "number"]], outputs: [["弾", "entity"]],
  });
  let r = shoot.row("関数：ゲーム中なら、ロケットの位置に弾を出して上へ（撃った人の名前は弾が覚えている）", "#9b6bff");
  const se = r.n("fn.entry", 0, 0);
  const sc = r.n("expr", 0, 140, { expr: "over == 0" });
  const sb = r.n("flow.branch", 1, 0);
  const sng = r.n("fn.return", 1, 150);
  const sp = r.n("action.spawn", 2, 0, { prefab: bullet.id, at: "xy", vy: -760 });
  const ss = r.n("action.playSound", 3, 0, { sound: sLaser.id, volume: 0.25 });
  const sok = r.n("fn.return", 4, 0);
  const sref = r.n("get.object", 0, 340, { object: cannon.id });
  const sinfo = r.n("get.entity", 1, 300);
  const sy = r.n("math.sub", 2, 380, { b: 40 });
  shoot.go(se, sb);
  shoot.go([sb, "true"], sp, ss, sok);
  shoot.go([sb, "false"], sng);
  shoot.wire(sc, "result", sb, "cond");
  shoot.wire(sref, "found", sinfo, "target");
  shoot.wire(sinfo, "x", sp, "x");
  shoot.wire(sinfo, "y", sy, "a");
  shoot.wire(sy, "result", sp, "y");
  shoot.wire(se, "p1", sp, "vx");
  shoot.wire(sp, "spawned", sok, "p2");
  r.end();

  // 関数「やり直す」
  const resetFn = b.fn({ name: "やり直す", desc: "敵と弾を片付けて、スコア 0・ライフ満タンからもう一度（ハイスコアは残す）。" });
  r = resetFn.row("関数：敵と弾を片付ける → スコア 0 → ライフを満タン → 「GAME OVER」を隠す", "#9b6bff");
  const re = r.n("fn.entry", 0, 0);
  const rd1 = r.n("action.destroyTag", 1, 0, { tag: "enemy" });
  const rd2 = r.n("action.destroyTag", 2, 0, { tag: "bullet" });
  const rs = r.n("var.set", 3, 0, { var: "score", value: 0 });
  const rl = r.n("var.set", 4, 0, { var: "life" });
  const rmax = r.n("var.get", 4, 180, { var: "maxLife" });
  const ro = r.n("var.set", 5, 0, { var: "over", value: 0 });
  const rh = r.n("action.setVisible", 6, 0, { visible: false });
  const rv = r.n("get.object", 6, 170, { object: over.id });
  const rr = r.n("fn.return", 7, 0);
  resetFn.go(re, rd1, rd2, rs, rl, ro, rh, rr);
  resetFn.wire(rmax, "value", rl, "value");
  resetFn.wire(rv, "found", rh, "target");
  r.end();

  r = b.row("コメントするたびに、自作の関数「弾を撃つ」で1発（いいね10件ごとにも1発）", "#4ec3ff");
  const chat = r.n("event.chat", 0, 0);
  b.go(chat, r.n("call.function", 1, 0, { fn: shoot.f.id, p1: 0 }));
  const like = r.n("event.like", 0, 290, { every: 10 });
  b.go(like, r.n("call.function", 1, 290, { fn: shoot.f.id, p1: 0 }));
  r.end();

  r = b.row("ギフトで5方向に連射（同じ関数を、横の速さを変えて5回呼ぶ）", "#ffc93c");
  const gift = r.n("event.gift", 0, 0);
  const loop = r.n("flow.forLoop", 1, 0, { first: -2, last: 2 });
  const spread = r.n("math.mul", 1, 170, { b: 170 });
  const gcall = r.n("call.function", 2, 0, { fn: shoot.f.id });
  const gsnd = r.n("action.playSound", 2, 200, { sound: sPower.id, volume: 0.5 });
  b.go(gift, loop);
  b.go([loop, "body"], gcall);
  b.go([loop, "completed"], gsnd);
  b.wire(loop, "index", spread, "a");
  b.wire(spread, "result", gcall, "p1");
  r.end();

  r = b.row("敵を出す：1秒ごとに上から（点が増えるほど多く・速く）。出てきた敵の見た目はランダム", "#ff5c8a");
  const every = r.n("event.every", 0, 0, { seconds: 1 });
  const ec = r.n("expr", 0, 180, { expr: "over == 0" });
  const eb = r.n("flow.branch", 1, 0);
  const es = r.n("action.spawn", 2, 0, { prefab: enemy.id, at: "randomTop" });
  const en = r.n("expr", 1, 160, { expr: "min(3, 1 + floor(score / 300))" });
  const ev = r.n("expr", 1, 350, { expr: "enemySpeed + min(160, score / 8)" });
  b.go(every, eb);
  b.go([eb, "true"], es);
  b.wire(ec, "result", eb, "cond");
  b.wire(en, "result", es, "count");
  b.wire(ev, "result", es, "vy");
  const born = r.n("event.spawned", 3, 0, { object: enemy.id });
  const look = r.n("action.setEmoji", 4, 0);
  const lp = r.n("expr", 4, 160, { expr: "pick(\"👾\", \"👽\", \"🛸\", \"👻\")" });
  b.go(born, look);
  b.wire(lp, "result", look, "emoji");
  r.end();

  r = b.row("弾が敵に当たったら +10点。撃った人の名前が「+10 名前」で浮かぶ（出したものは出したときの人を覚えている）", "#5cff9d");
  const hit = r.n("event.collide", 0, 0, { a: "bullet", b: "enemy" });
  const hinfo = r.n("get.entity", 0, 250);
  const hpop = r.n("action.spawn", 1, 0, { prefab: pop.id, at: "xy" });
  const hd1 = r.n("action.destroy", 2, 0, { effect: boom.id });
  const hd2 = r.n("action.destroy", 3, 0);
  const ha = r.n("var.add", 4, 0, { var: "score", amount: 10 });
  const hs = r.n("action.playSound", 5, 0, { sound: sHit.id, volume: 0.4 });
  b.go(hit, hpop, hd1, hd2, ha, hs);
  b.wire(hit, "other", hinfo, "target");
  b.wire(hinfo, "x", hpop, "x");
  b.wire(hinfo, "y", hpop, "y");
  b.wire(hit, "other", hd1, "target");
  r.end();

  r = b.row("敵が下の線まで来たら、ライフ -1（画面が赤く光って揺れる）", "#ff5c5c");
  const down = r.n("event.edge", 0, 0, { tag: "enemy", side: "bottom" });
  const dd = r.n("action.destroy", 1, 0, { effect: boom.id });
  const dl = r.n("var.add", 2, 0, { var: "life", amount: -1 });
  const df = r.n("action.flash", 3, 0, { color: "#ff3c3c", seconds: 0.3 });
  const dk = r.n("action.shake", 4, 0, { strength: 12, seconds: 0.3 });
  const ds = r.n("action.playSound", 5, 0, { sound: sAlarm.id, volume: 0.4 });
  b.go(down, dd, dl, df, dk, ds);
  r.end();

  r = b.row("ライフが 0 になったらゲームオーバー → ハイスコアを残して、4秒後に自作の関数「やり直す」", "#ff5c8a");
  const when = r.n("event.when", 0, 0);
  const wc = r.n("expr", 0, 120, { expr: "life <= 0 && over == 0" });
  const wo = r.n("var.set", 1, 0, { var: "over", value: 1 });
  const wb = r.n("var.set", 2, 0, { var: "best" });
  const wmax = r.n("expr", 2, 180, { expr: "max(best, score)" });
  const wd = r.n("action.destroyTag", 3, 0, { tag: "enemy", effect: boom.id });
  const wv = r.n("action.setVisible", 4, 0, { visible: true });
  const wref = r.n("get.object", 4, 170, { object: over.id });
  const ws = r.n("action.playSound", 5, 0, { sound: sLose.id });
  const wdl = r.n("flow.delay", 6, 0, { seconds: 4 });
  const wr = r.n("call.function", 7, 0, { fn: resetFn.f.id });
  b.go(when, wo, wb, wd, wv, ws, wdl);
  b.go([wdl, "completed"], wr);
  b.wire(wc, "result", when, "cond");
  b.wire(wmax, "result", wb, "value");
  b.wire(wref, "found", wv, "target");
  r.end();
  return b.done();
}

// ===============================
// 🎰 運：ギフトスロット
// ===============================
const SYMBOLS = "\"🍒\", \"🍋\", \"🔔\", \"⭐\", \"💎\"";

function slot() {
  const g = createBlankGimmick("game", "ギフトスロット");
  g.description = "ギフトでスロットが回る。3つそろえば JACKPOT！ 大きいギフトほどそろいやすい。「!スロット」でも1回";
  g.width = 900;
  g.height = 560;
  g.background = "#14061fdd";
  g.gravity = 0;
  const title = label("タイトル", 150, 18, 600, 70, "🎰 ギフトスロット", { font: "Dela Gothic One", size: 52, weight: 400, color: "#ffe66d", outline: 6 });
  const frame = obj({ name: "台", x: 90, y: 110, w: 720, h: 270, look: { shape: "rect", fill: "#2b1340", radius: 28, stroke: "#ffc93c", strokeWidth: 6, glow: 18, glowColor: "#ffc93c" } });
  const windows = [0, 1, 2].map((i) => obj({ name: `窓 ${i + 1}`, x: 130 + i * 230, y: 145, w: 180, h: 200, look: { shape: "rect", fill: "#fff8e8", radius: 18 } }));
  const reels = ["🍒", "🔔", "💎"].map((emoji, i) => obj({ name: `リール ${i + 1}`, tag: "reel", x: 150 + i * 230, y: 160, w: 140, h: 170, look: { shape: "emoji", emoji } }));
  const lamps = [40, 830].map((x, i) => obj({ name: `ランプ ${i + 1}`, x, y: 220, w: 34, h: 34, look: { shape: "star", fill: "#ffd84d", glow: 12, glowColor: "#ffd84d" }, motion: { type: "blink", speed: 1.4, amount: 10 } }));
  const msg = label("メッセージ", 60, 395, 780, 60, "🎁 ギフトでスロットが回る！", { size: 30 });
  const stats = label("記録", 60, 462, 780, 36, "JACKPOT {jackpots} 回　｜　順番待ち {queue} 回", { size: 20, color: "#ffffffaa", weight: 700 });
  const howto = label("遊び方", 60, 508, 780, 36, "🎁 ギフトで回る（大きいギフトほどそろいやすい）　💬「!スロット」でも1回", { size: 18, color: "#ffffff88", weight: 700 });
  g.objects.push(title, frame, ...windows, ...reels, ...lamps, msg, stats, howto);
  const sStart = sound("magic", "回る");
  const sStop = sound("blip", "止まる");
  const sWin = sound("coin", "あたり");
  const sJackpot = sound("fanfare");
  const sLose = sound("lose");
  const fw = effect("fireworks");
  const coins = effect("coins");
  const sparkle = effect("sparkle", { count: 40 });
  g.sounds.push(sStart, sStop, sWin, sJackpot, sLose);
  g.effects.push(fw, coins, sparkle);
  g.variables.push(
    v("spinning", 0), v("spin1", 0), v("spin2", 0), v("spin3", 0),
    v("s1", "🍒"), v("s2", "🔔"), v("s3", "💎"),
    v("who", ""), v("nextWho", ""), v("queue", 0), v("jackpots", 0),
    v("luck", 15, "そろいやすさ（%）"),
  );

  const b = blueprint(g);
  // 関数「リールを回す」：回っている間だけ、絵柄をランダムに変える
  const spinFn = b.fn({ name: "リールを回す", desc: "「回す」が「はい」なら、リールの絵柄をランダムに変えます。", inputs: [["リール", "entity"], ["回す", "bool"]] });
  let r = spinFn.row("関数：「回す」が「はい」のときだけ、絵柄をランダムに", "#9b6bff");
  const fe = r.n("fn.entry", 0, 0);
  const fb = r.n("flow.branch", 1, 0);
  const fset = r.n("action.setEmoji", 2, 0);
  const fpick = r.n("expr", 1, 150, { expr: `pick(${SYMBOLS})` });
  const fok = r.n("fn.return", 3, 0);
  const fng = r.n("fn.return", 2, 180);
  spinFn.go(fe, fb);
  spinFn.go([fb, "true"], fset, fok);
  spinFn.go([fb, "false"], fng);
  spinFn.wire(fe, "p2", fb, "cond");
  spinFn.wire(fe, "p1", fset, "target");
  spinFn.wire(fpick, "result", fset, "emoji");
  r.end();

  // マクロ「リールを止める」：絵柄を決めて、ポンと大きくしてから少し待つ（マクロなので中で「待つ」が使える）
  const stopMacro = b.fn({
    kind: "macro", name: "リールを止める", desc: "リールを「絵柄」で止めて、ポンと弾ませてから続きへ進みます。",
    inputs: [["実行", "exec"], ["リール", "entity"], ["絵柄", "string"]], outputs: [["続き", "exec"]],
  });
  r = stopMacro.row("マクロ：絵柄を決める → 少し大きく → 音 → 0.45秒待つ → 元の大きさ → 続き", "#c8c8d8");
  const mi = r.n("macro.in", 0, 0);
  const mset = r.n("action.setEmoji", 1, 0);
  const mbig = r.n("action.setScale", 2, 0, { scale: 1.18 });
  const msnd = r.n("action.playSound", 3, 0, { sound: sStop.id, volume: 0.5 });
  const mdl = r.n("flow.delay", 4, 0, { seconds: 0.45 });
  const mback = r.n("action.setScale", 5, 0, { scale: 1 });
  const mo = r.n("macro.out", 6, 0);
  stopMacro.go([mi, "p1"], mset, mbig, msnd, mdl);
  stopMacro.go([mdl, "completed"], mback, [mo, null, "p4"]);
  for (const n of [mset, mbig, mback]) stopMacro.wire(mi, "p2", n, "target");
  stopMacro.wire(mi, "p3", mset, "emoji");
  r.end();

  // ピュア関数「役」：3つの絵柄から、そろった数を計算する（3 ＝ JACKPOT・1 ＝ 2つそろい・0 ＝ はずれ）
  const handFn = b.fn({
    name: "役", pure: true, desc: "3つの絵柄を比べて、3つそろい（3）・2つそろい（1）・はずれ（0）を返します。",
    inputs: [["左", "string"], ["真ん中", "string"], ["右", "string"]], outputs: [["役", "number"]],
  });
  r = handFn.row("ピュア関数：入口の3つの絵柄 → 式で比べる → 出口「役」（実行の線はいらない）", "#3fae5c");
  const he = r.n("fn.entry", 0, 0);
  const hx = r.n("expr", 1, 0, { expr: "a == b && b == c ? 3 : (a == b || b == c || a == c ? 1 : 0)" });
  const hr = r.n("fn.return", 2, 0);
  handFn.wire(he, "p1", hx, "a");
  handFn.wire(he, "p2", hx, "b");
  handFn.wire(he, "p3", hx, "c");
  handFn.wire(hx, "result", hr, "p4");
  r.end();

  r = b.row("ギフト：回っていなければ回す（2個以上なら残りは順番待ち）。回っている間のギフトも順番待ちに", "#ff5c8a");
  const gift = r.n("event.gift", 0, 0);
  const gc = r.n("expr", 0, 340, { expr: "spinning == 0" });
  const gb = r.n("flow.branch", 1, 0);
  const gw = r.n("var.set", 2, 0, { var: "who" });
  const gn = r.n("var.set", 3, 0, { var: "nextWho" });
  const gq = r.n("var.add", 4, 0, { var: "queue" });
  const gqn = r.n("expr", 4, 180, { expr: "min(9, count - 1)" });
  const gem = r.n("action.emit", 5, 0, { name: "回す" });
  const gq2 = r.n("var.add", 2, 380, { var: "queue" });
  const gqn2 = r.n("expr", 2, 560, { expr: "min(10, count)" });
  const gn2 = r.n("var.set", 3, 380, { var: "nextWho" });
  b.go(gift, gb);
  b.go([gb, "true"], gw, gn, gq, gem);
  b.go([gb, "false"], gq2, gn2);
  b.wire(gc, "result", gb, "cond");
  for (const n of [gw, gn, gn2]) b.wire(gift, "user", n, "value");
  b.wire(gqn, "result", gq, "amount");
  b.wire(gqn2, "result", gq2, "amount");
  r.end();

  r = b.row("コメント「!スロット」でも1回（回っていないときだけ）", "#4ec3ff");
  const cmd = r.n("event.chat", 0, 0, { match: "command", keyword: "!スロット" });
  const cc = r.n("expr", 0, 290, { expr: "spinning == 0" });
  const cb = r.n("flow.branch", 1, 0);
  const cw = r.n("var.set", 2, 0, { var: "who" });
  const cem = r.n("action.emit", 3, 0, { name: "回す" });
  b.go(cmd, cb);
  b.go([cb, "true"], cw, cem);
  b.wire(cc, "result", cb, "cond");
  b.wire(cmd, "user", cw, "value");
  r.end();

  r = b.row("回っている間（0.08秒ごと）、3つのリールで自作の関数「リールを回す」を呼ぶ", "#9b6bff");
  const every = r.n("event.every", 0, 0, { seconds: 0.08 });
  const seq = r.n("flow.sequence", 1, 0, { outs: 3 });
  b.go(every, seq);
  reels.forEach((reel, i) => {
    const call = r.n("call.function", 2, i * 170, { fn: spinFn.f.id });
    const ref = r.n("get.object", 1, 210 + i * 140, { object: reel.id });
    const flag = r.n("var.get", 0, 200 + i * 140, { var: `spin${i + 1}` });
    b.go([seq, `then${i}`], call);
    b.wire(ref, "found", call, "p1");
    b.wire(flag, "value", call, "p2");
  });
  r.end();

  // マクロ「3つ止める」：左から1つずつ、マクロ「リールを止める」で止める（マクロの中でマクロを呼ぶ）
  const stopAll = b.fn({
    kind: "macro", name: "3つ止める", desc: "左のリールから順に、絵柄を決めて止めます。右のリールは大きいギフトほど、2つそろったときに同じ絵柄になりやすい。",
    inputs: [["実行", "exec"]], outputs: [["続き", "exec"]],
  });
  r = stopAll.row("マクロ：絵柄を決める → 回すのをやめる → マクロ「リールを止める」 を3回。右は「そろいやすさ」＋ギフトのコインで、左2つと同じになりやすい", "#c8c8d8");
  const ai = r.n("macro.in", 0, 0);
  const chain = [[ai, "p1"]];
  reels.forEach((reel, i) => {
    const col = 1 + i * 3;
    const set = r.n("var.set", col, 0, { var: `s${i + 1}` });
    const pick = r.n("expr", col, 170, {
      expr: i < 2 ? `pick(${SYMBOLS})` : `s1 == s2 && chance(luck + min(50, coins / 2)) ? s1 : pick(${SYMBOLS})`,
    });
    const off = r.n("var.set", col + 1, 0, { var: `spin${i + 1}`, value: 0 });
    const call = r.n("call.macro", col + 2, 0, { fn: stopMacro.f.id });
    const ref = r.n("get.object", col + 1, 170, { object: reel.id });
    stopAll.wire(pick, "result", set, "value");
    stopAll.wire(ref, "found", call, "p2");
    stopAll.wire(set, "value", call, "p3");
    stopAll.go(chain[chain.length - 1], set, off, [call, null, "p1"]);
    chain.push([call, "p4"]);
  });
  const ao = r.n("macro.out", 10, 0);
  stopAll.go(chain[chain.length - 1], [ao, null, "p2"]);
  r.end();

  // マクロ「当たりを発表」：ピュア関数「役」で調べて JACKPOT・あたり・はずれ。どの道も少し待って同じ出口へ
  const announce = b.fn({
    kind: "macro", name: "当たりを発表", desc: "そろった数を調べて、JACKPOT・あたり・はずれを発表します。少し待ってから続きへ。",
    inputs: [["実行", "exec"]], outputs: [["続き", "exec"]],
  });
  r = announce.row("マクロ：自作のピュア関数「役」でそろった数を調べる → JACKPOT（3）・あたり（1）・はずれ（0）。3つの道は、待ってから同じ出口に着く", "#c8c8d8");
  const ji = r.n("macro.in", 0, 0);
  const syms = [1, 2, 3].map((i) => r.n("var.get", 0, 140 + (i - 1) * 140, { var: `s${i}` }));
  const hand = r.n("call.function", 1, 460, { fn: handFn.f.id });
  const is3 = r.n("cmp.eq", 1, 140, { b: 3 });
  const is1 = r.n("cmp.eq", 1, 300, { b: 1 });
  const j3 = r.n("flow.branch", 1, 0);
  const j1 = r.n("flow.branch", 2, 260);
  syms.forEach((n, i) => announce.wire(n, "value", hand, `p${i + 1}`));
  announce.wire(hand, "p4", is3, "a");
  announce.wire(hand, "p4", is1, "a");
  announce.wire(is3, "result", j3, "cond");
  announce.wire(is1, "result", j1, "cond");
  const mref = r.n("get.object", 2, 390, { object: msg.id });
  const jo = r.n("macro.out", 11, 260);
  // JACKPOT
  const ja = r.n("var.add", 2, 0, { var: "jackpots", amount: 1 });
  const jt = r.n("action.setText", 3, 0, { text: "🎉 JACKPOT!! {who} さん おめでとう！" });
  const js = r.n("action.playSound", 4, 0, { sound: sJackpot.id });
  const jc = r.n("action.playEffect", 5, 0, { effect: coins.id, x: 450, y: 330 });
  const jf1 = r.n("action.playEffect", 6, 0, { effect: fw.id, x: 230, y: 140 });
  const jf2 = r.n("action.playEffect", 7, 0, { effect: fw.id, x: 670, y: 140 });
  const jfl = r.n("action.flash", 8, 0, { color: "#ffe66d", seconds: 0.5 });
  const jk = r.n("action.shake", 9, 0, { strength: 10, seconds: 0.5 });
  const jd = r.n("flow.delay", 10, 0, { seconds: 3 });
  announce.go([ji, "p1"], j3);
  announce.go([j3, "true"], ja, jt, js, jc, jf1, jf2, jfl, jk, jd);
  announce.go([jd, "completed"], [jo, null, "p2"]);
  announce.go([j3, "false"], j1);
  // あたり（2つそろい）
  const wt = r.n("action.setText", 3, 260, { text: "✨ あたり！ {who} さん" });
  const ws = r.n("action.playSound", 4, 260, { sound: sWin.id, volume: 0.6 });
  const wfx = r.n("action.playEffect", 5, 260, { effect: sparkle.id, x: 450, y: 250 });
  const wd = r.n("flow.delay", 6, 260, { seconds: 1.5 });
  announce.go([j1, "true"], wt, ws, wfx, wd);
  announce.go([wd, "completed"], [jo, null, "p2"]);
  // はずれ
  const lt = r.n("action.setText", 3, 470, { text: "😢 ざんねん… {who} さん" });
  const ls = r.n("action.playSound", 4, 470, { sound: sLose.id, volume: 0.5 });
  const ld = r.n("flow.delay", 5, 470, { seconds: 1.5 });
  announce.go([j1, "false"], lt, ls, ld);
  announce.go([ld, "completed"], [jo, null, "p2"]);
  for (const n of [jt, wt, lt]) announce.wire(mref, "found", n, "target");
  r.end();

  r = b.row("合図「回す」：3つとも回し始めて 1.2秒 → マクロ「3つ止める」→ マクロ「当たりを発表」→ 順番待ちがあれば、次の人の分を続けて回す", "#ffc93c");
  const sig = r.n("event.signal", 0, 0, { name: "回す" });
  const sc = r.n("expr", 0, 320, { expr: "spinning == 0" });
  const sb = r.n("flow.branch", 1, 0);
  const s0 = r.n("var.set", 2, 0, { var: "spinning", value: 1 });
  const sflags = [1, 2, 3].map((i) => r.n("var.set", 2 + i, 0, { var: `spin${i}`, value: 1 }));
  const smsg = r.n("action.setText", 6, 0, { text: "🎰 {who} さんのスロット！" });
  const sref = r.n("get.object", 5, 190, { object: msg.id });
  const ssnd = r.n("action.playSound", 7, 0, { sound: sStart.id, volume: 0.5 });
  const sdl = r.n("flow.delay", 8, 0, { seconds: 1.2 });
  const m3 = r.n("call.macro", 9, 0, { fn: stopAll.f.id });
  const mj = r.n("call.macro", 10, 0, { fn: announce.f.id });
  const e0 = r.n("var.set", 9, 330, { var: "spinning", value: 0 });
  const eb = r.n("flow.branch", 10, 330);
  const ec = r.n("expr", 9, 500, { expr: "queue > 0" });
  const eq = r.n("var.add", 11, 330, { var: "queue", amount: -1 });
  const ew = r.n("var.set", 12, 330, { var: "who" });
  const en = r.n("var.get", 11, 500, { var: "nextWho" });
  const eem = r.n("action.emit", 13, 330, { name: "回す" });
  b.go(sig, sb);
  b.go([sb, "true"], s0, ...sflags, smsg, ssnd, sdl);
  b.go([sdl, "completed"], [m3, null, "p1"]);
  b.go([m3, "p2"], [mj, null, "p1"]);
  b.go([mj, "p2"], e0, eb);
  b.go([eb, "true"], eq, ew, eem);
  b.wire(sc, "result", sb, "cond");
  b.wire(sref, "found", smsg, "target");
  b.wire(ec, "result", eb, "cond");
  b.wire(en, "value", ew, "value");
  r.end();
  return b.done();
}

// ===============================
// 🏇 レース：コメント競馬
// ===============================
const RUNNERS = [["うさぎ", "🐇"], ["かめ", "🐢"], ["うま", "🐎"], ["いぬ", "🐕"]];
const START_X = 95;   // 走る子の真ん中のスタート位置
const GOAL = 760;     // ゴールまでの距離（px）
const laneY = (i) => 148 + i * 100;

function race() {
  const g = createBlankGimmick("game", "コメント競馬");
  g.description = "コメント「1」〜「4」で応援した子が前へ。いちばん先にゴールした子の勝ち。ギフトでいちばん後ろの子がターボ";
  g.width = 1000;
  g.height = 540;
  g.background = "#08130cdd";
  g.gravity = 0;
  const lanes = RUNNERS.map((_, i) => obj({ name: `レーン ${i + 1}`, x: 0, y: 100 + i * 100, w: 1000, h: 96, look: { shape: "rect", fill: i % 2 ? "#ffffff0d" : "#ffffff1a", radius: 0 } }));
  const nums = RUNNERS.map(([name], i) => label(`${i + 1} ${name}`, 878, laneY(i) - 20, 120, 40, `${i + 1} ${name}`, { size: 22, color: "#ffffffcc" }));
  const runners = RUNNERS.map(([name, emoji], i) => obj({ name, tag: "runner", x: START_X - 35, y: laneY(i) - 35, w: 70, h: 70, look: { shape: "emoji", emoji } }));
  const goal = obj({ name: "ゴールの線", x: START_X + GOAL - 4, y: 100, w: 8, h: 400, look: { shape: "rect", fill: "#ffffff", radius: 0, glow: 10, glowColor: "#ffffff" } });
  const flag = obj({ name: "旗", x: START_X + GOAL - 30, y: 40, w: 60, h: 60, look: { shape: "emoji", emoji: "🏁" }, motion: { type: "swing", speed: 1, amount: 8 } });
  const title = label("タイトル", 20, 28, 820, 50, "🏁 第{round}レース　「1」〜「4」をコメントして応援！", { size: 28 });
  const band = obj({ name: "勝ちの帯", x: 0, y: 200, w: 1000, h: 170, hidden: true, look: { shape: "rect", fill: "#000000b3", radius: 0 } });
  const win = label("勝ち", 100, 210, 800, 150, "", { font: "Dela Gothic One", size: 54, weight: 400, color: "#ffe66d", outline: 8, hidden: true });
  const howto = label("遊び方", 60, 504, 880, 32, "🎁 ギフトで いちばん後ろの子がターボ！（ギフトの個数が多いほど大きく進む）", { size: 18, color: "#ffffff99", weight: 700 });
  g.objects.push(...lanes, goal, flag, ...nums, ...runners, title, howto, band, win);
  const sStep = sound("blip", "進む");
  const sTurbo = sound("powerup", "ターボ");
  const sFan = sound("fanfare");
  const fw = effect("fireworks");
  const confetti = effect("confetti");
  g.sounds.push(sStep, sTurbo, sFan);
  g.effects.push(fw, confetti);
  g.variables.push(
    ...RUNNERS.map((_, i) => v(`p${i + 1}`, 0)),
    v("tmp", 0), v("over", 0), v("round", 1), v("winner", ""), v("fan", ""),
    v("step", 22, "1コメントで進む距離（px）"),
  );

  const b = blueprint(g);
  // 関数「進める」：走る子を前へ進めて、新しい位置を返す。ゴールに着いたら勝負あり（over ＝ 1）
  const runFn = b.fn({
    name: "進める", desc: "走る子を「歩数」ぶん前へ進めます（1歩の長さは少しランダム）。ゴールに着いたら勝った子と応援した人を覚えて、勝負あり（over を 1）。新しい位置を返します。",
    inputs: [["走る子", "entity"], ["名前", "string"], ["今の位置", "number"], ["歩数", "number"], ["応援した人", "string"]],
    outputs: [["新しい位置", "number"]],
  });
  let r = runFn.row("関数：新しい位置を一度だけ計算して変数 tmp に入れ（ランダムなので）、そこへ走らせる。ゴールなら勝った子と応援した人を覚えて、勝負あり", "#9b6bff");
  const fe = r.n("fn.entry", 0, 0);
  const fb = r.n("flow.branch", 1, 0);
  const fc = r.n("expr", 1, 140, { expr: "over == 0" });
  const fstay = r.n("fn.return", 1, 340);
  const ftmp = r.n("var.set", 2, 0, { var: "tmp" });
  const fcalc = r.n("expr", 2, 170, { expr: `min(${GOAL}, a + step * b * random(0.6, 1.4))` });
  const finfo = r.n("get.entity", 2, 370);
  const fmove = r.n("action.moveTo", 3, 0, { seconds: 0.25 });
  const fx = r.n("math.add", 3, 260, { b: START_X });
  const fsnd = r.n("action.playSound", 4, 0, { sound: sStep.id, volume: 0.25 });
  const fgoal = r.n("cmp.gte", 4, 190, { b: GOAL });
  const fgb = r.n("flow.branch", 5, 0);
  const fwin = r.n("var.set", 6, 0, { var: "winner" });
  const ffan = r.n("var.set", 7, 0, { var: "fan" });
  const fem = r.n("var.set", 8, 0, { var: "over", value: 1 });
  const fdone = r.n("fn.return", 9, 0);
  const fnext = r.n("fn.return", 6, 190);
  runFn.go(fe, fb);
  runFn.go([fb, "true"], ftmp, fmove, fsnd, fgb);
  runFn.go([fb, "false"], fstay);
  runFn.go([fgb, "true"], fwin, ffan, fem, fdone);
  runFn.go([fgb, "false"], fnext);
  runFn.wire(fc, "result", fb, "cond");
  runFn.wire(fe, "p3", fcalc, "a");
  runFn.wire(fe, "p4", fcalc, "b");
  runFn.wire(fcalc, "result", ftmp, "value");
  runFn.wire(fe, "p1", fmove, "target");
  runFn.wire(fe, "p1", finfo, "target");
  runFn.wire(ftmp, "value", fx, "a");
  runFn.wire(fx, "result", fmove, "x");
  runFn.wire(finfo, "y", fmove, "y");
  runFn.wire(ftmp, "value", fgoal, "a");
  runFn.wire(fgoal, "result", fgb, "cond");
  runFn.wire(fe, "p2", fwin, "value");
  runFn.wire(fe, "p5", ffan, "value");
  runFn.wire(fe, "p3", fstay, "p6");
  runFn.wire(ftmp, "value", fdone, "p6");
  runFn.wire(ftmp, "value", fnext, "p6");
  r.end();

  // 関数「次のレース」：みんなをスタートに戻す
  const nextFn = b.fn({ name: "次のレース", desc: "みんなをスタートに戻して、次のレースを始めます。" });
  r = nextFn.row("関数：位置の変数を 0 にして、みんなをスタートへ戻す → レースの数 +1 → 「勝ち」と帯を隠す", "#9b6bff");
  const ne = r.n("fn.entry", 0, 0);
  const nchain = [ne];
  runners.forEach((runner, i) => {
    const set = r.n("var.set", 1 + i * 2, 0, { var: `p${i + 1}`, value: 0 });
    const mv = r.n("action.moveTo", 2 + i * 2, 0, { x: START_X, y: laneY(i), seconds: 0.6 });
    const ref = r.n("get.object", 1 + i * 2, 190, { object: runner.id });
    nextFn.wire(ref, "found", mv, "target");
    nchain.push(set, mv);
  });
  const nr = r.n("var.add", 9, 0, { var: "round", amount: 1 });
  const no = r.n("var.set", 10, 0, { var: "over", value: 0 });
  const nh = r.n("action.setVisible", 11, 0, { visible: false });
  const nh2 = r.n("action.setVisible", 12, 0, { visible: false });
  const nref = r.n("get.object", 10, 190, { object: win.id });
  const nref2 = r.n("get.object", 11, 190, { object: band.id });
  const nret = r.n("fn.return", 13, 0);
  nextFn.go(...nchain, nr, no, nh, nh2, nret);
  nextFn.wire(nref, "found", nh, "target");
  nextFn.wire(nref2, "found", nh2, "target");
  r.end();

  r = b.row("コメント「1」〜「4」：その子を自作の関数「進める」で1歩前へ、返ってきた位置を変数に入れる", "#4ec3ff");
  runners.forEach((runner, i) => {
    const dy = i * 280;
    const chat = r.n("event.chat", 0, dy, { match: "exact", keyword: String(i + 1) });
    const ref = r.n("get.object", 1, dy, { object: runner.id });
    const pos = r.n("var.get", 1, dy + 130, { var: `p${i + 1}` });
    const call = r.n("call.function", 2, dy, { fn: runFn.f.id, p2: RUNNERS[i][0], p4: 1 });
    const set = r.n("var.set", 3, dy, { var: `p${i + 1}` });
    b.go(chat, call, set);
    b.wire(ref, "found", call, "p1");
    b.wire(pos, "value", call, "p3");
    b.wire(chat, "user", call, "p5");
    b.wire(call, "p6", set, "value");
  });
  r.end();

  r = b.row("ギフト：いちばん後ろの子（同じなら全員）にターボ。同じ関数「進める」を、歩数を大きくして呼ぶ", "#ffc93c");
  const gift = r.n("event.gift", 0, 0);
  const gseq = r.n("flow.sequence", 1, 0, { outs: 5 });
  const steps = r.n("expr", 0, 920, { expr: "min(8, 2 + count)" });
  b.go(gift, gseq);
  runners.forEach((runner, i) => {
    const dy = i * 300;
    const br = r.n("flow.branch", 2, dy);
    const last = r.n("expr", 2, dy + 120, { expr: `p${i + 1} <= min(p1, p2, p3, p4)` });
    const call = r.n("call.function", 3, dy, { fn: runFn.f.id, p2: RUNNERS[i][0] });
    const set = r.n("var.set", 4, dy, { var: `p${i + 1}` });
    const ref = r.n("get.object", 1, 240 + i * 140, { object: runner.id });
    const pos = r.n("var.get", 0, 340 + i * 140, { var: `p${i + 1}` });
    b.go([gseq, `then${i}`], br);
    b.go([br, "true"], call, set);
    b.wire(last, "result", br, "cond");
    b.wire(ref, "found", call, "p1");
    b.wire(pos, "value", call, "p3");
    b.wire(steps, "result", call, "p4");
    b.wire(gift, "user", call, "p5");
    b.wire(call, "p6", set, "value");
  });
  b.go([gseq, "then4"], r.n("action.playSound", 2, 1200, { sound: sTurbo.id, volume: 0.6 }));
  r.end();

  r = b.row("勝負がついたら（over が 1 になった瞬間）：勝った子と、とどめを応援した人を発表 → 5秒後に自作の関数「次のレース」", "#5cff9d");
  const done = r.n("event.when", 0, 0);
  const dc = r.n("expr", 0, 120, { expr: "over == 1" });
  const st = r.n("action.setText", 1, 0, { text: "🏆 {winner} の勝ち！\nとどめの応援：{fan} さん" });
  const sband = r.n("action.setVisible", 2, 0, { visible: true });
  const sv = r.n("action.setVisible", 3, 0, { visible: true });
  const sref = r.n("get.object", 1, 170, { object: win.id });
  const sbref = r.n("get.object", 2, 170, { object: band.id });
  const ss = r.n("action.playSound", 4, 0, { sound: sFan.id });
  const sf = r.n("action.playEffect", 5, 0, { effect: fw.id, x: START_X + GOAL, y: 160 });
  const sc = r.n("action.playEffect", 6, 0, { effect: confetti.id, x: 500, y: 560 });
  const sd = r.n("flow.delay", 7, 0, { seconds: 5 });
  const sn = r.n("call.function", 8, 0, { fn: nextFn.f.id });
  b.go(done, st, sband, sv, ss, sf, sc, sd);
  b.go([sd, "completed"], sn);
  b.wire(dc, "result", done, "cond");
  b.wire(sref, "found", st, "target");
  b.wire(sref, "found", sv, "target");
  b.wire(sbref, "found", sband, "target");
  r.end();
  return b.done();
}

// ===============================
// 🧠 推理：数当てゲーム
// ===============================
const BAR_X = 100;
const BAR_W = 700;

function numberGuess() {
  const g = createBlankGimmick("game", "数当てゲーム");
  g.description = "1〜100 のどれかを、コメントで当てる。外れると「もっと大きい／小さい」で範囲がせまくなる。ギフトでヒント";
  g.width = 900;
  g.height = 500;
  g.background = "#0b0b1add";
  g.gravity = 0;
  const title = label("タイトル", 100, 14, 700, 56, "🔢 数当てゲーム", { font: "Dela Gothic One", size: 44, weight: 400, color: "#ffe66d", outline: 6 });
  const sub = label("お題", 100, 72, 700, 36, "1〜{max} のどれかな？ コメントで数字を答えてね", { size: 22, color: "#ffffffcc", weight: 700 });
  const center = label("答え", 300, 112, 300, 130, "{center}", { font: "Orbitron", size: 96, color: "#5cf2ff", outline: 6 });
  const range = label("範囲", 250, 246, 400, 44, "{lo} 〜 {hi}", { font: "Orbitron", size: 30 });
  const barBg = obj({ name: "範囲の棒（下）", x: BAR_X, y: 300, w: BAR_W, h: 26, look: { shape: "rect", fill: "#ffffff1f", radius: 13 } });
  const bar = obj({ name: "範囲の棒", tag: "range", x: BAR_X, y: 300, w: BAR_W, h: 26, look: { shape: "rect", fill: "#5cf2ff", radius: 13, glow: 12, glowColor: "#5cf2ff" } });
  const hint = label("ヒント", 40, 342, 820, 50, "{hint}", { size: 28 });
  const tries = label("回答の数", 40, 400, 820, 36, "回答 {tries} 回", { size: 20, color: "#ffffffaa", weight: 700 });
  const howto = label("遊び方", 40, 448, 820, 36, "🎁 ギフトでヒント（範囲が半分に）　💬 範囲の外の数は数えません", { size: 18, color: "#ffffff88", weight: 700 });
  g.objects.push(title, sub, center, range, barBg, bar, hint, tries, howto);
  const sUp = sound("jump", "大きい");
  const sDown = sound("drop", "小さい");
  const sFan = sound("fanfare");
  const sHint = sound("magic", "ヒント");
  const fw = effect("fireworks");
  const confetti = effect("confetti");
  const sparkle = effect("sparkle", { count: 40 });
  g.sounds.push(sUp, sDown, sFan, sHint);
  g.effects.push(fw, confetti, sparkle);
  g.variables.push(
    v("max", 100, "最大の数"), v("answer", 0), v("lo", 1), v("hi", 100), v("tries", 0), v("over", 0),
    v("center", "？"), v("hint", ""),
  );

  const b = blueprint(g);
  // 関数「範囲を表示」：lo 〜 hi に合わせて、棒の幅と位置を変える
  const showFn = b.fn({ name: "範囲を表示", desc: "変数 lo 〜 hi（残っている範囲）に合わせて、範囲の棒の幅と位置を変えます。" });
  let r = showFn.row("関数：棒の幅 ＝ 残りの割合、真ん中 ＝ 範囲の真ん中（なめらかに動かす）", "#9b6bff");
  const se = r.n("fn.entry", 0, 0);
  const ssz = r.n("action.setSize", 1, 0);
  const sw = r.n("expr", 0, 120, { expr: `max(8, (hi - lo + 1) / max * ${BAR_W})` });
  const smv = r.n("action.moveTo", 2, 0, { y: 313, seconds: 0.35 });
  const sx = r.n("expr", 1, 200, { expr: `${BAR_X} + ((lo - 1) + (hi - lo + 1) / 2) / max * ${BAR_W}` });
  const sref = r.n("get.object", 0, 330, { object: bar.id });
  const sret = r.n("fn.return", 3, 0);
  showFn.go(se, ssz, smv, sret);
  showFn.wire(sw, "result", ssz, "w");
  showFn.wire(sx, "result", smv, "x");
  showFn.wire(sref, "found", ssz, "target");
  showFn.wire(sref, "found", smv, "target");
  r.end();

  // 関数「新しい問題」：答えを決め直して、範囲を 1 〜 max に戻す
  const newFn = b.fn({ name: "新しい問題", desc: "答えを 1〜最大の数 のどれかに決め直して、範囲と回答の数を戻します。" });
  r = newFn.row("関数：答えをランダムに決める → 範囲を 1 〜 max に → 回答 0 → 真ん中を「？」 → お知らせ → 関数「範囲を表示」", "#9b6bff");
  const ne = r.n("fn.entry", 0, 0);
  const na = r.n("var.set", 1, 0, { var: "answer" });
  const nrand = r.n("expr", 1, 170, { expr: "randint(1, max)" });
  const nlo = r.n("var.set", 2, 0, { var: "lo", value: 1 });
  const nhi = r.n("var.set", 3, 0, { var: "hi" });
  const nmax = r.n("var.get", 3, 170, { var: "max" });
  const nt = r.n("var.set", 4, 0, { var: "tries", value: 0 });
  const no = r.n("var.set", 5, 0, { var: "over", value: 0 });
  const nc = r.n("var.set", 6, 0, { var: "center", value: "？" });
  const nh = r.n("var.set", 7, 0, { var: "hint" });
  const nfmt = r.n("text.format", 7, 170, { template: "コメントで 1〜{max} の数字を答えてね！" });
  const nshow = r.n("call.function", 8, 0, { fn: showFn.f.id });
  const nret = r.n("fn.return", 9, 0);
  newFn.go(ne, na, nlo, nhi, nt, no, nc, nh, nshow, nret);
  newFn.wire(nrand, "result", na, "value");
  newFn.wire(nmax, "value", nhi, "value");
  newFn.wire(nfmt, "result", nh, "value");
  r.end();

  // マクロ「正解を発表」：当てた人を発表して答えを見せ、6秒待ってから続きへ（待つのでマクロ）
  const winMacro = b.fn({
    kind: "macro", name: "正解を発表", desc: "当てた人を発表して答えを見せ、お祝いの演出のあと 6 秒待ってから続きへ進みます。",
    inputs: [["実行", "exec"], ["当てた人", "string"]], outputs: [["続き", "exec"]],
  });
  r = winMacro.row("マクロ：受け付けを止める → 答えを見せる（範囲も答えだけに）→ 当てた人を発表 → 花火 → 6秒待つ → 続き", "#c8c8d8");
  const wi = r.n("macro.in", 0, 0);
  const co = r.n("var.set", 1, 0, { var: "over", value: 1 });
  const cans = r.n("var.get", 1, 170, { var: "answer" });
  const cc = r.n("var.set", 2, 0, { var: "center" });
  const clo = r.n("var.set", 3, 0, { var: "lo" });
  const chi = r.n("var.set", 4, 0, { var: "hi" });
  const ch = r.n("var.set", 5, 0, { var: "hint" });
  const cfmt = r.n("text.format", 5, 170, { template: "🎉 {a} さん 正解！（{tries} 回目）" });
  const cshow = r.n("call.function", 6, 0, { fn: showFn.f.id });
  const cs = r.n("action.playSound", 7, 0, { sound: sFan.id });
  const cf1 = r.n("action.playEffect", 8, 0, { effect: fw.id, x: 230, y: 150 });
  const cf2 = r.n("action.playEffect", 9, 0, { effect: fw.id, x: 670, y: 150 });
  const ccf = r.n("action.playEffect", 10, 0, { effect: confetti.id, x: 450, y: 520 });
  const cd = r.n("flow.delay", 11, 0, { seconds: 6 });
  const wo = r.n("macro.out", 12, 0);
  winMacro.go([wi, "p1"], co, cc, clo, chi, ch, cshow, cs, cf1, cf2, ccf, cd);
  winMacro.go([cd, "completed"], [wo, null, "p3"]);
  for (const n of [cc, clo, chi]) winMacro.wire(cans, "value", n, "value");
  winMacro.wire(wi, "p2", cfmt, "a");
  winMacro.wire(cfmt, "result", ch, "value");
  r.end();

  r = b.row("ゲームが始まったら、自作の関数「新しい問題」", "#ffffff");
  const st = r.n("event.start", 0, 0);
  b.go(st, r.n("call.function", 1, 0, { fn: newFn.f.id }));
  r.end();

  r = b.row("コメントが範囲の中の数なら答えとして受け付ける → 当たりならマクロ「正解を発表」のあと関数「新しい問題」／もっと大きい／もっと小さい（全角の「４２」も読める）", "#4ec3ff");
  const chat = r.n("event.chat", 0, 0);
  const valid = r.n("expr", 0, 290, { expr: "isnum(a) && over == 0 && a >= lo && a <= hi" });
  const vb = r.n("flow.branch", 1, 0);
  const vt = r.n("var.add", 2, 0, { var: "tries", amount: 1 });
  const ans = r.n("var.get", 2, 170, { var: "answer" });
  const eq = r.n("cmp.eq", 3, 140);
  const lt = r.n("cmp.lt", 3, 250);
  const hb = r.n("flow.branch", 3, 0);
  const em = r.n("call.macro", 4, 0, { fn: winMacro.f.id });
  const again = r.n("call.function", 5, 0, { fn: newFn.f.id });
  const db = r.n("flow.branch", 4, 160);
  b.go(chat, vb);
  b.go([vb, "true"], vt, hb);
  b.go([hb, "true"], [em, null, "p1"]);
  b.go([em, "p3"], again);
  b.wire(chat, "user", em, "p2");
  b.go([hb, "false"], db);
  b.wire(chat, "comment", valid, "a");
  b.wire(valid, "result", vb, "cond");
  b.wire(chat, "comment", eq, "a");
  b.wire(ans, "value", eq, "b");
  b.wire(eq, "result", hb, "cond");
  b.wire(chat, "comment", lt, "a");
  b.wire(ans, "value", lt, "b");
  b.wire(lt, "result", db, "cond");
  // もっと大きい（lo を上げる）・もっと小さい（hi を下げる）
  [["true", "lo", "math.add", "⬆ もっと大きい！", sUp], ["false", "hi", "math.sub", "⬇ もっと小さい！", sDown]].forEach(([pinName, varName, op, word, snd], i) => {
    const dy = 160 + i * 380;
    const set = r.n("var.set", 5, dy, { var: varName });
    const calc = r.n(op, 5, dy + 160, { b: 1 });
    const hint = r.n("var.set", 6, dy, { var: "hint" });
    const fmt = r.n("text.format", 6, dy + 170, { template: `{a} さん「{b}」→ ${word}` });
    const show = r.n("call.function", 7, dy, { fn: showFn.f.id });
    const s = r.n("action.playSound", 8, dy, { sound: snd.id, volume: 0.4 });
    b.go([db, pinName], set, hint, show, s);
    b.wire(chat, "comment", calc, "a");
    b.wire(calc, "result", set, "value");
    b.wire(chat, "user", fmt, "a");
    b.wire(chat, "comment", fmt, "b");
    b.wire(fmt, "result", hint, "value");
  });
  r.end();

  r = b.row("ギフトでヒント：範囲を、答えのほうへ半分にせばめる", "#9b6bff");
  const gift = r.n("event.gift", 0, 0);
  const gc = r.n("expr", 0, 340, { expr: "over == 0" });
  const gb = r.n("flow.branch", 1, 0);
  const glo = r.n("var.set", 2, 0, { var: "lo" });
  const glox = r.n("expr", 2, 170, { expr: "lo + floor((answer - lo) / 2)" });
  const ghi = r.n("var.set", 3, 0, { var: "hi" });
  const ghix = r.n("expr", 3, 170, { expr: "hi - floor((hi - answer) / 2)" });
  const gh = r.n("var.set", 4, 0, { var: "hint" });
  const gfmt = r.n("text.format", 4, 170, { template: "💡 {a} さんのヒント！ {b} 〜 {c} にしぼれた" });
  const gshow = r.n("call.function", 5, 0, { fn: showFn.f.id });
  const gs = r.n("action.playSound", 6, 0, { sound: sHint.id, volume: 0.5 });
  const gfx = r.n("action.playEffect", 7, 0, { effect: sparkle.id, x: 450, y: 313 });
  b.go(gift, gb);
  b.go([gb, "true"], glo, ghi, gh, gshow, gs, gfx);
  b.wire(gc, "result", gb, "cond");
  b.wire(glox, "result", glo, "value");
  b.wire(ghix, "result", ghi, "value");
  b.wire(gift, "user", gfmt, "a");
  b.wire(glo, "value", gfmt, "b");
  b.wire(ghi, "value", gfmt, "c");
  b.wire(gfmt, "result", gh, "value");
  r.end();
  return b.done();
}

// ===============================
// 🐉 RPG：ミニモンスター（みんなでバトル＆ゲット）
// ===============================
// オリジナルのモンスター10匹（ほのお・みず・くさ が3匹ずつ ＋ レアの「ゆめ」）。番号から choose() で表を引く
const MONSTERS = [
  ["ホムラコン", "🦊", "ほのお", 18], ["メラドラ", "🐲", "ほのお", 26], ["ボウボウ", "🐓", "ほのお", 20],
  ["ケロポン", "🐸", "みず", 18], ["タコスミン", "🐙", "みず", 24], ["クジラン", "🐳", "みず", 30],
  ["ハムシー", "🐛", "くさ", 16], ["トゲリーフ", "🦔", "くさ", 22], ["コケガメ", "🐢", "くさ", 28],
  ["ユメユニ", "🦄", "ゆめ", 40],
];
const column = (i, quote = true) => MONSTERS.map((m) => (quote ? `"${m[i]}"` : m[i])).join(", ");
const WILD_X = 710;   // あいての真ん中
const WILD_Y = 190;
const BAR_LEN = 340;

function monsters() {
  const g = createBlankGimmick("game", "ミニモンスター");
  g.description = "とびだしてくる野生のモンスターと、視聴者みんなでバトル。弱らせて「!ボール」でつかまえて図鑑をうめよう。相棒はレベルアップで しんかする";
  g.width = 960;
  g.height = 600;
  g.background = "#0e1530dd";
  g.gravity = 0;
  const panel = (name, x, y, w, h) => obj({ name, x, y, w, h, look: { shape: "rect", fill: "#0b0b1ae6", stroke: "#ffffff55", strokeWidth: 2, radius: 14 } });
  const bar = (name, x, y, w, h, fill, tag = "") => obj({ name, tag, x, y, w, h, look: { shape: "rect", fill, radius: h / 2 } });
  const field = obj({ name: "草原", x: 0, y: 262, w: 960, h: 200, look: { shape: "rect", fill: "#173022", radius: 0 } });
  const wildBase = obj({ name: "あいての足場", x: 570, y: 246, w: 280, h: 56, look: { shape: "ellipse", fill: "#2c5a3c" } });
  const buddyBase = obj({ name: "相棒の足場", x: 40, y: 404, w: 300, h: 60, look: { shape: "ellipse", fill: "#2c5a3c" } });
  const wild = obj({ name: "あいて", tag: "wild", x: WILD_X - 90, y: WILD_Y - 90, w: 180, h: 180, look: { shape: "emoji", emoji: "🦊" }, motion: { type: "float", speed: 0.8, amount: 6 } });
  const buddy = obj({ name: "相棒", tag: "buddy", x: 105, y: 270, w: 170, h: 170, look: { shape: "emoji", emoji: "🥚" }, motion: { type: "float", speed: 0.6, amount: 5 } });
  const ball = obj({ name: "つかまえ玉", x: 172, y: 312, w: 56, h: 56, hidden: true, look: { shape: "emoji", emoji: "🔮" } });
  // あいての情報（左上）
  const wildPanel = panel("あいての枠", 30, 30, 420, 118);
  const wildName = label("あいての名前", 30, 38, 420, 40, "{wildName}　Lv.{wildLv}", { size: 28 });
  const wildType = label("タイプ", 30, 76, 420, 28, "{wildType}タイプ", { size: 18, color: "#ff7a3c", weight: 700 });
  const wildHpLabel = label("HP（あいて）", 36, 108, 44, 28, "HP", { size: 15, color: "#ffe66d" });
  const wildBarBg = bar("HPの棒（あいて・下）", 80, 116, BAR_LEN, 14, "#ffffff22");
  const wildBar = bar("HPの棒（あいて）", 80, 116, BAR_LEN, 14, "#5cff9d", "wildbar");
  // 相棒の情報（右下）
  const buddyPanel = panel("相棒の枠", 510, 318, 420, 134);
  const buddyName = label("相棒の名前", 510, 326, 420, 40, "{buddyName}　Lv.{lv}", { size: 28 });
  const teamHpLabel = label("HP（相棒）", 516, 376, 44, 28, "HP", { size: 15, color: "#ffe66d" });
  const teamBarBg = bar("HPの棒（相棒・下）", 560, 384, BAR_LEN, 14, "#ffffff22");
  const teamBar = bar("HPの棒（相棒）", 560, 384, BAR_LEN, 14, "#5cff9d", "teambar");
  const teamHpText = label("HP の数", 510, 400, 420, 26, "{teamHp} / {teamMax}", { font: "Orbitron", size: 18 });
  const expLabel = label("EXP", 512, 424, 48, 24, "EXP", { size: 12, color: "#4ec3ff" });
  const expBarBg = bar("経験値の棒（下）", 560, 432, BAR_LEN, 8, "#ffffff22");
  const expBar = bar("経験値の棒", 560, 432, 1, 8, "#4ec3ff", "expbar");
  // 図鑑・メッセージ・遊び方
  const dex = label("図鑑", 470, 4, 480, 30, "📖 図鑑 {dexCount}/10　{dex}", { size: 18, color: "#ffffffcc", weight: 700 });
  const msgBox = obj({ name: "メッセージの枠", x: 20, y: 466, w: 920, h: 92, look: { shape: "rect", fill: "#0b0b1af0", stroke: "#ffffff", strokeWidth: 3, radius: 14 } });
  const msg = label("メッセージ", 40, 474, 880, 76, "{msg}", { size: 25 });
  const howto = label("遊び方", 10, 566, 940, 30, "💬 !たたかう !ほのお !みず !くさ !ボール　❤ いいねで回復　🎁 ギフトで全回復＋スーパー玉", { size: 16, color: "#ffffffaa", weight: 700 });
  // 浮かぶ文字（プレハブ）
  const healPop = obj({ name: "回復", tag: "pop", prefab: true, w: 160, h: 36, life: 1, look: { shape: "text", text: "❤ +5", fontSize: 26, fontWeight: 800, textColor: "#ff8ac8", outline: 4, outlineColor: "#000000" }, body: { type: "none", vy: -70 } });
  const levelPop = obj({ name: "レベルアップ", tag: "pop", prefab: true, w: 340, h: 48, life: 1.6, look: { shape: "text", text: "⬆ LEVEL UP!  Lv.{lv}", fontSize: 30, fontWeight: 800, textColor: "#ffe66d", outline: 5, outlineColor: "#000000" }, body: { type: "none", vy: -50 } });
  g.objects.push(field, wildBase, buddyBase, wild, buddy, ball, wildPanel, wildName, wildType, wildHpLabel, wildBarBg, wildBar,
    buddyPanel, buddyName, teamHpLabel, teamBarBg, teamBar, teamHpText, expLabel, expBarBg, expBar, dex, msgBox, msg, howto, healPop, levelPop);
  const sHit = sound("hit");
  const sThrow = sound("jump", "なげる");
  const sWobble = sound("blip", "ゆれる");
  const sCatch = sound("coin", "つかまえた");
  const sFan = sound("fanfare");
  const sLose = sound("lose");
  const sUp = sound("powerup", "レベルアップ");
  const sMagic = sound("magic", "しんか");
  const hitFx = effect("burst", { count: 18, speed: 300, size: 8 }, "こうげき");
  const sparkle = effect("sparkle", { count: 36 });
  const fw = effect("fireworks");
  g.sounds.push(sHit, sThrow, sWobble, sCatch, sFan, sLose, sUp, sMagic);
  g.effects.push(hitFx, sparkle, fw);
  g.variables.push(
    v("state", 0), // 0 準備中・1 バトル中・2 決着・3 つかまえ中・4 ひとやすみ
    v("wildId", 1), v("wildName", ""), v("wildEmoji", ""), v("wildType", ""), v("wildLv", 1), v("wildHp", 1), v("wildMax", 1),
    v("buddyName", "コロタマ"), v("lv", 1), v("exp", 0), v("teamHp", 60), v("teamMax", 60), v("evo", 1),
    v("dex", ""), v("dexCount", 0), v("caught", 0),
    v("msg", "コメントで あそぼう！ !たたかう !ほのお !みず !くさ !ボール"),
    v("tmpMult", 1), v("tmpDmg", 0),
    v("toughness", 1, "モンスターのかたさ（倍）"), v("wildPower", 1, "あいてのこうげき（倍）"), v("rareRate", 5, "レアの出やすさ（%）"),
  );

  const b = blueprint(g);
  // ピュア関数「モンスターの情報」：番号（1〜10）から、名前・絵文字・タイプ・かたさを引く表
  const infoFn = b.fn({
    name: "モンスターの情報", pure: true, desc: "番号（1〜10）から、モンスターの名前・絵文字・タイプ・かたさ（HP のもと）を返します。モンスターを増やすときはここの式に足します。",
    inputs: [["番号", "number"]], outputs: [["名前", "string"], ["絵文字", "string"], ["タイプ", "string"], ["かたさ", "number"]],
  });
  let r = infoFn.row("ピュア関数：choose(番号, …) で表を引く（10番はレアの「ゆめ」タイプ）", "#3fae5c");
  const ie = r.n("fn.entry", 0, 0);
  const iret = r.n("fn.return", 2, 0);
  [[0, true, "p2"], [1, true, "p3"], [2, true, "p4"], [3, false, "p5"]].forEach(([col, quote, pinName], i) => {
    const x = r.n("expr", 1, i * 190, { expr: `choose(a, ${column(col, quote)})` });
    infoFn.wire(ie, "p1", x, "a");
    infoFn.wire(x, "result", iret, pinName);
  });
  r.end();

  // ピュア関数「相性」：ほのお → くさ → みず → ほのお が「ばつぐん（2倍）」、逆と同じタイプは「いまひとつ（半分）」
  const typeFn = b.fn({
    name: "相性", pure: true, desc: "わざのタイプと、あいてのタイプから倍率を返します（ばつぐん 2・ふつう 1・いまひとつ 0.5）。",
    inputs: [["わざのタイプ", "string"], ["あいてのタイプ", "string"]], outputs: [["倍率", "number"]],
  });
  r = typeFn.row("ピュア関数：ほのお→くさ・くさ→みず・みず→ほのお は 2倍、逆と同じタイプは 0.5倍（「ゆめ」とふつうのわざは 1倍）", "#3fae5c");
  const te = r.n("fn.entry", 0, 0);
  const tx = r.n("expr", 1, 0, {
    expr: "a == \"ほのお\" && b == \"くさ\" || a == \"くさ\" && b == \"みず\" || a == \"みず\" && b == \"ほのお\" ? 2 : (a == b || a == \"ほのお\" && b == \"みず\" || a == \"くさ\" && b == \"ほのお\" || a == \"みず\" && b == \"くさ\" ? 0.5 : 1)",
  });
  const tr = r.n("fn.return", 2, 0);
  typeFn.wire(te, "p1", tx, "a");
  typeFn.wire(te, "p2", tx, "b");
  typeFn.wire(tx, "result", tr, "p3");
  r.end();

  // 関数「こうげき」：わざのタイプで、あいての HP を減らす
  const attackFn = b.fn({
    name: "こうげき", desc: "バトル中なら、わざのタイプと相性で決まるダメージを、あいてに与えます。与えたダメージを返します。",
    inputs: [["わざのタイプ", "string"], ["人", "string"]], outputs: [["ダメージ", "number"]],
  });
  r = attackFn.row("関数：ピュア関数「相性」で倍率 → ダメージ ＝ (3 ＋ レベル) × 倍率 → あいての HP を減らす → 「◯◯ さんの ファイア！ 8 ダメージ　こうかは ばつぐんだ！」", "#9b6bff");
  const ae = r.n("fn.entry", 0, 0);
  const ac = r.n("expr", 0, 170, { expr: "state == 1" });
  const ab = r.n("flow.branch", 1, 0);
  const ang = r.n("fn.return", 1, 300, { p3: 0 });
  const amul = r.n("var.set", 2, 0, { var: "tmpMult" });
  const atype = r.n("call.function", 1, 160, { fn: typeFn.f.id });
  const awt = r.n("var.get", 0, 380, { var: "wildType" });
  const admg = r.n("var.set", 3, 0, { var: "tmpDmg" });
  const adx = r.n("expr", 3, 170, { expr: "max(1, round((3 + lv) * tmpMult * random(0.8, 1.2)))" });
  const ahp = r.n("var.add", 4, 0, { var: "wildHp" });
  const aneg = r.n("expr", 4, 170, { expr: "-tmpDmg" });
  const amsg = r.n("var.set", 5, 0, { var: "msg" });
  const amx = r.n("expr", 5, 170, { expr: "a + \" さんの \" + b + \"！ \" + tmpDmg + \" ダメージ\" + (tmpMult >= 2 ? \"　こうかは ばつぐんだ！\" : tmpMult < 1 ? \"　いまひとつのようだ…\" : \"\")" });
  const aname = r.n("expr", 4, 370, { expr: "a == \"ほのお\" ? \"ファイア\" : a == \"みず\" ? \"アクア\" : a == \"くさ\" ? \"リーフ\" : \"パンチ\"" });
  const afx = r.n("action.playEffectOn", 6, 0, { effect: hitFx.id });
  const aref = r.n("get.object", 6, 160, { object: wild.id });
  const ashake = r.n("action.shake", 7, 0, { seconds: 0.15 });
  const ash = r.n("expr", 7, 150, { expr: "tmpMult >= 2 ? 8 : 2" });
  const asnd = r.n("action.playSound", 8, 0, { sound: sHit.id, volume: 0.45 });
  const aret = r.n("fn.return", 9, 0);
  attackFn.go(ae, ab);
  attackFn.go([ab, "true"], amul, admg, ahp, amsg, afx, ashake, asnd, aret);
  attackFn.go([ab, "false"], ang);
  attackFn.wire(ac, "result", ab, "cond");
  attackFn.wire(ae, "p1", atype, "p1");
  attackFn.wire(awt, "value", atype, "p2");
  attackFn.wire(atype, "p3", amul, "value");
  attackFn.wire(adx, "result", admg, "value");
  attackFn.wire(aneg, "result", ahp, "amount");
  attackFn.wire(ae, "p2", amx, "a");
  attackFn.wire(ae, "p1", aname, "a");
  attackFn.wire(aname, "result", amx, "b");
  attackFn.wire(amx, "result", amsg, "value");
  attackFn.wire(aref, "found", afx, "target");
  attackFn.wire(ash, "result", ashake, "strength");
  attackFn.wire(admg, "value", aret, "p3");
  r.end();

  // 関数「次のモンスター」：番号を決めて、表から名前・絵文字・タイプ・HP を入れ、右から登場させる
  const nextFn = b.fn({ name: "次のモンスター", desc: "次の野生のモンスターを決めて、右から登場させます（レベルは相棒に合わせる。たまにレア）。" });
  r = nextFn.row("関数：番号（たまにレアの10番）→ ピュア関数「モンスターの情報」で名前・絵文字・タイプ・かたさ → レベルと HP → 右からとびだす", "#9b6bff");
  const ne = r.n("fn.entry", 0, 0);
  const nid = r.n("var.set", 1, 0, { var: "wildId" });
  const nidx = r.n("expr", 1, 170, { expr: "chance(rareRate) ? 10 : randint(1, 9)" });
  const ninfo = r.n("call.function", 2, 190, { fn: infoFn.f.id });
  const nname = r.n("var.set", 2, 0, { var: "wildName" });
  const nemo = r.n("var.set", 3, 0, { var: "wildEmoji" });
  const ntype = r.n("var.set", 4, 0, { var: "wildType" });
  const nlv = r.n("var.set", 5, 0, { var: "wildLv" });
  const nlvx = r.n("expr", 5, 170, { expr: "wildId == 10 ? lv + 3 : max(1, lv + randint(-1, 1))" });
  const nmax = r.n("var.set", 6, 0, { var: "wildMax" });
  const nmaxx = r.n("expr", 6, 170, { expr: "round(a * toughness * (0.8 + wildLv * 0.4))" });
  const nhp = r.n("var.set", 7, 0, { var: "wildHp" });
  const nface = r.n("action.setEmoji", 8, 0);
  const nalpha = r.n("action.setOpacity", 9, 0, { opacity: 1 });
  const nshow = r.n("action.setVisible", 10, 0, { visible: true });
  const npos = r.n("action.setPosition", 11, 0, { x: 1100, y: WILD_Y });
  const nmove = r.n("action.moveTo", 12, 0, { x: WILD_X, y: WILD_Y, seconds: 0.6 });
  const nwild = r.n("get.object", 8, 170, { object: wild.id });
  const nball = r.n("action.setVisible", 13, 0, { visible: false });
  const nballRef = r.n("get.object", 13, 160, { object: ball.id });
  const ncolor = r.n("action.setColor", 14, 0);
  const ncolorx = r.n("expr", 14, 160, { expr: "wildType == \"ほのお\" ? \"#ff7a3c\" : wildType == \"みず\" ? \"#3cc8ff\" : wildType == \"くさ\" ? \"#5cff9d\" : \"#ff9cf0\"" });
  const ntypeRef = r.n("get.object", 13, 300, { object: wildType.id });
  const nmsg = r.n("var.set", 15, 0, { var: "msg" });
  const nmsgx = r.n("expr", 15, 170, { expr: "(wildId == 10 ? \"✨ レア！ \" : \"\") + \"あっ！ やせいの \" + wildName + \"（Lv.\" + wildLv + \"）が とびだしてきた！\"" });
  const nstate = r.n("var.set", 16, 0, { var: "state", value: 1 });
  const nret = r.n("fn.return", 17, 0);
  nextFn.go(ne, nid, nname, nemo, ntype, nlv, nmax, nhp, nface, nalpha, nshow, npos, nmove, nball, ncolor, nmsg, nstate, nret);
  nextFn.wire(nidx, "result", nid, "value");
  nextFn.wire(nid, "value", ninfo, "p1");
  nextFn.wire(ninfo, "p2", nname, "value");
  nextFn.wire(ninfo, "p3", nemo, "value");
  nextFn.wire(ninfo, "p4", ntype, "value");
  nextFn.wire(nlvx, "result", nlv, "value");
  nextFn.wire(ninfo, "p5", nmaxx, "a");
  nextFn.wire(nmaxx, "result", nmax, "value");
  nextFn.wire(nmax, "value", nhp, "value");
  nextFn.wire(nemo, "value", nface, "emoji");
  for (const n of [nface, nalpha, nshow, npos, nmove]) nextFn.wire(nwild, "found", n, "target");
  nextFn.wire(nballRef, "found", nball, "target");
  nextFn.wire(ntypeRef, "found", ncolor, "target");
  nextFn.wire(ncolorx, "result", ncolor, "color");
  nextFn.wire(nmsgx, "result", nmsg, "value");
  r.end();

  // 関数「図鑑に登録」：つかまえた数 +1。まだ図鑑にいない絵文字なら、図鑑の文字に足す
  const dexFn = b.fn({ name: "図鑑に登録", desc: "つかまえた数を増やし、はじめてのモンスターなら図鑑（絵文字のならび）に足します。" });
  r = dexFn.row("関数：has(図鑑, 絵文字) で、まだいなければ図鑑の文字に足す（リストの代わりに、文字の変数に絵文字を並べる）", "#9b6bff");
  const de = r.n("fn.entry", 0, 0);
  const dc = r.n("var.add", 1, 0, { var: "caught", amount: 1 });
  const dnew = r.n("expr", 1, 170, { expr: "has(dex, wildEmoji) == 0" });
  const db = r.n("flow.branch", 2, 0);
  const dold = r.n("fn.return", 2, 150);
  const dset = r.n("var.set", 3, 0, { var: "dex" });
  const dsetx = r.n("expr", 3, 170, { expr: "dex + wildEmoji" });
  const dn = r.n("var.add", 4, 0, { var: "dexCount", amount: 1 });
  const dret = r.n("fn.return", 5, 0);
  dexFn.go(de, dc, db);
  dexFn.go([db, "true"], dset, dn, dret);
  dexFn.go([db, "false"], dold);
  dexFn.wire(dnew, "result", db, "cond");
  dexFn.wire(dsetx, "result", dset, "value");
  r.end();

  // 関数「経験値」：経験値を足して、たまったらレベルアップ（HP も満タン）
  const expFn = b.fn({ name: "経験値", desc: "経験値を足します。「レベル × 6」たまったらレベルアップして、HP の上限が増え満タンになります。", inputs: [["量", "number"]] });
  r = expFn.row("関数：経験値 ＋ 量 → 「レベル × 6」以上なら、レベル +1・HP の上限 +10・HP 満タン・「LEVEL UP!」", "#9b6bff");
  const ee = r.n("fn.entry", 0, 0);
  const eadd = r.n("var.add", 1, 0, { var: "exp" });
  const ecx = r.n("expr", 1, 170, { expr: "exp >= lv * 6" });
  const eb = r.n("flow.branch", 2, 0);
  const eno = r.n("fn.return", 2, 150);
  const eset = r.n("var.set", 3, 0, { var: "exp" });
  const esetx = r.n("expr", 3, 170, { expr: "exp - lv * 6" });
  const elv = r.n("var.add", 4, 0, { var: "lv", amount: 1 });
  const emax = r.n("var.add", 5, 0, { var: "teamMax", amount: 10 });
  const ehp = r.n("var.set", 6, 0, { var: "teamHp" });
  const ehpx = r.n("var.get", 6, 170, { var: "teamMax" });
  const epop = r.n("action.spawn", 7, 0, { prefab: levelPop.id, at: "xy", x: 190, y: 250 });
  const esnd = r.n("action.playSound", 8, 0, { sound: sUp.id, volume: 0.6 });
  const eret = r.n("fn.return", 9, 0);
  expFn.go(ee, eadd, eb);
  expFn.go([eb, "true"], eset, elv, emax, ehp, epop, esnd, eret);
  expFn.go([eb, "false"], eno);
  expFn.wire(ee, "p1", eadd, "amount");
  expFn.wire(ecx, "result", eb, "cond");
  expFn.wire(esetx, "result", eset, "value");
  expFn.wire(ehpx, "value", ehp, "value");
  r.end();

  // 関数「HPを表示」：HP と経験値のバーの長さと色
  const barsFn = b.fn({ name: "HPを表示", desc: "あいてと相棒の HP、経験値のバーを、今の値に合わせます（HP が減ると黄色 → 赤）。" });
  r = barsFn.row("関数：バーの長さ ＝ 今 ÷ 最大。HP は半分で黄色、2割で赤", "#9b6bff");
  const be = r.n("fn.entry", 0, 0);
  const bw1 = r.n("action.setSize", 1, 0);
  const bw1x = r.n("expr", 0, 120, { expr: `max(0, ${BAR_LEN} * wildHp / max(1, wildMax))` });
  const bc1 = r.n("action.setColor", 2, 0);
  const bc1x = r.n("expr", 1, 200, { expr: "wildHp / max(1, wildMax) > 0.5 ? \"#5cff9d\" : wildHp / max(1, wildMax) > 0.2 ? \"#ffd84d\" : \"#ff5c5c\"" });
  const bw2 = r.n("action.setSize", 3, 0);
  const bw2x = r.n("expr", 2, 200, { expr: `max(0, ${BAR_LEN} * teamHp / max(1, teamMax))` });
  const bc2 = r.n("action.setColor", 4, 0);
  const bc2x = r.n("expr", 3, 200, { expr: "teamHp / max(1, teamMax) > 0.5 ? \"#5cff9d\" : teamHp / max(1, teamMax) > 0.2 ? \"#ffd84d\" : \"#ff5c5c\"" });
  const bw3 = r.n("action.setSize", 5, 0);
  const bw3x = r.n("expr", 4, 200, { expr: `${BAR_LEN} * min(1, exp / (lv * 6))` });
  const bret = r.n("fn.return", 6, 0);
  const bref1 = r.n("get.object", 0, 320, { object: wildBar.id });
  const bref2 = r.n("get.object", 2, 400, { object: teamBar.id });
  const bref3 = r.n("get.object", 4, 400, { object: expBar.id });
  barsFn.go(be, bw1, bc1, bw2, bc2, bw3, bret);
  barsFn.wire(bw1x, "result", bw1, "w");
  barsFn.wire(bc1x, "result", bc1, "color");
  barsFn.wire(bw2x, "result", bw2, "w");
  barsFn.wire(bc2x, "result", bc2, "color");
  barsFn.wire(bw3x, "result", bw3, "w");
  for (const n of [bw1, bc1]) barsFn.wire(bref1, "found", n, "target");
  for (const n of [bw2, bc2]) barsFn.wire(bref2, "found", n, "target");
  barsFn.wire(bref3, "found", bw3, "target");
  r.end();

  // マクロ「ゆれる」：つかまえ玉を傾けて、音を鳴らし、少し待つ
  const wobble = b.fn({ kind: "macro", name: "ゆれる", desc: "つかまえ玉を「角度」に傾けて音を鳴らし、0.4秒待ちます。", inputs: [["実行", "exec"], ["角度", "number"]], outputs: [["続き", "exec"]] });
  r = wobble.row("マクロ：傾ける → 音 → 0.4秒待つ（3回つなげて、ドキドキさせる）", "#c8c8d8");
  const wi = r.n("macro.in", 0, 0);
  const wrot = r.n("action.setRotation", 1, 0);
  const wref = r.n("get.object", 0, 150, { object: ball.id });
  const wsnd = r.n("action.playSound", 2, 0, { sound: sWobble.id, volume: 0.5 });
  const wdl = r.n("flow.delay", 3, 0, { seconds: 0.4 });
  const wo = r.n("macro.out", 4, 0);
  wobble.go([wi, "p1"], wrot, wsnd, wdl);
  wobble.go([wdl, "completed"], [wo, null, "p3"]);
  wobble.wire(wref, "found", wrot, "target");
  wobble.wire(wi, "p2", wrot, "rotation");
  r.end();

  // マクロ「つかまえ玉を投げる」：出口が2つ（つかまえた／にげられた）
  const throwMacro = b.fn({
    kind: "macro", name: "つかまえ玉を投げる", desc: "つかまえ玉を投げて、3回ゆれたあと「つかまえた」か「にげられた」の出口へ。HP が少ないほど・ボーナスが大きいほどつかまえやすい（レアはつかまえにくい）。",
    inputs: [["実行", "exec"], ["投げた人", "string"], ["ボーナス", "number"]], outputs: [["つかまえた", "exec"], ["にげられた", "exec"]],
  });
  r = throwMacro.row("マクロ：玉を投げる → あいてが玉に入る → マクロ「ゆれる」×3 → つかまえる確率 ＝ 25% ＋ 弱らせたぶん（最大 +55%）＋ ボーナス（レアは −25%）→ 出口が2つ", "#c8c8d8");
  const ti = r.n("macro.in", 0, 0);
  const tst = r.n("var.set", 1, 0, { var: "state", value: 3 });
  const tmsg = r.n("var.set", 2, 0, { var: "msg" });
  const tmsgx = r.n("expr", 2, 170, { expr: "a + \" さんが \" + (b > 0 ? \"スーパーつかまえ玉\" : \"つかまえ玉\") + \"を なげた！\"" });
  const tpos = r.n("action.setPosition", 3, 0, { x: 200, y: 340 });
  const tball = r.n("get.object", 3, 190, { object: ball.id });
  const trot = r.n("action.setRotation", 4, 0, { rotation: 0 });
  const twild = r.n("get.object", 4, 190, { object: wild.id });
  const tshow = r.n("action.setVisible", 5, 0, { visible: true });
  const tmove = r.n("action.moveTo", 6, 0, { x: WILD_X, y: WILD_Y + 20, seconds: 0.45 });
  const tsnd = r.n("action.playSound", 7, 0, { sound: sThrow.id, volume: 0.5 });
  const tdl = r.n("flow.delay", 8, 0, { seconds: 0.45 });
  const thide = r.n("action.setVisible", 9, 0, { visible: false });
  const tfx = r.n("action.playEffectOn", 10, 0, { effect: sparkle.id });
  const tw1 = r.n("call.macro", 11, 0, { fn: wobble.f.id, p2: 25 });
  const tw2 = r.n("call.macro", 12, 0, { fn: wobble.f.id, p2: -25 });
  const tw3 = r.n("call.macro", 13, 0, { fn: wobble.f.id, p2: 0 });
  const tb = r.n("flow.branch", 14, 0);
  const tcx = r.n("expr", 13, 150, { expr: "chance(clamp(25 + (1 - wildHp / max(1, wildMax)) * 55 + b - (wildId == 10 ? 25 : 0), 5, 95))" });
  const tok = r.n("action.playSound", 15, 0, { sound: sCatch.id, volume: 0.6 });
  const tout = r.n("macro.out", 20, 0);
  const tf1 = r.n("action.setVisible", 15, 230, { visible: false });
  const tf2 = r.n("action.setVisible", 16, 230, { visible: true });
  const tf3 = r.n("var.set", 17, 230, { var: "state", value: 1 });
  const tf4 = r.n("var.set", 18, 230, { var: "msg" });
  const tf4x = r.n("expr", 18, 400, { expr: "\"あーっ！ \" + wildName + \" が 玉から とびだした！\"" });
  const tf5 = r.n("action.playSound", 19, 230, { sound: sLose.id, volume: 0.4 });
  throwMacro.go([ti, "p1"], tst, tmsg, tpos, trot, tshow, tmove, tsnd, tdl);
  throwMacro.go([tdl, "completed"], thide, tfx, [tw1, null, "p1"]);
  throwMacro.go([tw1, "p3"], [tw2, null, "p1"]);
  throwMacro.go([tw2, "p3"], [tw3, null, "p1"]);
  throwMacro.go([tw3, "p3"], tb);
  throwMacro.go([tb, "true"], tok, [tout, null, "p4"]);
  throwMacro.go([tb, "false"], tf1, tf2, tf3, tf4, tf5, [tout, null, "p5"]);
  throwMacro.wire(ti, "p2", tmsgx, "a");
  throwMacro.wire(ti, "p3", tmsgx, "b");
  throwMacro.wire(tmsgx, "result", tmsg, "value");
  for (const n of [tpos, trot, tshow, tmove, tfx, tf1]) throwMacro.wire(tball, "found", n, "target");
  for (const n of [thide, tf2]) throwMacro.wire(twild, "found", n, "target");
  throwMacro.wire(ti, "p3", tcx, "b");
  throwMacro.wire(tcx, "result", tb, "cond");
  throwMacro.wire(tf4x, "result", tf4, "value");
  r.end();

  // マクロ「ゲットした」：つかまえたあとの お祝い（図鑑・経験値）
  const gotMacro = b.fn({ kind: "macro", name: "ゲットした", desc: "つかまえたことを発表して、図鑑に登録し、経験値をもらいます。お祝いのあと 3 秒待って続きへ。", inputs: [["実行", "exec"], ["人", "string"]], outputs: [["続き", "exec"]] });
  r = gotMacro.row("マクロ：「やった！ ◯◯ を つかまえた！」→ 関数「図鑑に登録」→ 関数「経験値」→ 花火 → 3秒待つ", "#c8c8d8");
  const gi = r.n("macro.in", 0, 0);
  const gst = r.n("var.set", 1, 0, { var: "state", value: 2 });
  const gmsg = r.n("var.set", 2, 0, { var: "msg" });
  const gmsgx = r.n("expr", 2, 170, { expr: "\"やった！ \" + wildName + \" を つかまえた！（\" + a + \" さんの 玉）\"" });
  const gdex = r.n("call.function", 3, 0, { fn: dexFn.f.id });
  const gexp = r.n("call.function", 4, 0, { fn: expFn.f.id });
  const gexpx = r.n("expr", 4, 140, { expr: "wildLv * 4 + 4" });
  const gfw = r.n("action.playEffect", 5, 0, { effect: fw.id, x: WILD_X, y: 150 });
  const gsnd = r.n("action.playSound", 6, 0, { sound: sFan.id });
  const gdl = r.n("flow.delay", 7, 0, { seconds: 3 });
  const go = r.n("macro.out", 8, 0);
  gotMacro.go([gi, "p1"], gst, gmsg, gdex, gexp, gfw, gsnd, gdl);
  gotMacro.go([gdl, "completed"], [go, null, "p3"]);
  gotMacro.wire(gi, "p2", gmsgx, "a");
  gotMacro.wire(gmsgx, "result", gmsg, "value");
  gotMacro.wire(gexpx, "result", gexp, "p1");
  r.end();

  // マクロ「しんか」：相棒の見た目と名前を変える（レベル5・10で呼ぶ）
  const evolve = b.fn({ kind: "macro", name: "しんか", desc: "「おや…？」のあと、相棒の絵文字と名前を変えます。", inputs: [["実行", "exec"], ["絵文字", "string"], ["名前", "string"]], outputs: [["続き", "exec"]] });
  r = evolve.row("マクロ：「おや…？ ようすが…！」→ 光って大きく → 1.6秒待つ → 絵文字と名前を変える → 「しんかした！」", "#c8c8d8");
  const vi = r.n("macro.in", 0, 0);
  const vm1 = r.n("var.set", 1, 0, { var: "msg" });
  const vm1x = r.n("expr", 1, 170, { expr: "\"おや…？ \" + buddyName + \" の ようすが…！\"" });
  const vs1 = r.n("action.playSound", 2, 0, { sound: sMagic.id, volume: 0.6 });
  const vfl = r.n("action.flash", 3, 0, { color: "#ffffff", seconds: 0.6 });
  const vbig = r.n("action.setScale", 4, 0, { scale: 1.3 });
  const vref = r.n("get.object", 4, 170, { object: buddy.id });
  const vdl = r.n("flow.delay", 5, 0, { seconds: 1.6 });
  const vface = r.n("action.setEmoji", 6, 0);
  const vname = r.n("var.set", 7, 0, { var: "buddyName" });
  const vback = r.n("action.setScale", 8, 0, { scale: 1 });
  const vfx = r.n("action.playEffectOn", 9, 0, { effect: sparkle.id });
  const vs2 = r.n("action.playSound", 10, 0, { sound: sFan.id });
  const vm2 = r.n("var.set", 11, 0, { var: "msg" });
  const vm2x = r.n("expr", 11, 170, { expr: "\"おめでとう！ \" + buddyName + \" に しんかした！\"" });
  const vo = r.n("macro.out", 12, 0);
  evolve.go([vi, "p1"], vm1, vs1, vfl, vbig, vdl);
  evolve.go([vdl, "completed"], vface, vname, vback, vfx, vs2, vm2, [vo, null, "p4"]);
  evolve.wire(vm1x, "result", vm1, "value");
  for (const n of [vbig, vface, vback, vfx]) evolve.wire(vref, "found", n, "target");
  evolve.wire(vi, "p2", vface, "emoji");
  evolve.wire(vi, "p3", vname, "value");
  evolve.wire(vm2x, "result", vm2, "value");
  r.end();

  // ===== イベントグラフ =====
  r = b.row("ゲームが始まったら、関数「次のモンスター」。0.1秒ごとに関数「HPを表示」でバーを直す", "#ffffff");
  const st = r.n("event.start", 0, 0);
  b.go(st, r.n("call.function", 1, 0, { fn: nextFn.f.id }));
  const tick = r.n("event.every", 0, 140, { seconds: 0.1 });
  b.go(tick, r.n("call.function", 1, 140, { fn: barsFn.f.id }));
  r.end();

  r = b.row("コメントで こうげき：!たたかう（ふつう）・!ほのお・!みず・!くさ（関数「こうげき」。相性で 2倍／半分）", "#ff5c8a");
  [["!たたかう", "なし"], ["!ほのお", "ほのお"], ["!みず", "みず"], ["!くさ", "くさ"]].forEach(([keyword, type], i) => {
    const dy = i * 280;
    const chat = r.n("event.chat", 0, dy, { match: "command", keyword });
    const call = r.n("call.function", 1, dy, { fn: attackFn.f.id, p1: type });
    b.go(chat, call);
    b.wire(chat, "user", call, "p2");
  });
  r.end();

  r = b.row("コメント「!ボール」で マクロ「つかまえ玉を投げる」。🎁 ギフトは相棒を全回復して、スーパーつかまえ玉（+40%）。つかまえたら マクロ「ゲットした」→ 関数「次のモンスター」", "#ffc93c");
  [["event.chat", { match: "command", keyword: "!ボール" }, 0, 0], ["event.gift", {}, 40, 500]].forEach(([type, values, bonus, dy]) => {
    const ev = r.n(type, 0, dy, values);
    const cond = r.n("expr", 0, dy + (type === "event.gift" ? 340 : 290), { expr: "state == 1" });
    let from = ev;
    let col = 1;
    if (type === "event.gift") {
      const heal = r.n("var.set", 1, dy, { var: "teamHp" });
      const max = r.n("var.get", 1, dy + 170, { var: "teamMax" });
      const fx = r.n("action.playEffectOn", 2, dy, { effect: sparkle.id });
      const ref = r.n("get.object", 2, dy + 160, { object: buddy.id });
      b.go(ev, heal, fx);
      b.wire(max, "value", heal, "value");
      b.wire(ref, "found", fx, "target");
      from = fx;
      col = 3;
    }
    const br = r.n("flow.branch", col, dy);
    const toss = r.n("call.macro", col + 1, dy, { fn: throwMacro.f.id, p3: bonus });
    const got = r.n("call.macro", col + 2, dy, { fn: gotMacro.f.id });
    const next = r.n("call.function", col + 3, dy, { fn: nextFn.f.id });
    b.go(from, br);
    b.go([br, "true"], [toss, null, "p1"]);
    b.go([toss, "p4"], [got, null, "p1"]);
    b.go([got, "p3"], next);
    b.wire(cond, "result", br, "cond");
    b.wire(ev, "user", toss, "p2");
    b.wire(ev, "user", got, "p2");
  });
  r.end();

  r = b.row("いいね20件ごとに、相棒が少し回復（+5）", "#ff8ac8");
  const like = r.n("event.like", 0, 0, { every: 20 });
  const lheal = r.n("var.set", 1, 0, { var: "teamHp" });
  const lhealx = r.n("expr", 1, 170, { expr: "min(teamMax, teamHp + 5)" });
  const lpop = r.n("action.spawn", 2, 0, { prefab: healPop.id, at: "xy", x: 190, y: 280 });
  b.go(like, lheal, lpop);
  b.wire(lhealx, "result", lheal, "value");
  r.end();

  r = b.row("あいての こうげき：4.5秒ごとに（バトル中だけ）相棒の HP が減る", "#ff5c5c");
  const every = r.n("event.every", 0, 0, { seconds: 4.5 });
  const ec = r.n("expr", 0, 180, { expr: "state == 1" });
  const eb2 = r.n("flow.branch", 1, 0);
  const ed = r.n("var.set", 2, 0, { var: "tmpDmg" });
  const edx = r.n("expr", 2, 170, { expr: "max(1, round((2 + wildLv * 1.5) * wildPower * random(0.7, 1.3)))" });
  const eh = r.n("var.add", 3, 0, { var: "teamHp" });
  const ehx = r.n("expr", 3, 170, { expr: "-tmpDmg" });
  const em = r.n("var.set", 4, 0, { var: "msg" });
  const emx = r.n("expr", 4, 170, { expr: "wildName + \" の こうげき！ \" + buddyName + \" に \" + tmpDmg + \" ダメージ\"" });
  const ek = r.n("action.shake", 5, 0, { strength: 8, seconds: 0.25 });
  const ef = r.n("action.flash", 6, 0, { color: "#ff3c3c", seconds: 0.2 });
  const es = r.n("action.playSound", 7, 0, { sound: sHit.id, volume: 0.4 });
  b.go(every, eb2);
  b.go([eb2, "true"], ed, eh, em, ek, ef, es);
  b.wire(ec, "result", eb2, "cond");
  b.wire(edx, "result", ed, "value");
  b.wire(ehx, "result", eh, "amount");
  b.wire(emx, "result", em, "value");
  r.end();

  r = b.row("あいての HP が 0 → たおした！ 関数「経験値」をもらって、2.5秒後に関数「次のモンスター」", "#5cff9d");
  const down = r.n("event.when", 0, 0);
  const dcx = r.n("expr", 0, 120, { expr: "wildHp <= 0 && state == 1" });
  const ds = r.n("var.set", 1, 0, { var: "state", value: 2 });
  const dfade = r.n("action.setOpacity", 2, 0, { opacity: 0.25 });
  const dref = r.n("get.object", 2, 170, { object: wild.id });
  const dm = r.n("var.set", 3, 0, { var: "msg" });
  const dmx = r.n("expr", 3, 170, { expr: "wildName + \" を たおした！ けいけんち +\" + (wildLv * 3 + 2)" });
  const dexp = r.n("call.function", 4, 0, { fn: expFn.f.id });
  const dexpx = r.n("expr", 4, 140, { expr: "wildLv * 3 + 2" });
  const dsnd = r.n("action.playSound", 5, 0, { sound: sCatch.id, volume: 0.5 });
  const ddl = r.n("flow.delay", 6, 0, { seconds: 2.5 });
  const dnext = r.n("call.function", 7, 0, { fn: nextFn.f.id });
  b.go(down, ds, dfade, dm, dexp, dsnd, ddl);
  b.go([ddl, "completed"], dnext);
  b.wire(dcx, "result", down, "cond");
  b.wire(dref, "found", dfade, "target");
  b.wire(dmx, "result", dm, "value");
  b.wire(dexpx, "result", dexp, "p1");
  r.end();

  r = b.row("相棒の HP が 0 → ひとやすみ。あいては にげていき、4秒後に HP 満タンで次のモンスター", "#ff5c8a");
  const faint = r.n("event.when", 0, 0);
  const fcx = r.n("expr", 0, 120, { expr: "teamHp <= 0 && state == 1" });
  const fs = r.n("var.set", 1, 0, { var: "state", value: 4 });
  const ffade = r.n("action.setOpacity", 2, 0, { opacity: 0.4 });
  const fref = r.n("get.object", 2, 170, { object: buddy.id });
  const fm = r.n("var.set", 3, 0, { var: "msg" });
  const fmx = r.n("expr", 3, 170, { expr: "buddyName + \" は たおれてしまった… \" + wildName + \" は にげていった\"" });
  const fsnd = r.n("action.playSound", 4, 0, { sound: sLose.id, volume: 0.5 });
  const fdl = r.n("flow.delay", 5, 0, { seconds: 4 });
  const fheal = r.n("var.set", 6, 0, { var: "teamHp" });
  const fmax = r.n("var.get", 6, 170, { var: "teamMax" });
  const fback = r.n("action.setOpacity", 7, 0, { opacity: 1 });
  const fnext = r.n("call.function", 8, 0, { fn: nextFn.f.id });
  b.go(faint, fs, ffade, fm, fsnd, fdl);
  b.go([fdl, "completed"], fheal, fback, fnext);
  b.wire(fcx, "result", faint, "cond");
  b.wire(fref, "found", ffade, "target");
  b.wire(fref, "found", fback, "target");
  b.wire(fmx, "result", fm, "value");
  b.wire(fmax, "value", fheal, "value");
  r.end();

  r = b.row("レベル5・10で、マクロ「しんか」（🥚 コロタマ → 🐣 ピヨッチ → 🦅 ソラワシ）", "#9b6bff");
  [[5, 1, "🐣", "ピヨッチ"], [10, 2, "🦅", "ソラワシ"]].forEach(([at, evo, emoji, name], i) => {
    const dy = i * 300;
    const when = r.n("event.when", 0, dy);
    const cond = r.n("expr", 0, dy + 120, { expr: `lv >= ${at} && evo == ${evo}` });
    const set = r.n("var.set", 1, dy, { var: "evo", value: evo + 1 });
    const call = r.n("call.macro", 2, dy, { fn: evolve.f.id, p2: emoji, p3: name });
    b.go(when, set, [call, null, "p1"]);
    b.wire(cond, "result", when, "cond");
  });
  r.end();
  return b.done();
}

/** ジャンルの順番は、ホームの「ミニゲーム」の並び */
export const MINIGAME_TEMPLATES = [
  { id: "mg-runner", kind: "game", genre: "アクション", name: "障害物ジャンプ", desc: "コメント「ジャンプ」・いいねでみんなで跳ぶ。ギフトでむてき", build: runner },
  { id: "mg-shooter", kind: "game", genre: "シューティング", name: "コメント迎撃", desc: "コメントのたびに発射。ギフトで5方向に連射", build: shooter },
  { id: "mg-slot", kind: "game", genre: "運・ガチャ", name: "ギフトスロット", desc: "ギフトで回る。大きいギフトほど JACKPOT しやすい", build: slot },
  { id: "mg-race", kind: "game", genre: "レース", name: "コメント競馬", desc: "「1」〜「4」で応援。ギフトでビリの子がターボ", build: race },
  { id: "mg-guess", kind: "game", genre: "推理", name: "数当てゲーム", desc: "コメントで数字を当てる。ギフトでヒント", build: numberGuess },
  { id: "mg-monsters", kind: "game", genre: "RPG", name: "ミニモンスター", desc: "みんなでバトルして、弱らせてゲット。相棒はしんかする", build: monsters },
].map((t) => ({ ...t, group: "minigame" }));
