// public/js/studio/editor/inspector.js
// 右側の「デザイン」タブ：選んでいる要素のプロパティ。何も選んでいなければシーンの設定。
import { store, on, change, selected, live, endLive } from "./state.js";
import { align, distribute, ungroupSelection } from "./ops.js";
import { api } from "./api.js";
import { getAssets, onAssets, uploadFiles } from "./assets.js";
import {
  h, numberField, sliderField, selectField, toggleField, textField, colorField, paintField,
  section, row, toast, copyText, downloadJson,
} from "./ui.js";
import {
  normalizeElement, TYPE_META, GOOGLE_FONTS, SYSTEM_FONTS, BLEND_MODES, ENTER_ANIMS, LOOP_ANIMS,
  translate, scaleAbout, aabb, unionBox, isWidget, flatten, getPath, setPath,
} from "../shared/model.js";
import { STAT_OPTIONS } from "./constants.js";
import { overlayUrl } from "./me.js";
import { gimmickOptions, openInCreator } from "./gimmicks.js";
import { getGimmick } from "../shared/gimmick/registry.js";
import { signalNames } from "../shared/gimmick/defaults.js";
import { renderTemplate, buildContext } from "../shared/template.js";

/** 起動時に studio.js が渡すもの（キャンバスと、サーバーから届く値） */
let host = { canvas: null, getLive: () => ({ vars: {} }) };
const nodeOf = (id) => host.canvas?.renderer.node(id);

/** 1つ目の選択要素（既定値込み）から読む */
const first = () => {
  const el = selected()[0];
  return el ? normalizeElement(el) : null;
};

/** 選んでいる全要素に書く。opts.live のときはドラッグ中（履歴は離したときに1つ） */
function writer(path, filter = () => true) {
  return (value, opts = {}) => {
    const fn = () => {
      for (const el of selected()) if (filter(el)) setPath(el, path, value);
    };
    if (opts.live) live(fn);
    else {
      endLive();
      change(fn, { coalesce: path });
    }
  };
}

const prop = (path, filter) => ({ get: () => getPath(first(), path), set: writer(path, filter) });

export const FONT_OPTIONS = [
  ...GOOGLE_FONTS.map((f) => [f.family, f.jp ? `${f.family}（日本語）` : f.family]),
  ...SYSTEM_FONTS.map((f) => [f, `${f}（端末のフォント）`]),
];
const WEIGHTS = [[100, "100 極細"], [300, "300 細"], [400, "400 標準"], [500, "500 中"], [700, "700 太"], [800, "800 極太"], [900, "900 黒"]];

const STROKE_DASH = [["solid", "実線"], ["dashed", "破線"], ["dotted", "点線"]];

/** 素材の選択（素材一覧＋URL＋アップロード） */
export function assetField({ label, kind, get, set, special = [] }) {
  const sel = h("select", {});
  const url = h("input", { type: "text", placeholder: "https://… または素材を選択" });
  const up = h("input", { type: "file", accept: kind === "audio" ? "audio/*" : "image/*,video/webm,video/mp4", hidden: true });
  const upBtn = h("button", { type: "button", class: "small-btn", onclick: () => up.click() }, "アップロード");
  function fill() {
    const v = get() ?? "";
    sel.textContent = "";
    sel.appendChild(h("option", { value: "" }, "（なし）"));
    for (const [value, text] of special) sel.appendChild(h("option", { value }, text));
    for (const a of getAssets(kind === "audio" ? "audio" : "visual")) sel.appendChild(h("option", { value: a.url }, a.name));
    const known = [...sel.options].some((o) => o.value === v);
    sel.appendChild(h("option", { value: "__url" }, "URL を入力…"));
    sel.value = known ? v : "__url";
    url.hidden = known && v !== "__url";
    if (!known) url.value = v;
  }
  sel.addEventListener("change", () => {
    if (sel.value === "__url") { url.hidden = false; url.focus(); return; }
    set(sel.value);
  });
  url.addEventListener("change", () => set(url.value.trim()));
  up.addEventListener("change", async () => {
    const [res] = await uploadFiles([...up.files]);
    if (res?.error) toast(res.error, "error");
    else if (res) { set(res.url); toast("素材を追加しました"); }
    up.value = "";
  });
  const off = onAssets(() => { if (document.contains(sel)) fill(); else off(); });
  const el = h("label", { class: "fld wide" }, h("span", { class: "fld-label" }, label),
    h("span", { class: "asset-ctl" }, sel, upBtn), url, up);
  return { el, sync() { if (document.activeElement !== url) fill(); } };
}

