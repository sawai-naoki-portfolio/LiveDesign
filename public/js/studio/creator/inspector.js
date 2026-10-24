// public/js/studio/creator/inspector.js
// 右の「インスペクター」：選んでいるもの（オブジェクト・サウンド・エフェクト・変数・ブループリントのノード・関数・マクロ）の設定。
// 何も選んでいなければギミック全体の設定（Unity のインスペクターと同じ考え方）。
import {
  cstore, onC, change, live, endLive, selectC, findIn, graphFor, emitC,
} from "./state.js";
import {
  h, numberField, sliderField, selectField, toggleField, textField, colorField, section, row, modal,
} from "../editor/ui.js";
import { assetField, FONT_OPTIONS } from "../editor/inspector.js";
import {
  SHAPES, BODY_TYPES, EDGE_MODES, MOTIONS, PARTICLE_SHAPES, WAVES, GIMMICK_KIND_LABELS,
  normalizeObject, normalizeEffect, normalizeSound, signalNames,
} from "../shared/gimmick/defaults.js";
import { playSynth, SOUND_PRESETS } from "../shared/gimmick/synth.js";
import { createPlayer } from "../shared/gimmick/player.js";
import { NODE_TYPES, PIN_COLORS, PIN_TYPE_LABELS, PARAM_TYPES, pinsOf, nodeKind, nodeTitle, fnOf } from "../shared/gimmick/nodes.js";
import { fieldControl } from "./graph.js";
import {
  FN_KIND_LABELS, addParam, updateParam, removeParam, moveParam, setPure, callSites, duplicateFunction, deleteFunction, uniqueFnName,
} from "./functions.js";
import { clone, uid, getPath, setPath } from "../shared/model.js";

const WEIGHTS = [[400, "400 標準"], [500, "500 中"], [700, "700 太"], [800, "800 極太"], [900, "900 黒"]];

const NORMALIZE = { object: normalizeObject, sound: normalizeSound, effect: normalizeEffect, variable: (v) => v, node: (n) => n, function: (f) => f };

function current() {
  const s = cstore.selection;
  if (!s) return null;
  const raw = findIn(cstore.gimmick, s.type, s.id);
  return raw ? NORMALIZE[s.type]?.(raw) ?? raw : null;
}

/** 選んでいるものの値の読み書き */
function sp(path) {
  return {
    get: () => getPath(current(), path),
    set: (v, o = {}) => {
      const s = cstore.selection;
      if (!s) return;
      const fn = (gm) => {
        const t = findIn(gm, s.type, s.id);
        if (!t) return;
        // 既定値のままの配列（エフェクトの色など）は、書き換える前に実体へ写す
        const top = path.split(".")[0];
        const norm = NORMALIZE[s.type]?.(t);
        if (norm && Array.isArray(norm[top]) && !Array.isArray(t[top])) t[top] = clone(norm[top]);
        setPath(t, path, v);
      };
      if (o.live) live(fn);
      else {
        endLive();
        change(fn, { coalesce: `${s.type}:${s.id}:${path}` });
      }
    },
  };
}

/** ギミック全体の値 */
function gp(path) {
  return {
    get: () => getPath(cstore.gimmick, path),
    set: (v, o = {}) => {
      const fn = (gm) => setPath(gm, path, v);
      if (o.live) live(fn);
      else { endLive(); change(fn, { coalesce: `g:${path}` }); }
    },
  };
}

const LIST = { object: "objects", sound: "sounds", effect: "effects" };

function itemButtons(type) {
  const s = cstore.selection;
  const dup = () => {
    const src = findIn(cstore.gimmick, type, s.id);
    if (!src) return;
    const copy = clone(src);
    copy.id = uid(type === "object" ? "obj" : type === "sound" ? "snd" : "fx");
    copy.name = `${src.name} のコピー`;
    if (type === "object") { copy.x += 20; copy.y += 20; }
    change((gm) => { const list = gm[LIST[type]]; list.splice(list.findIndex((x) => x.id === s.id) + 1, 0, copy); });
    selectC(type, copy.id);
  };
  const del = async () => {
    const src = findIn(cstore.gimmick, type, s.id);
    if (!src) return;
    if (!(await modal("削除", h("p", {}, `「${src.name}」を削除します。ブループリントで使っているノードは動かなくなります。`), { okText: "削除" }))) return;
    change((gm) => { gm[LIST[type]] = gm[LIST[type]].filter((x) => x.id !== s.id); });
    selectC(null);
  };
  const order = (d) => change((gm) => {
    const list = gm.objects;
    const i = list.findIndex((x) => x.id === s.id);
    if (i < 0) return;
    const [x] = list.splice(i, 1);
    list.splice(d === "front" ? list.length : d === "back" ? 0 : Math.max(0, Math.min(list.length, i + d)), 0, x);
  });
  return h("div", { class: "btn-row" },
    h("button", { type: "button", class: "small-btn", onclick: dup }, "複製"),
    type === "object" ? h("button", { type: "button", class: "small-btn", title: "いちばん手前へ", onclick: () => order("front") }, "最前面") : null,
    type === "object" ? h("button", { type: "button", class: "small-btn", title: "いちばん奥へ", onclick: () => order("back") }, "最背面") : null,
    h("button", { type: "button", class: "small-btn danger", onclick: del }, "削除"));
}

