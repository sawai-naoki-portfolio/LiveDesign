// public/js/studio/creator/templatekit.js
// テンプレートを組む小道具（templates.js と minigames.js が使う）。
//   sound("coin") / effect("burst", {...}) / obj({...}) … アセットとオブジェクト（id を振る）
//   blueprint(g) … ブループリントをまとまり（コメントで囲む行）ごとに組む
import { uid } from "../shared/model.js";
import { EFFECT_PRESETS } from "../shared/gimmick/defaults.js";
import { SOUND_PRESETS } from "../shared/gimmick/synth.js";
import { NODE_TYPES, newNode, pinsOf } from "../shared/gimmick/nodes.js";

export const sound = (key, name) => {
  const p = SOUND_PRESETS.find((x) => x.key === key);
  return { id: uid("snd"), type: "synth", ...p.sound, name: name || p.label.replace(/^\S+\s/, "") };
};
export const effect = (key, props = {}, name) => {
  const p = EFFECT_PRESETS.find((x) => x.key === key);
  return { id: uid("fx"), ...p.effect, ...props, name: name || p.label.replace(/^\S+\s/, "") };
};
export const obj = (props) => ({ id: uid("obj"), ...props });

// ===============================
// ブループリントを組む小道具
// ===============================
const COL = 300;       // 横に並べる間隔
const ROW_GAP = 90;    // まとまり（コメント）の間

/** ノードの大きさの見積もり（コメントで囲む大きさを決めるのに使う。画面で測るほど正確でなくてよい） */
function sizeOf(node, g) {
  const d = NODE_TYPES[node.type];
  const { inputs, outputs } = pinsOf(node, g);
  const fields = d.fields.filter((f) => f.onNode !== false).length;
  if (d.compact) return { w: 130, h: 26 * Math.max(inputs.length, outputs.length) + 16 };
  return { w: fields ? 290 : 240, h: 40 + fields * 30 + (fields ? 10 : 0) + 26 * Math.max(inputs.length, outputs.length) + 14 };
}

/**
 * まとまり（行）ごとにノードを置いていく。
 *   const r = b.row("見出し");  r.n("event.gift", 0, 0) … 列 0・行の中で 0px の高さに置く
 *   b.go(a, b, c)            … 実行ピンでつなぐ（[node, "pin"] で出口を選べる）
 *   b.wire(a, "count", b, "x") … データピンでつなぐ
 *   b.fn({kind, name, inputs, outputs}) … 自作の関数・マクロ。返り値の f.row() で中身を同じように組む
 *                                          （入出力の id は p1, p2 … の順。入口・出口のノードは r.n("fn.entry") などで置く）
 */
function graphBuilder(g, out, fnId = null) {
  let cursor = 0;
  return {
    row(text, color = "#ffffff") {
      const top = cursor + 50;
      const mine = [];
      const r = {
        n(type, col, dy, values = {}) {
          const node = newNode(type, col * COL, top + dy, NODE_TYPES[type].inner ? { ...values, fn: fnId } : values, uid("n"));
          out.nodes.push(node);
          mine.push(node);
          return node;
        },
        end() {
          const boxes = mine.map((n) => ({ ...sizeOf(n, g), x: n.x, y: n.y }));
          const x0 = Math.min(...boxes.map((x) => x.x)) - 30;
          const y0 = Math.min(...boxes.map((x) => x.y)) - 54;
          const x1 = Math.max(...boxes.map((x) => x.x + x.w)) + 30;
          const y1 = Math.max(...boxes.map((x) => x.y + x.h)) + 30;
          out.comments.push({ id: uid("cm"), x: x0, y: y0, w: x1 - x0, h: y1 - y0, text, color });
          cursor = y1 + ROW_GAP;
        },
      };
      return r;
    },
    go(...chain) {
      for (let i = 0; i < chain.length - 1; i++) {
        const [a, pin] = Array.isArray(chain[i]) ? chain[i] : [chain[i], "then"];
        const [next, toPin] = Array.isArray(chain[i + 1]) && chain[i + 1][2] ? [chain[i + 1][0], chain[i + 1][2]] : [Array.isArray(chain[i + 1]) ? chain[i + 1][0] : chain[i + 1], "exec"];
        out.links.push({ from: a.id, fromPin: pin, to: next.id, toPin });
      }
    },
    wire(a, aPin, to, toPin) { out.links.push({ from: a.id, fromPin: aPin, to: to.id, toPin }); },
  };
}

export function blueprint(g) {
  const main = { nodes: [], links: [], comments: [] };
  g.functions = [];
  return {
    ...graphBuilder(g, main),
    fn({ kind = "function", name, desc = "", pure = false, inputs = [], outputs = [] }) {
      const f = { id: uid("fn"), name, kind, pure, desc, inputs: [], outputs: [], graph: { nodes: [], links: [], comments: [] } };
      let i = 1;
      for (const [pname, type] of inputs) f.inputs.push({ id: `p${i++}`, name: pname, type });
      for (const [pname, type] of outputs) f.outputs.push({ id: `p${i++}`, name: pname, type });
      g.functions.push(f);
      return { f, ...graphBuilder(g, f.graph, f.id) };
    },
    done() { g.graph = main; return g; },
  };
}