function buttonRow(buttons) {
  return h("div", { class: "btn-row" }, buttons.map(([text, run, title]) =>
    h("button", { type: "button", class: "small-btn", title: title || text, onclick: run }, text)));
}

// ===============================
// 要素の種類ごとの欄
// ===============================
function strokeFields(withPaint = true) {
  return [
    withPaint ? paintField({ label: "線の色", allowNone: false, ...prop("stroke.paint") }) : null,
    row(
      numberField({ label: "線の太さ", min: 0, max: 400, ...prop("stroke.width") }),
      selectField({ label: "線の種類", options: STROKE_DASH, ...prop("stroke.dash") }),
    ),
  ].filter(Boolean);
}

function textFields() {
  return [
    textField({ label: "文字（{likes} などで値を差し込めます）", multiline: true, vars: true, ...prop("text") }),
    selectField({ label: "フォント", options: FONT_OPTIONS, wide: true, ...prop("font.family") }),
    row(
      numberField({ label: "サイズ", min: 4, max: 1000, unit: "px", ...prop("font.size") }),
      selectField({ label: "太さ", options: WEIGHTS, ...prop("font.weight") }),
    ),
    row(
      selectField({ label: "横揃え", options: [["left", "左"], ["center", "中央"], ["right", "右"]], ...prop("align") }),
      selectField({ label: "縦揃え", options: [["top", "上"], ["middle", "中央"], ["bottom", "下"]], ...prop("vAlign") }),
    ),
    row(
      numberField({ label: "字間", min: -50, max: 200, step: 0.5, unit: "px", ...prop("letterSpacing") }),
      numberField({ label: "行間", min: 0.5, max: 4, step: 0.05, ...prop("lineHeight") }),
    ),
    row(
      toggleField({ label: "斜体", ...prop("font.italic") }),
      selectField({ label: "大文字", options: [["none", "そのまま"], ["uppercase", "ABC"], ["lowercase", "abc"]], ...prop("textTransform") }),
    ),
    paintField({ label: "文字の色", allowNone: false, ...prop("fill") }),
    colorField({ label: "縁取りの色", ...prop("outline.color") }),
    numberField({ label: "縁取りの太さ", min: 0, max: 60, step: 0.5, unit: "px", ...prop("outline.width") }),
  ];
}

const TIMER_FORMATS = [["auto", "自動（1時間以上で h:mm:ss）"], ["hh:mm:ss", "hh:mm:ss"], ["mm:ss", "mm:ss"], ["ss", "秒だけ"]];

/**
 * ギミック枠のパラメーターと合図のボタン。選んだギミックで欄が変わるので、
 * sync のたびに「どのギミックか」を見て、変わっていれば中身を作り直す。
 */