// ===============================
// オブジェクト
// ===============================
function objectFields(o) {
  const L = (k) => sp(`look.${k}`);
  const B = (k) => sp(`body.${k}`);
  const shape = o.look.shape;
  const lookFields = [selectField({ label: "形", options: SHAPES, ...L("shape") })];
  if (["rect", "ellipse", "triangle", "star"].includes(shape)) {
    lookFields.push(colorField({ label: "塗り", ...L("fill") }));
    if (shape === "rect") lookFields.push(numberField({ label: "角の丸み", min: 0, max: 2000, unit: "px", ...L("radius") }));
    lookFields.push(row(numberField({ label: "線の太さ", min: 0, max: 100, ...L("strokeWidth") })), colorField({ label: "線の色", ...L("stroke") }));
  } else if (shape === "text") {
    lookFields.push(
      textField({ label: "文字（{score} や {user} などの式を差し込めます）", multiline: true, rows: 2, ...L("text") }),
      selectField({ label: "フォント", wide: true, options: FONT_OPTIONS, ...L("font") }),
      row(numberField({ label: "大きさ", min: 4, max: 600, unit: "px", ...L("fontSize") }), selectField({ label: "太さ", options: WEIGHTS, ...L("fontWeight") })),
      colorField({ label: "文字の色", ...L("textColor") }),
      row(numberField({ label: "縁取り", min: 0, max: 40, ...L("outline") })),
      colorField({ label: "縁取りの色", ...L("outlineColor") }),
    );
  } else if (shape === "emoji") {
    lookFields.push(textField({ label: "絵文字", ...L("emoji") }));
  } else if (shape === "image") {
    lookFields.push(
      assetField({ label: "画像", kind: "visual", ...L("src") }),
      h("p", { class: "hint" }, "「オブジェクトを出す」の画像で「その人のアイコン」「ギフトの画像」を選ぶと、イベントの画像に差し替わります。"),
      numberField({ label: "角の丸み", min: 0, max: 2000, unit: "px", ...L("radius") }),
      row(numberField({ label: "枠の太さ", min: 0, max: 100, ...L("strokeWidth") })), colorField({ label: "枠の色", ...L("stroke") }),
    );
  }
  lookFields.push(row(numberField({ label: "光", min: 0, max: 200, unit: "px", hint: "まわりをぼんやり光らせる", ...L("glow") })), colorField({ label: "光の色", ...L("glowColor") }));

  const bodyType = o.body.type;
  const physics = [selectField({ label: "物理", wide: true, options: BODY_TYPES, ...B("type") })];
  physics.push(row(numberField({ label: "速さ X", unit: "px/秒", ...B("vx") }), numberField({ label: "速さ Y", unit: "px/秒", ...B("vy") })));
  if (bodyType === "dynamic") {
    physics.push(
      row(numberField({ label: "重力の倍率", step: 0.1, hint: "0 で浮く・マイナスで上へ落ちる", ...B("gravity") }), numberField({ label: "跳ね返り", min: 0, max: 1.5, step: 0.05, ...B("bounce") })),
      row(numberField({ label: "床のすべりにくさ", min: 0, max: 5, step: 0.1, ...B("friction") }), numberField({ label: "空気の抵抗", min: 0, max: 20, step: 0.1, ...B("drag") })),
    );
  }
  physics.push(
    numberField({ label: "回転の速さ", unit: "°/秒", ...B("spin") }),
    selectField({ label: "画面の端では", wide: true, options: EDGE_MODES, ...B("edges") }),
  );
  if (bodyType !== "none") physics.push(toggleField({ label: "ほかの物理オブジェクトとぶつかる", ...B("solid") }));

  const effects = cstore.gimmick.effects.map((e) => [e.id, e.name]);
  return [
    section("オブジェクト", [
      textField({ label: "名前", ...sp("name") }),
      textField({ label: "タグ（イベントで「ball」など、まとめて扱う名前。空白区切りで複数）", ...sp("tag") }),
      toggleField({ label: "📦 プレハブにする（最初は出さず、「オブジェクトを出す」で複製する）", wide: true, ...sp("prefab") }),
      toggleField({ label: "最初は隠す", ...sp("hidden") }),
      itemButtons("object"),
    ], { id: "cr-obj" }),
    section("位置と大きさ", [
      row(numberField({ label: "X", ...sp("x") }), numberField({ label: "Y", ...sp("y") })),
      row(numberField({ label: "幅", min: 1, ...sp("w") }), numberField({ label: "高さ", min: 1, ...sp("h") })),
      row(numberField({ label: "回転", unit: "°", ...sp("rotation") }), numberField({ label: "不透明度", min: 0, max: 1, step: 0.05, ...sp("opacity") })),
    ], { id: "cr-geo" }),
    section("見た目", lookFields, { id: "cr-look" }),
    section("物理", physics, { id: "cr-physics" }),
    section("動きと寿命", [
      row(selectField({ label: "いつもの動き", options: MOTIONS, ...sp("motion.type") }), numberField({ label: "速さ", min: 0.05, max: 20, step: 0.05, ...sp("motion.speed") })),
      numberField({ label: "動きの大きさ", min: 0, max: 500, ...sp("motion.amount") }),
      numberField({ label: "寿命", min: 0, max: 3600, step: 0.1, unit: "秒", hint: "出てから何秒で消えるか。0 ならずっと", ...sp("life") }),
      selectField({ label: "尾を引くエフェクト（ずっと出し続ける）", wide: true, options: () => [["", "なし"], ...effects], ...sp("trail") }),
    ], { id: "cr-motion" }),
  ];
}

