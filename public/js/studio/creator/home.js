// public/js/studio/creator/home.js
// 一覧画面の「クリエイターモード」側：ギミックのテンプレートと、自分のギミックの一覧。
import { api } from "../editor/api.js";
import { h, toast, modal } from "../editor/ui.js";
import { GIMMICK_TEMPLATES } from "./templates.js";
import { GIMMICK_KIND_LABELS } from "../shared/gimmick/defaults.js";
import { gimmickThumb } from "../editor/gimmicks.js";
import { downloadGimmick } from "./io.js";

async function createFrom(t) {
  try {
    const g = await api.createGimmick(t.build());
    location.search = `?gimmick=${encodeURIComponent(g.id)}`;
  } catch (e) {
    toast(`作れませんでした: ${e.message}`, "error");
  }
}

/** JSON の書き出しを読み込む */
function importButton(rerender) {
  const input = h("input", { type: "file", accept: ".json,application/json", hidden: true });
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== "object" || !Array.isArray(data.objects)) throw new Error("ギミックの JSON ではありません");
      await api.createGimmick(data);
      toast(`「${data.name || "ギミック"}」を読み込みました`);
      rerender();
    } catch (e) {
      toast(`読み込めませんでした: ${e.message}`, "error");
    }
  });
  return [input, h("button", { type: "button", class: "btn", onclick: () => input.click() }, "⤒ JSON を読み込む")];
}

function creatorIntro() {
  return h("section", { class: "onboard creator-intro" },
    h("h2", {}, "🛠 クリエイターモード"),
    h("p", {}, "アーティストモードのデザインに置いて使う「ギミック」を作るモードです。Unity や Unreal Engine のように、ステージにオブジェクトを置き、物理・当たり判定・エフェクト・効果音を組み合わせて、Unreal Engine のブループリントのようにノードをつないで動きを決めます。"),
    h("ol", { class: "steps" },
      h("li", {}, h("span", { class: "step-no" }, "1"), h("div", { class: "step-body" }, h("strong", {}, "ギミックを作る"), h("p", {}, "テンプレート（ゲーム・エフェクト・サウンド）から始めるのがおすすめ。「🧩 ブループリント」でノードをつなぎ、▶ 再生でその場で確かめられます。"))),
      h("li", {}, h("span", { class: "step-no" }, "2"), h("div", { class: "step-body" }, h("strong", {}, "アーティストモードで置く"), h("p", {}, "デザインの左の「素材」→「ギミック」から置きます。大きさや位置はデザインの中で自由に。"))),
      h("li", {}, h("span", { class: "step-no" }, "3"), h("div", { class: "step-body" }, h("strong", {}, "配信のイベントで動かす"), h("p", {}, "ギミックの「🎁 ギフトが来たとき」などはそのまま動きます。ルールの「🎮 ギミックに合図」で、好きなイベントから動かすこともできます。")))));
}

/** クリエイターモードの一覧（テンプレートと自分のギミック） */
export async function creatorSections(rerender) {
  const tplGrid = h("div", { class: "tpl-grid" });
  const gameGrid = h("div", { class: "tpl-grid" });
  for (const t of GIMMICK_TEMPLATES) {
    const def = t.build();
    const card = h("button", { type: "button", class: "tpl-card", onclick: () => createFrom(t) },
      gimmickThumb(def, 260, 146),
      t.genre ? h("span", { class: "tpl-genre" }, t.genre) : null,
      h("strong", {}, `${GIMMICK_KIND_LABELS[t.kind].split(" ")[0]} ${t.name}`), h("span", {}, t.desc));
    (t.group === "minigame" ? gameGrid : tplGrid).appendChild(card);
  }

  const list = h("div", { class: "scene-grid" });
  const sections = [
    creatorIntro(),
    h("section", { class: "home-sec" }, h("h2", {}, "テンプレートからギミックを作る"), tplGrid),
    h("section", { class: "home-sec" },
      h("h2", {}, "🕹 ミニゲーム（6ジャンル）"),
      h("p", { class: "hint" }, "視聴者がコメント・いいね・ギフトで遊べるミニゲーム。勝負がつくと、少し待って自動でもう一度始まります。中身は自作の関数・マクロの見本にもなっています。"),
      gameGrid),
    h("section", { class: "home-sec" },
      h("div", { class: "sec-title-row" }, h("h2", {}, "あなたのギミック"), ...importButton(rerender)),
      list),
  ];

  let gimmicks = [];
  try {
    gimmicks = await api.listGimmicks({ full: true });
  } catch (e) {
    list.appendChild(h("p", { class: "hint" }, "ギミックを読み込めませんでした。少し待ってから再読み込みしてください。"));
    return sections;
  }
  if (!gimmicks.length) list.appendChild(h("p", { class: "hint" }, "まだギミックがありません。上のテンプレートから作ってみましょう。"));
  for (const g of gimmicks) {
    const open = () => { location.search = `?gimmick=${encodeURIComponent(g.id)}`; };
    list.appendChild(h("div", { class: "scene-card" },
      h("button", { type: "button", class: "scene-open", onclick: open }, gimmickThumb(g, 320, 180)),
      h("div", { class: "scene-meta" },
        h("strong", {}, g.name),
        h("span", {}, `${GIMMICK_KIND_LABELS[g.kind] || ""}・${g.width}×${g.height}・オブジェクト ${g.objects.length}・ノード ${g.graph?.nodes?.length ?? 0}・${new Date(g.updatedAt).toLocaleString("ja-JP")}`)),
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "small-btn primary", onclick: open }, "開く"),
        h("button", { type: "button", class: "small-btn", onclick: async () => { try { await api.duplicateGimmick(g.id); rerender(); } catch (e) { toast(e.message, "error"); } } }, "複製"),
        h("button", { type: "button", class: "small-btn", onclick: () => downloadGimmick(g) }, "書き出し"),
        h("button", {
          type: "button", class: "small-btn danger",
          onclick: async () => {
            const ok = await modal("ギミックを削除", h("p", {}, `「${g.name}」を削除します。このギミックを置いているデザインからは見えなくなります。`), { okText: "削除" });
            if (!ok) return;
            await api.deleteGimmick(g.id);
            rerender();
          },
        }, "削除"))));
  }
  return sections;
}