function gimmickDetails() {
  const box = h("div", { class: "fld wide" });
  let builtFor = null;
  let inner = [];
  function build(el, def) {
    box.textContent = "";
    inner = [];
    if (!def) {
      box.appendChild(h("p", { class: "hint" }, el.cfg.gimmickId ? "このギミックは見つかりません（クリエイターモードで消されたかもしれません）" : "上で置くギミックを選びます。"));
      return;
    }
    if (def.description) box.appendChild(h("p", { class: "hint" }, def.description));
    const params = (def.variables || []).filter((v) => v.exposed);
    if (params.length) {
      box.appendChild(h("h4", { class: "fld-label" }, "パラメーター（このデザインでの始めの値）"));
      for (const v of params) {
        const isNum = typeof v.value === "number";
        const get = () => {
          const o = (first()?.cfg?.vars || []).find((x) => x.name === v.name);
          return o ? o.value : v.value;
        };
        const set = (value) => {
          const list = (first()?.cfg?.vars || []).filter((x) => x.name !== v.name);
          if (value !== v.value && value !== "") list.push({ name: v.name, value });
          writer("cfg.vars", (e) => e.type === "gimmick")(list);
        };
        const f = isNum ? numberField({ label: v.label || v.name, get, set }) : textField({ label: v.label || v.name, get, set });
        inner.push(f);
        box.appendChild(f.el);
      }
    }
    const signals = signalNames(def);
    box.appendChild(h("h4", { class: "fld-label" }, "合図を送って試す"));
    if (signals.length) {
      box.appendChild(h("div", { class: "gm-signal-row" }, signals.map((name) => h("button", {
        type: "button", class: "small-btn",
        onclick: () => {
          const n = nodeOf(el.id);
          const ev = { type: "gift", user: { name: "テスト視聴者", avatar: "" }, gift: { name: "ローズ", picture: "" }, count: 1, coins: 1, text: "" };
          if (!n?.widget?.signal?.(name, ev)) toast("動きませんでした（条件を満たしていないかもしれません）");
        },
      }, `📡 ${name}`))));
      box.appendChild(h("p", { class: "hint" }, "配信で動かすには、「イベント」タブのルールに「🎮 ギミックに合図」を足します。"));
    } else {
      box.appendChild(h("p", { class: "hint" }, "このギミックには「📡 合図を受けたとき」のイベントがありません。ギフトなどのきっかけはギミックの中で決まっています。"));
    }
    box.appendChild(h("div", { class: "btn-row" },
      h("button", { type: "button", class: "small-btn", onclick: () => nodeOf(el.id)?.widget?.restart?.() }, "⟲ 最初から"),
      h("button", {
        type: "button", class: "small-btn", title: "ギミックのステージと同じ縦横比にする",
        onclick: () => writer("h", (e) => e.type === "gimmick")(Math.round(first().w * (def.height / def.width))),
      }, "縦横比を合わせる"),
      h("button", { type: "button", class: "small-btn primary", onclick: () => openInCreator(def.id) }, "🛠 クリエイターモードで編集 ↗")));
  }
  return {
    el: box,
    sync() {
      const el = first();
      if (!el) return;
      const def = getGimmick(el.cfg?.gimmickId);
      const key = `${el.id}:${el.cfg?.gimmickId}:${def ? JSON.stringify([def.updatedAt, def.variables, signalNames(def)]) : "-"}`;
      if (key !== builtFor) {
        builtFor = key;
        build(el, def);
      }
      inner.forEach((f) => f.sync());
    },
  };
}