// ===============================
// サウンド
// ===============================
/** 少しずつ違う音にする（sfxr の「ランダム」） */
function mutate(s) {
  const r = (v, k) => Math.max(20, Math.round(v * (1 + (Math.random() - 0.5) * k)));
  return { ...s, freq: r(s.freq, 0.6), freqEnd: r(s.freqEnd, 0.6), duration: Math.max(0.03, +(s.duration * (1 + (Math.random() - 0.5) * 0.5)).toFixed(2)) };
}

function soundFields(s) {
  const p = sp;
  const test = () => {
    const now = current();
    if (now.type === "file") {
      try { new Audio(now.url).play().catch(() => { }); } catch (e) { /* 鳴らせない */ }
    } else playSynth(now, 1);
  };
  const presets = h("select", {}, h("option", { value: "" }, "プリセットから…"), SOUND_PRESETS.map((x) => h("option", { value: x.key }, x.label)));
  presets.addEventListener("change", () => {
    const pr = SOUND_PRESETS.find((x) => x.key === presets.value);
    presets.value = "";
    if (!pr) return;
    const id = cstore.selection.id;
    change((gm) => {
      const t = findIn(gm, "sound", id);
      if (!t) return;
      for (const k of ["wave", "freq", "freqEnd", "duration", "attack", "sustain", "vibrato", "vibratoRate", "notes", "noteLength", "filter", "repeat", "volume"]) delete t[k];
      Object.assign(t, clone(pr.sound), { type: "synth" });
    });
    setTimeout(() => playSynth(current(), 1), 0);
  });
  const fields = [
    section("サウンド", [
      textField({ label: "名前", ...p("name") }),
      selectField({ label: "作り方", wide: true, options: [["synth", "🎛 その場で作る（シンセ）"], ["file", "📁 素材の音（MP3/WAV/OGG）"]], ...p("type") }),
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "btn primary", onclick: test }, "▶ 試聴"),
        s.type === "synth" ? presets : null,
        s.type === "synth" ? h("button", {
          type: "button", class: "small-btn", title: "少しずつ違う音にする",
          onclick: () => { const id = cstore.selection.id; change((gm) => { const t = findIn(gm, "sound", id); if (t) Object.assign(t, mutate(normalizeSound(t))); }); setTimeout(test, 0); },
        }, "🎲 ゆらす") : null),
      itemButtons("sound"),
    ], { id: "cr-snd" }),
  ];
  if (s.type === "file") {
    fields.push(section("素材", [assetField({ label: "音", kind: "audio", ...p("url") }), sliderField({ label: "音量", min: 0, max: 1, step: 0.05, ...p("volume") })], { id: "cr-snd-file" }));
    return fields;
  }
  fields.push(
    section("音色", [
      selectField({ label: "波形", wide: true, options: WAVES, ...p("wave") }),
      row(numberField({ label: "始めの高さ", min: 20, max: 12000, unit: "Hz", ...p("freq") }), numberField({ label: "終わりの高さ", min: 20, max: 12000, unit: "Hz", ...p("freqEnd") })),
      row(numberField({ label: "長さ", min: 0.02, max: 5, step: 0.01, unit: "秒", ...p("duration") }), numberField({ label: "繰り返し", min: 1, max: 8, ...p("repeat") })),
      sliderField({ label: "音量", min: 0, max: 1, step: 0.05, ...p("volume") }),
    ], { id: "cr-snd-tone" }),
    section("メロディ（入れると上の長さの代わりに音符ごとに鳴らす）", [
      textField({ label: "音符（C5 E5 G5 のように。- で休み）", placeholder: "C5 E5 G5 C6", ...p("notes") }),
      numberField({ label: "1音の長さ", min: 0.02, max: 2, step: 0.01, unit: "秒", ...p("noteLength") }),
    ], { id: "cr-snd-notes", open: !!s.notes }),
    section("音の形", [
      row(numberField({ label: "立ち上がり", min: 0, max: 2, step: 0.005, unit: "秒", ...p("attack") }), numberField({ label: "伸ばす割合", min: 0, max: 1, step: 0.05, ...p("sustain") })),
      row(numberField({ label: "ビブラートの深さ", min: 0, max: 2000, unit: "Hz", ...p("vibrato") }), numberField({ label: "ビブラートの速さ", min: 0.1, max: 60, step: 0.1, unit: "回/秒", ...p("vibratoRate") })),
      numberField({ label: "こもらせる（ローパス）", min: 0, max: 20000, unit: "Hz", hint: "0 ならそのまま。小さいほどこもった音", ...p("filter") }),
    ], { id: "cr-snd-env", open: false }),
  );
  return fields;
}

// ===============================
// エフェクト
// ===============================
function effectPreview() {
  const box = h("div", { class: "cr-fx-preview checker" });
  let player = null;
  const play = () => {
    const fx = current();
    if (!fx) return;
    player?.destroy();
    const def = { width: 480, height: 300, background: "#0b0b1a", gravity: 0, objects: [], graph: { nodes: [], links: [] }, sounds: [], variables: [], effects: [{ ...clone(fx), id: "p" }] };
    player = createPlayer(box, def, { mode: "play", clickable: false });
    player.world.playEffect("p", 240, Number(fx.angle) > 0 && Number(fx.areaW) > 400 ? 0 : 160);
  };
  const btn = h("button", { type: "button", class: "btn primary", onclick: play }, "▶ プレビュー");
  setTimeout(play, 50);
  return { el: h("div", { class: "fld wide" }, box, h("div", { class: "btn-row" }, btn)), sync() { } };
}

function colorsField() {
  const wrap = h("div", { class: "fld wide" }, h("span", { class: "fld-label" }, "色（このどれかがランダムに選ばれる）"));
  const list = h("div", { class: "cr-colors" });
  wrap.appendChild(list);
  const fields = [];
  const colors = current().colors || [];
  colors.forEach((c, i) => {
    const f = colorField({ label: "", ...sp(`colors.${i}`) });
    fields.push(f);
    list.appendChild(h("div", { class: "cr-color-row" }, f.el, h("button", {
      type: "button", class: "icon-btn", title: "この色を消す", disabled: colors.length <= 1 || null,
      onclick: () => { const id = cstore.selection.id; change((gm) => { const t = findIn(gm, "effect", id); if (t) t.colors = normalizeEffect(t).colors.filter((_, j) => j !== i); }); },
    }, "×")));
  });
  wrap.appendChild(h("button", {
    type: "button", class: "small-btn", disabled: colors.length >= 8 || null,
    onclick: () => { const id = cstore.selection.id; change((gm) => { const t = findIn(gm, "effect", id); if (t) t.colors = [...normalizeEffect(t).colors, "#ffffff"]; }); },
  }, "+ 色を追加"));
  return { el: wrap, sync() { fields.forEach((f) => f.sync()); } };
}