function widgetFields(type) {
  const c = (k) => prop(`cfg.${k}`);
  const fontRow = (sizeKey = "fontSize") => [
    selectField({ label: "フォント", options: FONT_OPTIONS, wide: true, ...c("fontFamily") }),
    numberField({ label: "文字の大きさ", min: 6, max: 400, unit: "px", ...c(sizeKey) }),
  ];
  switch (type) {
    case "gimmick":
      return [
        selectField({
          label: "置くギミック", wide: true, ...c("gimmickId"),
          options: () => [["", "（選ぶ）"], ...gimmickOptions()],
          set: (v) => writer("cfg.gimmickId")(v),
        }),
        toggleField({ label: "配信のイベント（ギフト・コメント…）をギミックにそのまま渡す", wide: true, ...c("live") }),
        gimmickDetails(),
      ];
    case "chat":
      return [
        row(numberField({ label: "表示する数", min: 1, max: 50, ...c("limit") }),
          selectField({ label: "新しいもの", options: [["bottom", "下に追加"], ["top", "上に追加"]], ...c("newest") })),
        ...fontRow(),
        row(toggleField({ label: "アイコン", ...c("showAvatar") }), toggleField({ label: "名前", ...c("showName") })),
        colorField({ label: "名前の色", ...c("nameColor") }),
        colorField({ label: "文字の色", ...c("textColor") }),
        colorField({ label: "吹き出しの色", ...c("bubble") }),
        row(numberField({ label: "角丸", min: 0, max: 100, ...c("radius") }), numberField({ label: "間隔", min: 0, max: 80, ...c("gap") })),
        row(numberField({ label: "縁取り", min: 0, max: 20, step: 0.5, ...c("outline") }),
          numberField({ label: "消えるまで", min: 0, max: 600, unit: "秒", hint: "0 なら消えない", ...c("fade") })),
      ];
    case "danmaku":
      return [
        ...fontRow(),
        row(selectField({ label: "太さ", options: WEIGHTS, ...c("weight") }),
          numberField({ label: "流れる秒数", min: 2, max: 30, step: 0.5, ...c("speed") })),
        colorField({ label: "文字の色", ...c("color") }),
        colorField({ label: "縁取りの色", ...c("outlineColor") }),
        row(numberField({ label: "縁取り", min: 0, max: 20, step: 0.5, ...c("outline") }), toggleField({ label: "名前も流す", ...c("showName") })),
      ];
    case "alert":
      return [
        h("p", { class: "hint" }, "アラートは「イベント」タブのルールで出します。ここは既定の見た目と文言です。"),
        textField({ label: "見出し", vars: "event", ...c("title") }),
        textField({ label: "メッセージ", vars: "event", ...c("message") }),
        assetField({
          label: "画像・動画", kind: "visual", ...c("image"),
          special: [["avatar", "👤 その人のアイコン"], ["gift", "🎁 ギフトの画像"]],
        }),
        numberField({ label: "画像の大きさ", min: 20, max: 1000, unit: "px", ...c("imageSize") }),
        selectField({ label: "フォント", options: FONT_OPTIONS, wide: true, ...c("fontFamily") }),
        row(numberField({ label: "見出し", min: 6, max: 400, unit: "px", ...c("titleSize") }),
          numberField({ label: "メッセージ", min: 6, max: 400, unit: "px", ...c("messageSize") })),
        colorField({ label: "見出しの色", ...c("titleColor") }),
        colorField({ label: "メッセージの色", ...c("messageColor") }),
        toggleField({ label: "背景の箱を出す", ...c("showBox") }),
        colorField({ label: "箱の色", ...c("bg") }),
        colorField({ label: "枠の色", ...c("accent") }),
        row(numberField({ label: "角丸", min: 0, max: 200, ...c("radius") }), numberField({ label: "縁取り", min: 0, max: 20, step: 0.5, ...c("outline") })),
        row(numberField({ label: "表示秒数", min: 1, max: 60, ...c("duration") }),
          selectField({ label: "出方", options: ENTER_ANIMS.filter(([v]) => v !== "none"), ...c("enter") })),
        buttonRow([["▶ 見本を流す", () => previewAlert(first())]]),
      ];
    case "goal":
      return [
        selectField({
          label: "数える値", wide: true,
          options: () => [...STAT_OPTIONS, ...Object.keys(host.getLive().vars?.counters || {}).map((k) => [k, `カウンター: ${k}`])],
          ...c("source"),
        }),
        numberField({ label: "目標", min: 1, max: 1e12, ...c("target") }),
        textField({ label: "見出し", vars: true, ...c("label") }),
        textField({ label: "数字の書き方（{value} {target} {percent}）", ...c("format") }),
        textField({ label: "達成したときの見出し", ...c("doneText") }),
        selectField({ label: "形", options: [["bar", "バー"], ["ring", "リング"]], ...c("shape") }),
        ...fontRow(),
        colorField({ label: "文字の色", ...c("textColor") }),
        paintField({ label: "ゲージの色", allowNone: false, ...c("bar") }),
        colorField({ label: "ゲージの下地", ...c("track") }),
        row(numberField({ label: "角丸", min: 0, max: 999, ...c("radius") }),
          numberField({ label: "太さ", min: 0.05, max: 1, step: 0.05, ...c("thickness") })),
      ];
    case "leaderboard":
      return [
        textField({ label: "見出し", ...c("title") }),
        row(numberField({ label: "人数", min: 1, max: 20, ...c("limit") }), toggleField({ label: "アイコン", ...c("showAvatar") })),
        ...fontRow(),
        colorField({ label: "文字の色", ...c("textColor") }),
        colorField({ label: "強調の色", ...c("accent") }),
        colorField({ label: "背景", ...c("bg") }),
        numberField({ label: "角丸", min: 0, max: 200, ...c("radius") }),
      ];
    case "events":
      return [
        textField({ label: "出す種類（follow,gift,share,envelope,join）", ...c("types") }),
        row(numberField({ label: "表示する数", min: 1, max: 30, ...c("limit") }),
          selectField({ label: "並び", options: [["column", "縦"], ["row", "横"]], ...c("direction") })),
        ...fontRow(),
        colorField({ label: "文字の色", ...c("textColor") }),
        colorField({ label: "背景", ...c("bg") }),
        numberField({ label: "角丸", min: 0, max: 200, ...c("radius") }),
        textField({ label: "フォローの文", vars: "event", ...c("followText") }),
        textField({ label: "ギフトの文", vars: "event", ...c("giftText") }),
        textField({ label: "シェアの文", vars: "event", ...c("shareText") }),
        textField({ label: "宝箱の文", vars: "event", ...c("envelopeText") }),
      ];
    case "timer": {
      const timerOp = (op, value = 0) => async () => {
        const name = first()?.cfg?.name;
        try { await api.setVar({ kind: "timer", name, op, value }); } catch (e) { toast("タイマーの名前が使えません（英数字・日本語、予約語以外）", "error"); }
      };
      return [
        textField({ label: "タイマーの名前（ルールの「タイマー」と同じ名前）", list: "studio-var-names", ...c("name") }),
        buttonRow([
          ["▶ 開始", timerOp("start")], ["⏸ 停止", timerOp("pause")], ["+1分", timerOp("add", 60)],
          ["+10分", timerOp("add", 600)], ["⟲ 0に", timerOp("reset")],
        ]),
        selectField({ label: "表示の形", options: TIMER_FORMATS, wide: true, ...c("format") }),
        textField({ label: "上に出す見出し", ...c("label") }),
        textField({ label: "0 になったときの文字", ...c("endText") }),
        ...fontRow(),
        row(selectField({ label: "太さ", options: WEIGHTS, ...c("weight") }), numberField({ label: "縁取り", min: 0, max: 20, step: 0.5, ...c("outline") })),
        colorField({ label: "文字の色", ...c("color") }),
        colorField({ label: "縁取りの色", ...c("outlineColor") }),
      ];
    }
    default:
      return [];
  }
}

function typeFields(type) {
  switch (type) {
    case "rect":
      return [
        section("塗り", [paintField({ label: "", ...prop("fill") })], { id: "fill" }),
        section("線", strokeFields(), { id: "stroke" }),
        section("角", [sliderField({ label: "角丸", min: 0, max: 500, ...prop("radius") })], { id: "corner" }),
      ];
    case "ellipse":
      return [
        section("塗り", [paintField({ label: "", ...prop("fill") })], { id: "fill" }),
        section("線", strokeFields(), { id: "stroke" }),
      ];
    case "polygon":
      return [
        section("形", [
          row(numberField({ label: "角の数", min: 3, max: 40, ...prop("sides") }), toggleField({ label: "星形", ...prop("star") })),
          sliderField({ label: "星のへこみ", min: 0.05, max: 0.95, step: 0.01, ...prop("innerRatio") }),
        ], { id: "poly" }),
        section("塗り", [paintField({ label: "", ...prop("fill") })], { id: "fill" }),
        section("線", strokeFields(), { id: "stroke" }),
      ];
    case "path":
      return [
        section("パス", [
          toggleField({ label: "閉じる（塗れる形にする）", ...prop("path.closed") }),
          buttonRow([["✎ 点を編集", () => { const id = selected()[0]?.id; if (id) host.canvas?.enterNodeEdit(id); }, "ダブルクリックでも編集できます"]]),
          h("p", { class: "hint" }, "点を編集：点をドラッグ／Alt+クリックで角⇔なめらか／Delete で点を消す／Esc で終了"),
        ], { id: "path" }),
        section("塗り", [paintField({ label: "", ...prop("fill") })], { id: "fill" }),
        section("線", [
          ...strokeFields(),
          row(
            selectField({ label: "線端", options: [["round", "丸"], ["butt", "平ら"], ["square", "四角"]], ...prop("stroke.cap") }),
            selectField({ label: "角", options: [["round", "丸"], ["miter", "とがり"], ["bevel", "面取り"]], ...prop("stroke.join") }),
          ),
        ], { id: "stroke" }),
      ];
    case "text":
      return [section("テキスト", textFields(), { id: "text" })];
    case "image":
      return [
        section("画像", [
          assetField({ label: "画像・動画（WebM は透過も可）", kind: "visual", ...prop("src") }),
          selectField({ label: "はめ方", options: [["cover", "はみ出しを切る"], ["contain", "全体を収める"], ["fill", "引き伸ばす"]], ...prop("fit") }),
          sliderField({ label: "角丸", min: 0, max: 500, ...prop("radius") }),
          colorField({ label: "枠の色", ...prop("stroke.paint.color") }),
          numberField({ label: "枠の太さ", min: 0, max: 100, ...prop("stroke.width") }),
        ], { id: "image" }),
      ];
    case "group":
      return [section("グループ", [buttonRow([["グループ解除", ungroupSelection]]),
        h("p", { class: "hint" }, "ダブルクリックで中の要素を選べます")], { id: "group" })];
    default:
      if (isWidget(type)) return [section(`${TYPE_META[type].label}の設定`, widgetFields(type), { id: `w-${type}` })];
      return [];
  }
}