function effectFields(fx) {
  const p = sp;
  return [
    section("エフェクト", [
      textField({ label: "名前", ...p("name") }),
      effectPreview(),
      itemButtons("effect"),
    ], { id: "cr-fx" }),
    section("粒", [
      selectField({ label: "形", options: PARTICLE_SHAPES, ...p("shape") }),
      fx.shape === "emoji" ? textField({ label: "絵文字（空白区切りで複数）", ...p("emoji") }) : null,
      fx.shape === "image" ? assetField({ label: "画像", kind: "visual", ...p("src") }) : null,
      ["emoji", "image"].includes(fx.shape) ? null : colorsField(),
      row(numberField({ label: "大きさ（始め）", min: 0, max: 1000, ...p("size") }), numberField({ label: "大きさ（終わり）", min: 0, max: 1000, ...p("sizeEnd") })),
      row(numberField({ label: "光", min: 0, max: 100, ...p("glow") }), selectField({ label: "重ね方", options: [["normal", "ふつう"], ["lighter", "加算（光る）"]], ...p("blend") })),
      toggleField({ label: "消えるときにだんだん透明に", ...p("fade") }),
    ].filter(Boolean), { id: "cr-fx-look" }),
    section("出し方", [
      row(numberField({ label: "一度に出す数", min: 0, max: 500, ...p("count") }), numberField({ label: "出し続ける秒数", min: 0, max: 60, step: 0.1, unit: "秒", hint: "0 なら一度だけ。1 以上なら、その間「1秒に出す数」ずつ出す", ...p("duration") })),
      numberField({ label: "1秒に出す数（出し続けるとき・尾を引くとき）", min: 1, max: 1000, ...p("rate") }),
      row(numberField({ label: "出す範囲の幅", min: 0, max: 4096, ...p("areaW") }), numberField({ label: "出す範囲の高さ", min: 0, max: 4096, ...p("areaH") })),
    ], { id: "cr-fx-emit" }),
    section("動き", [
      row(numberField({ label: "向き", unit: "°", hint: "-90 で上、90 で下、0 で右", ...p("angle") }), numberField({ label: "広がり", min: 0, max: 360, unit: "°", ...p("spread") })),
      row(numberField({ label: "速さ", min: 0, max: 5000, ...p("speed") }), numberField({ label: "速さのばらつき", min: 0, max: 1, step: 0.05, ...p("speedVar") })),
      row(numberField({ label: "重力", ...p("gravity") }), numberField({ label: "空気の抵抗", min: 0, max: 20, step: 0.1, ...p("drag") })),
      row(numberField({ label: "寿命", min: 0.05, max: 30, step: 0.05, unit: "秒", ...p("life") }), numberField({ label: "寿命のばらつき", min: 0, max: 1, step: 0.05, ...p("lifeVar") })),
      numberField({ label: "回転", unit: "°/秒", ...p("spin") }),
    ], { id: "cr-fx-move" }),
  ];
}

// ===============================
// 変数
// ===============================
function variableFields(v) {
  const name = cstore.selection.id;
  const setVar = (key) => ({
    get: () => findIn(cstore.gimmick, "variable", name)?.[key],
    set: (val) => change((gm) => { const t = findIn(gm, "variable", name); if (t) t[key] = val; }, { coalesce: `var:${name}:${key}` }),
  });
  const isNum = typeof v.value === "number";
  return [
    section("変数", [
      h("div", { class: "fld wide" }, h("span", { class: "fld-label" }, "名前（式では " + v.name + " と書く。文字では {" + v.name + "}）"), h("code", { class: "cr-var-name" }, v.name)),
      selectField({
        label: "種類", options: [["number", "数"], ["text", "文字"]],
        get: () => (typeof findIn(cstore.gimmick, "variable", name)?.value === "number" ? "number" : "text"),
        set: (t) => change((gm) => { const x = findIn(gm, "variable", name); if (x) x.value = t === "number" ? Number(x.value) || 0 : String(x.value ?? ""); }),
      }),
      isNum ? numberField({ label: "始めの値", ...setVar("value") }) : textField({ label: "始めの値", ...setVar("value") }),
      toggleField({ label: "アーティストモードで変えられるようにする（パラメーター）", wide: true, ...setVar("exposed") }),
      v.exposed ? textField({ label: "アーティストモードでの見出し", placeholder: v.name, ...setVar("label") }) : null,
      h("p", { class: "hint" }, "パラメーターにすると、デザインに置いたギミックのプロパティで始めの値を変えられます（同じゲームを「目標 100」「目標 500」で使い分ける、など）。"),
      h("div", { class: "btn-row" }, h("button", {
        type: "button", class: "small-btn danger",
        onclick: async () => {
          if (!(await modal("変数を削除", h("p", {}, `変数「${v.name}」を削除します。`), { okText: "削除" }))) return;
          change((gm) => { gm.variables = gm.variables.filter((x) => x.name !== name); });
          selectC(null);
        },
      }, "削除")),
    ].filter(Boolean), { id: "cr-var" }),
  ];
}

// ===============================
// ブループリントのノード
// ===============================
const KIND_LABELS = { event: "🟥 イベント", action: "🟦 アクション", flow: "⬜ フロー", pure: "🟩 計算（ピュア）", var: "🔢 変数", entry: "🟪 入口・出口" };

function nodeFields(n) {
  const d = NODE_TYPES[n.type];
  if (!d) return [section("ノード", [h("p", { class: "hint" }, `知らない種類のノードです（${n.type}）。削除してください。`)], { id: "cr-node" })];
  const g = cstore.gimmick;
  const id = n.id;
  const set = (key) => (v) => change((gm) => {
    const x = graphFor(gm)?.nodes.find((y) => y.id === id);
    if (x) x.values = { ...(x.values || {}), [key]: v };
  }, { coalesce: `gn:${id}:${key}` });
  const controls = d.fields.map((f) => {
    const c = fieldControl(f, n, g, set(f.name), { large: true });
    return { el: c.inline ? h("div", { class: "fld wide" }, c.el) : h("label", { class: "fld wide" }, h("span", { class: "fld-label" }, f.label), c.el), sync: c.sync };
  });
  const { inputs, outputs } = pinsOf(n, g);
  const links = graphFor(g)?.links || [];
  const callee = (n.type === "call.function" || n.type === "call.macro") ? fnOf(g, n.values?.fn) : null;
  const pinRow = (p, dir) => {
    const on = links.some((l) => (dir === "in" ? l.to === id && l.toPin === p.name : l.from === id && l.fromPin === p.name));
    const dot = h("span", { class: `cr-pin-dot${p.type === "exec" ? " exec" : ""}${on ? " on" : ""}` });
    dot.style.setProperty("--pin", PIN_COLORS[p.type] || "#ccc");
    return h("div", { class: "cr-pin-row" }, dot, h("span", {}, p.label || (p.type === "exec" ? "実行" : p.name)),
      h("span", { class: "cr-pin-type" }, PIN_TYPE_LABELS[p.type] || p.type), p.self ? h("span", { class: "hint" }, "空なら自分") : null);
  };
  return [
    section(nodeTitle(n, g), [
      h("p", { class: "cr-node-kind" }, `${KIND_LABELS[nodeKind(n, g)] || d.kind}・${callee ? (callee.kind === "macro" ? "自作のマクロ" : callee.pure ? "自作のピュア関数" : "自作の関数") : d.category}`),
      h("p", { class: "cr-node-desc" }, (d.descOf?.(n, g)) || d.desc || ""),
      ...controls,
      callee ? h("div", { class: "btn-row" },
        h("button", { type: "button", class: "small-btn primary", onclick: () => emitC("openGraph", callee.id) }, "中身を開く"),
        h("button", { type: "button", class: "small-btn", onclick: () => selectC("function", callee.id) }, "入出力を変える")) : null,
    ].filter(Boolean), { id: "cr-node" }),
    section("ピン", [
      inputs.length ? h("h4", { class: "cr-pin-head" }, "入力（左）") : null,
      ...inputs.map((p) => pinRow(p, "in")),
      outputs.length ? h("h4", { class: "cr-pin-head" }, "出力（右）") : null,
      ...outputs.map((p) => pinRow(p, "out")),
      h("p", { class: "hint" }, "白い三角は実行の順番、色のついた丸は値です。つながっていない入力ピンは、ノードに書いた値を使います。"),
    ].filter(Boolean), { id: "cr-node-pins" }),
  ];
}

// ===============================
// 関数・マクロ（名前・説明・入力・出力）
// ===============================
const PARAM_TYPE_OPTIONS = (kind) => [...(kind === "macro" ? ["exec"] : []), ...PARAM_TYPES].map((t) => [t, PIN_TYPE_LABELS[t]]);