// ===============================
// 共通の欄
// ===============================
function geometryFields() {
  const els = () => selected();
  const box = () => {
    const list = els();
    if (list.length === 1) return list[0];
    return unionBox(list.map(aabb));
  };
  const setGeom = (key) => (value, opts = {}) => {
    const fn = () => {
      for (const el of els()) {
        if (key === "x") translate(el, value - el.x, 0);
        else if (key === "y") translate(el, 0, value - el.y);
        else if (key === "rotation") el.rotation = value;
        else if (el.type === "group") {
          const s = value / (key === "w" ? el.w : el.h);
          scaleAbout(el, el.x, el.y, key === "w" ? s : 1, key === "h" ? s : 1);
        } else el[key] = Math.max(1, value);
      }
    };
    if (opts.live) live(fn);
    else { endLive(); change(fn, { coalesce: `geom-${key}` }); }
  };
  const single = selected().length === 1;
  return section("配置", [
    single ? row(
      numberField({ label: "X", get: () => Math.round(box().x * 10) / 10, set: setGeom("x") }),
      numberField({ label: "Y", get: () => Math.round(box().y * 10) / 10, set: setGeom("y") }),
    ) : null,
    single ? row(
      numberField({ label: "幅", min: 1, get: () => Math.round(box().w * 10) / 10, set: setGeom("w") }),
      numberField({ label: "高さ", min: 1, get: () => Math.round(box().h * 10) / 10, set: setGeom("h") }),
    ) : null,
    single && selected()[0].type !== "group"
      ? numberField({ label: "回転", unit: "°", min: -360, max: 360, get: () => box().rotation || 0, set: setGeom("rotation") })
      : null,
    h("div", { class: "align-grid" },
      [["left", "⇤", "左揃え"], ["center", "↔", "左右中央"], ["right", "⇥", "右揃え"],
        ["top", "⤒", "上揃え"], ["middle", "↕", "上下中央"], ["bottom", "⤓", "下揃え"]]
        .map(([how, label, title]) => h("button", { type: "button", class: "icon-btn", title: `${title}${single ? "（キャンバスに）" : ""}`, onclick: () => align(how) }, label))),
    selected().length >= 3 ? buttonRow([["横に等間隔", () => distribute("h")], ["縦に等間隔", () => distribute("v")]]) : null,
  ].filter(Boolean), { id: "geom" });
}

function appearanceFields() {
  return section("レイヤー", [
    sliderField({ label: "不透明度", min: 0, max: 1, step: 0.01, ...prop("opacity") }),
    selectField({ label: "描画モード", options: BLEND_MODES, wide: true, ...prop("blend") }),
    toggleField({ label: "配信画面では最初は隠す（ルールで表示）", wide: true, ...prop("startHidden") }),
  ], { id: "layer" });
}