function functionFields(f) {
  const id = f.id;
  const kindLabel = FN_KIND_LABELS[f.kind];
  const edit = (fn, coalesce) => change((gm) => { const x = fnOf(gm, id); if (x) fn(gm, x); }, coalesce ? { coalesce } : {});
  const uses = callSites(cstore.gimmick, id);

  const paramList = (dir) => {
    const list = dir === "in" ? f.inputs : f.outputs;
    const rows = list.map((p, i) => {
      const dot = h("span", { class: `cr-pin-dot on${p.type === "exec" ? " exec" : ""}` });
      dot.style.setProperty("--pin", PIN_COLORS[p.type] || "#ccc");
      const name = h("input", { type: "text", class: "cr-param-name", value: p.name, maxlength: 40, placeholder: p.type === "exec" ? "（名前なし）" : "名前" });
      name.addEventListener("change", () => change((gm) => updateParam(gm, id, p.id, { name: name.value.trim() }), { coalesce: `fnp:${id}:${p.id}` }));
      name.addEventListener("keydown", (e) => { if (e.key === "Enter") name.blur(); });
      const type = h("select", { class: "cr-param-type", title: "種類（種類を変えると、合わなくなった線は外れます）" },
        PARAM_TYPE_OPTIONS(f.kind).map(([v, label]) => h("option", { value: v, selected: v === p.type }, label)));
      type.addEventListener("change", () => change((gm) => updateParam(gm, id, p.id, { type: type.value })));
      return h("div", { class: "cr-param" },
        dot, name, type,
        h("button", { type: "button", class: "icon-btn", title: "上へ", disabled: i === 0, onclick: () => change((gm) => moveParam(gm, id, p.id, -1)) }, "↑"),
        h("button", { type: "button", class: "icon-btn", title: "下へ", disabled: i === list.length - 1, onclick: () => change((gm) => moveParam(gm, id, p.id, 1)) }, "↓"),
        h("button", { type: "button", class: "icon-btn danger", title: "消す（つながっていた線も外れます）", onclick: () => change((gm) => removeParam(gm, id, p.id)) }, "✕"));
    });
    const add = (type) => change((gm) => { addParam(gm, id, dir, type); });
    return [
      ...rows,
      rows.length ? null : h("p", { class: "hint" }, dir === "in" ? "入力はありません。" : "出力はありません。"),
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "small-btn", disabled: list.length >= 16, onclick: () => add("number") }, dir === "in" ? "＋ 入力" : "＋ 出力"),
        f.kind === "macro" ? h("button", { type: "button", class: "small-btn", disabled: list.length >= 16, onclick: () => add("exec") }, dir === "in" ? "＋ 実行の入口" : "＋ 実行の出口") : null),
    ].filter(Boolean);
  };

  const nameField = textField({
    label: "名前",
    get: () => fnOf(cstore.gimmick, id)?.name,
    set: (v) => edit((gm, x) => { x.name = uniqueFnName(gm, v.trim().slice(0, 60) || kindLabel, id); }, `fn:${id}:name`),
  });
  const descField = textField({
    label: "説明（呼ぶノードを選んだときに出る）",
    multiline: true, rows: 2,
    get: () => fnOf(cstore.gimmick, id)?.desc,
    set: (v) => edit((gm, x) => { x.desc = v.slice(0, 300); }, `fn:${id}:desc`),
  });
  return [
    section(`${f.kind === "macro" ? "⇉" : "ƒ"} ${kindLabel}`, [
      nameField,
      descField,
      f.kind === "function" ? toggleField({
        label: "ピュア（実行ピンなし。値を読むたびに計算する）",
        get: () => !!fnOf(cstore.gimmick, id)?.pure,
        set: (v) => change((gm) => setPure(gm, id, v)),
      }) : null,
      h("p", { class: "hint" }, f.kind === "macro"
        ? "マクロは、呼んだ所に中身を広げたのと同じように動きます。実行の入口・出口を何本でも持て、中で「待つ」も使えます。「一度だけ」などは呼んだ場所ごとに別々に覚えます。"
        : f.pure
          ? "ピュア関数は計算ノード（緑）と同じで、つないだ先が値を読むたびに中身を計算します。"
          : "関数は、入力の値を受け取って中身を実行し、出口（Return）に着いたら出力の値を返します。中では「待つ」は使えません（待つならマクロに）。"),
      h("p", { class: "hint" }, uses ? `${uses} か所から呼んでいます。` : "まだどこからも呼んでいません。左の「マイブループリント」からグラフへドラッグすると、呼ぶノードを置けます。"),
      h("div", { class: "btn-row" },
        cstore.graphId === id ? null : h("button", { type: "button", class: "small-btn primary", onclick: () => emitC("openGraph", id) }, "中身を開く"),
        h("button", { type: "button", class: "small-btn", onclick: () => { let copy = null; change((gm) => { copy = duplicateFunction(gm, id); }); if (copy) selectC("function", copy.id); } }, "複製"),
        h("button", {
          type: "button", class: "small-btn danger",
          onclick: async () => {
            if (!(await modal(`${kindLabel}を削除`, h("p", {}, `「${f.name}」を削除します。${uses ? `呼んでいるノード ${uses} 個も一緒に消えます。` : ""}`), { okText: "削除" }))) return;
            const open = cstore.graphId === id;
            change((gm) => { deleteFunction(gm, id); });
            if (open) emitC("openGraph", null);
            selectC(null);
          },
        }, "削除")),
    ].filter(Boolean), { id: "cr-fn" }),
    section(f.kind === "macro" ? "入力（入口の右・呼ぶノードの左）" : "入力（入口の右・呼ぶノードの左）", paramList("in"), { id: "cr-fn-in" }),
    section("出力（出口の左・呼ぶノードの右）", paramList("out"), { id: "cr-fn-out" }),
  ];
}

// ===============================
// ギミック全体
// ===============================
function gimmickFields() {
  const g = cstore.gimmick;
  const signals = signalNames(g);
  return [
    section("ギミック", [
      textField({ label: "名前", ...gp("name") }),
      selectField({ label: "種類", options: Object.entries(GIMMICK_KIND_LABELS), ...gp("kind") }),
      textField({ label: "説明（アーティストモードの一覧に出る）", multiline: true, rows: 2, ...gp("description") }),
    ], { id: "cr-g" }),
    section("ステージ", [
      row(numberField({ label: "幅", min: 16, max: 4096, unit: "px", ...gp("width") }), numberField({ label: "高さ", min: 16, max: 4096, unit: "px", ...gp("height") })),
      h("div", { class: "btn-row" }, [["800×600", 800, 600], ["1920×1080", 1920, 1080], ["1080×1920", 1080, 1920], ["600×600", 600, 600]].map(([label, w, hh]) =>
        h("button", { type: "button", class: "small-btn", onclick: () => change((gm) => { gm.width = w; gm.height = hh; }) }, label))),
      toggleField({
        label: "背景を透明にする（配信画面に重ねる）",
        get: () => g.background === "transparent",
        set: (v) => change((gm) => { gm.background = v ? "transparent" : "#0b0b1a"; }),
      }),
      g.background !== "transparent" ? colorField({ label: "背景の色", ...gp("background") }) : null,
      numberField({ label: "重力", unit: "px/秒²", hint: "物理で動くオブジェクトが落ちる強さ（地球っぽいのは 1000〜1500）", ...gp("gravity") }),
    ].filter(Boolean), { id: "cr-stage" }),
    section("アーティストモードでの使い方", [
      h("p", { class: "hint" }, "アーティストモードのデザインで、左の「素材」→「ギミック」からこのギミックを置きます。"),
      h("p", { class: "hint" }, signals.length
        ? `イベントのルールの「🎮 ギミックに合図」で、次の合図を送れます：${signals.map((x) => `「${x}」`).join(" ")}`
        : "ブループリントに「合図を受けたとき」のノードを置くと、アーティストモードのルール（ギフト・コメント…）からこのギミックを動かせます。"),
      h("p", { class: "hint" }, "「🎁 ギフトが来たとき」などの TikTok LIVE のきっかけは、ルールを作らなくても配信のイベントでそのまま動きます。"),
    ], { id: "cr-howto" }),
  ];
}

// ===============================
// パネル本体
// ===============================
export function initCreatorInspector(panel) {
  let fields = [];
  let builtKey = null;

  const keyOf = () => {
    const s = cstore.selection;
    const c = current();
    if (!s || !c) return `g:${cstore.gimmick?.background === "transparent"}:${signalNames(cstore.gimmick || {}).join(",")}`;
    if (s.type === "object") return `o:${s.id}:${c.look.shape}:${c.body.type}:${cstore.gimmick.effects.length}`;
    if (s.type === "sound") return `s:${s.id}:${c.type}:${!!c.notes}`;
    if (s.type === "effect") return `e:${s.id}:${c.shape}:${(c.colors || []).length}`;
    if (s.type === "variable") return `v:${s.id}:${typeof c.value}:${c.exposed}`;
    if (s.type === "node") {
      const callee = fnOf(cstore.gimmick, c.values?.fn);
      return `n:${cstore.graphId}:${s.id}:${c.type}:${JSON.stringify([c.values?.at, c.values?.var, c.values?.outs, c.values?.fn, callee && [callee.name, callee.pure, callee.inputs, callee.outputs]])}:${(graphFor(cstore.gimmick)?.links || []).filter((l) => l.from === s.id || l.to === s.id).length}`;
    }
    if (s.type === "function") return `f:${s.id}:${cstore.graphId === s.id}:${JSON.stringify([c.kind, c.pure, c.inputs, c.outputs])}:${callSites(cstore.gimmick, s.id)}`;
    return `${s.type}:${s.id}`;
  };

  function build() {
    builtKey = keyOf();
    panel.textContent = "";
    fields = [];
    const s = cstore.selection;
    const c = current();
    if (!s || !c) fields = gimmickFields();
    else if (s.type === "node") fields = nodeFields(c);
    else if (s.type === "function") fields = functionFields(c);
    else if (s.type === "object") fields = objectFields(c);
    else if (s.type === "sound") fields = soundFields(c);
    else if (s.type === "effect") fields = effectFields(c);
    else if (s.type === "variable") fields = variableFields(c);
    const head = h("div", { class: "insp-head" }, h("span", { class: "insp-type" },
      !s || !c ? "⚙ ギミックの設定" : { object: "🧊 オブジェクト", sound: "🔊 サウンド", effect: "✨ エフェクト", variable: "🔢 変数", node: "🧩 ノード", function: c.kind === "macro" ? "⇉ マクロ" : "ƒ 関数" }[s.type]));
    panel.appendChild(head);
    for (const f of fields) panel.appendChild(f.el ?? f);
    sync();
  }

  function sync() {
    for (const f of fields) {
      try { f.sync?.(); } catch (e) { console.error(e); }
    }
  }

  onC((kind, detail) => {
    if (kind === "selection" || kind === "gimmick") {
      if (keyOf() !== builtKey || detail?.history) build();
      else sync();
    }
    if (kind === "focusField") {
      const t = panel.querySelector("textarea, input[type=text]");
      t?.focus();
    }
  });

  build();
  return { build };
}