function effectFields() {
  return section("効果", [
    toggleField({ label: "ドロップシャドウ", ...prop("shadow.enabled") }),
    row(numberField({ label: "影 X", min: -500, max: 500, ...prop("shadow.x") }), numberField({ label: "影 Y", min: -500, max: 500, ...prop("shadow.y") })),
    numberField({ label: "影のぼかし", min: 0, max: 300, ...prop("shadow.blur") }),
    colorField({ label: "影の色", ...prop("shadow.color") }),
    sliderField({ label: "ぼかし", min: 0, max: 60, step: 0.5, unit: "px", ...prop("filters.blur") }),
    sliderField({ label: "明るさ", min: 0, max: 300, unit: "%", ...prop("filters.brightness") }),
    sliderField({ label: "コントラスト", min: 0, max: 300, unit: "%", ...prop("filters.contrast") }),
    sliderField({ label: "彩度", min: 0, max: 300, unit: "%", ...prop("filters.saturate") }),
    sliderField({ label: "色相", min: -180, max: 180, unit: "°", ...prop("filters.hue") }),
    sliderField({ label: "モノクロ", min: 0, max: 100, unit: "%", ...prop("filters.grayscale") }),
    sliderField({ label: "反転", min: 0, max: 100, unit: "%", ...prop("filters.invert") }),
  ], { id: "fx", open: false });
}

function animationFields() {
  return section("アニメーション", [
    selectField({ label: "登場", options: ENTER_ANIMS, ...prop("anim.enter") }),
    row(numberField({ label: "長さ", min: 0.1, max: 10, step: 0.1, unit: "秒", ...prop("anim.enterDuration") }),
      numberField({ label: "遅れ", min: 0, max: 30, step: 0.1, unit: "秒", ...prop("anim.enterDelay") })),
    buttonRow([["▶ 登場を再生", () => selected().forEach((el) => host.canvas?.renderer.playEnter(el.id))]]),
    selectField({ label: "ループ", options: LOOP_ANIMS, ...prop("anim.loop") }),
    numberField({ label: "ループの周期", min: 0.2, max: 30, step: 0.1, unit: "秒", ...prop("anim.loopDuration") }),
  ], { id: "anim", open: false });
}

// ===============================
// シーンの設定（何も選んでいないとき）
// ===============================
export const SIZE_PRESETS = [
  ["1920x1080", "横 1920×1080（YouTube・Twitch・OBS 標準）"],
  ["1080x1920", "縦 1080×1920（TikTok・ショート）"],
  ["1280x720", "横 1280×720"],
  ["2560x1440", "横 2560×1440"],
  ["720x1280", "縦 720×1280"],
  ["1080x1080", "正方形 1080×1080"],
  ["800x600", "パネル 800×600"],
];

function sceneFields() {
  const s = () => store.scene;
  const setScene = (key) => (v) => change((scene) => { scene[key] = v; }, { coalesce: `scene-${key}` });
  const url = () => overlayUrl(store.scene.id);
  const urlBox = h("input", { type: "text", readonly: true, class: "url-box" });
  return [
    section("デザイン", [
      textField({ label: "名前", get: () => s().name, set: setScene("name") }),
      selectField({
        label: "サイズのプリセット", wide: true,
        options: [["", "選ぶ…"], ...SIZE_PRESETS],
        get: () => "",
        set: (v) => {
          if (!v) return;
          const [w, hh] = v.split("x").map(Number);
          change((scene) => { scene.width = w; scene.height = hh; });
          host.canvas?.fit();
        },
      }),
      row(
        numberField({ label: "幅", min: 16, max: 8192, unit: "px", get: () => s().width, set: setScene("width") }),
        numberField({ label: "高さ", min: 16, max: 8192, unit: "px", get: () => s().height, set: setScene("height") }),
      ),
      toggleField({
        label: "背景を透明にする（OBS で下のゲーム画面が見える）", wide: true,
        get: () => s().background === "transparent",
        set: (v) => change((scene) => { scene.background = v ? "transparent" : "#101020"; }),
      }),
      colorField({ label: "背景色", get: () => s().background, set: setScene("background") }),
    ], { id: "scene" }),
    section("OBS に貼る", [
      h("p", { class: "hint" }, "OBS の「ブラウザ」ソース、または TikTok LIVE Studio の「リンク」ソースにこの URL を最後まで全部貼り、幅と高さをデザインと同じにします。保存するとその場で反映されます。URL には合鍵が入っているので、人に見せないでください。"),
      { el: urlBox, sync() { urlBox.value = url(); } },
      buttonRow([
        ["URL をコピー", () => copyText(url(), "コピーしました")],
        ["新しいタブで開く", () => window.open(`${url()}&bg=1`, "_blank")],
      ]),
    ], { id: "obs" }),
    section("書き出し・読み込み", [
      buttonRow([
        ["JSON を書き出す", () => downloadJson(`${store.scene.name || "design"}.livedesign.json`, store.scene)],
        ["JSON を読み込む", () => {
          const input = h("input", { type: "file", accept: ".json,application/json" });
          input.addEventListener("change", async () => {
            try {
              const data = JSON.parse(await input.files[0].text());
              if (!Array.isArray(data.elements)) throw new Error("形式が違います");
              change((scene) => {
                Object.assign(scene, {
                  name: data.name || scene.name, width: data.width || scene.width, height: data.height || scene.height,
                  background: data.background ?? scene.background, elements: data.elements, rules: data.rules || [],
                });
              });
              host.canvas?.fit();
              toast("読み込みました");
            } catch (e) { toast(`読み込めませんでした: ${e.message}`, "error"); }
          });
          input.click();
        }],
      ]),
    ], { id: "io", open: false }),
    section("このデザインの中身", [{
      el: h("p", { class: "hint stats-line" }),
      sync() {
        const all = flatten(store.scene.elements);
        this.el.textContent = `要素 ${all.length} 個・ルール ${store.scene.rules.length} 件`;
      },
    }], { id: "summary" }),
  ];
}

// ===============================
// パネル本体
// ===============================
/** アラート枠の「見本を流す」（見本の視聴者で、いまの見出しとメッセージを出す） */
function previewAlert(el) {
  const n = el && nodeOf(el.id);
  if (!n?.widget?.enqueue) return;
  const cfg = el.cfg;
  const ev = { type: "follow", user: { name: "テスト視聴者", avatar: "" }, gift: { name: "ローズ", picture: "" }, count: 1, coins: 1 };
  const ctx = buildContext(host.getLive().vars, ev);
  n.widget.enqueue({
    title: renderTemplate(cfg.title, ctx), message: renderTemplate(cfg.message, ctx),
    image: ["avatar", "gift"].includes(cfg.image) ? "" : cfg.image, duration: cfg.duration,
  });
}

/**
 * @param {HTMLElement} panel
 * @param {{canvas: object, getLive: () => object}} deps キャンバス（要素を動かす・表示を合わせる）とライブの値
 */
export function initInspector(panel, deps) {
  host = deps;
  let fields = [];
  let builtKey = null;

  function build() {
    panel.textContent = "";
    fields = [];
    if (!store.scene) return;
    const els = selected();
    if (els.length === 0) {
      fields = sceneFields();
    } else {
      const types = [...new Set(els.map((e) => e.type))];
      const head = h("div", { class: "insp-head" },
        h("span", { class: "insp-type" }, els.length === 1 ? TYPE_META[els[0].type]?.label ?? els[0].type : `${els.length} 個を選択中`));
      panel.appendChild(head);
      if (els.length === 1) {
        fields.push(textField({ label: "レイヤー名", wide: true, ...prop("name") }));
      }
      fields.push(geometryFields(), appearanceFields());
      // 同じ種類だけを選んでいるときは、その種類の欄も出す（まとめて色を変えるなど）
      if (types.length === 1) fields.push(...typeFields(types[0]));
      fields.push(effectFields(), animationFields());
    }
    for (const f of fields) panel.appendChild(f.el);
    sync();
  }

  function sync() {
    for (const f of fields) {
      try { f.sync?.(); } catch (e) { console.error(e); }
    }
  }

  const keyOf = () => `${store.selection.join(",")}|${selected().map((e) => e.type).join(",")}`;

  on((kind, detail) => {
    if (kind === "selection" || (kind === "scene" && detail?.history)) {
      const k = keyOf();
      if (k !== builtKey) { builtKey = k; build(); return; }
    }
    if (kind === "scene") {
      const k = keyOf();
      if (k !== builtKey) { builtKey = k; build(); } else sync();
    }
  });

  return { build, sync };
}
