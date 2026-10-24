// test/gimmick-flow.test.mjs
// クリエイターモードのギミックが**本物のサーバーを通って**、利用者ごとに分かれて保存・配布されるかの検査。
//
//   ・ギミックは本人のものだけ（他人のものは読めない・書けない・消せない・届かない）
//   ・OBS のオーバーレイには、デザインに置いたギミックの中身が添えられる（自分のものだけ）
//   ・保存すると、開いている画面（エディタ・OBS）にその場で届く
//   ・ルールの「🎮 ギミックに合図」が、その人の画面にだけ届く
import { t, section, finish } from "./helpers/harness.mjs";
import { bootServer, settle } from "./helpers/server.mjs";

const srv = await bootServer({ env: { MAX_GIMMICKS_PER_USER: "3" } });

const alice = srv.client();
const bob = srv.client();
const aliceUser = await alice.register("alice@example.com");
const bobUser = await bob.register("bob@example.com");

const sample = {
  name: "ギフトでボール", kind: "game", width: 800, height: 600,
  variables: [{ name: "score", value: 0 }, { name: "goal", value: 10, exposed: true, label: "目標" }],
  objects: [{ id: "ball", name: "ボール", tag: "ball", prefab: true, w: 40, h: 40, body: { type: "dynamic" } }],
  graph: {
    nodes: [
      { id: "e1", type: "event.signal", x: 0, y: 0, values: { name: "drop" } },
      { id: "a1", type: "action.spawn", x: 300, y: 0, values: { prefab: "ball", at: "randomTop" } },
      { id: "e2", type: "event.gift", x: 0, y: 300, values: {} },
      { id: "a2", type: "var.add", x: 300, y: 300, values: { var: "score" } },
      { id: "x", type: "<img src=x onerror=alert(1)>", x: 0, y: 0 },
    ],
    links: [
      { from: "e1", fromPin: "then", to: "a1", toPin: "exec" },
      { from: "e1", fromPin: "count", to: "a1", toPin: "count" },
      { from: "e2", fromPin: "then", to: "a2", toPin: "exec" },
      { from: "e2", fromPin: "coins", to: "a2", toPin: "amount" },
      { from: "e2", fromPin: "then", to: "x", toPin: "exec" },
    ],
  },
  sounds: [{ id: "s1", name: "コイン", wave: "square" }],
  effects: [{ id: "f1", name: "キラキラ" }],
  functions: [{
    id: "fn1", name: "ボールを出す", kind: "function", inputs: [{ id: "p1", name: "数", type: "number" }], outputs: [],
    graph: { nodes: [{ id: "en", type: "fn.entry", x: 0, y: 0, values: { fn: "fn1" } }], links: [] },
  }],
};

section("ギミックの保存（本人のものだけ）");
let gm;
{
  const res = await alice.post("/api/studio/gimmicks", sample);
  gm = res.data;
  t("作れる（201）", res.status === 201 && /^[a-z0-9-]+$/.test(gm.id));
  t("形は整えて保存する（形の違うノードと、そこへのつながりは捨てる）", gm.graph.nodes.length === 4 && gm.graph.links.length === 4 && gm.kind === "game");
  const list = (await alice.get("/api/studio/gimmicks")).data;
  t("一覧は要約（合図の名前つき・関数の中のノードも数える）", list.length === 1 && list[0].signals.join() === "drop" && list[0].objects === 1 && list[0].nodes === 5 && list[0].functions === 1 && !list[0].graph);
  t("自作の関数も保存する", gm.functions.length === 1 && gm.functions[0].name === "ボールを出す" && gm.functions[0].inputs[0].id === "p1" && gm.functions[0].graph.nodes.length === 1);
  t("?full=1 なら中身ごと", (await alice.get("/api/studio/gimmicks?full=1")).data[0].graph.links.length === 4);
  t("1つだけ読める", (await alice.get(`/api/studio/gimmicks/${gm.id}`)).data.name === "ギフトでボール");
  t("他人の一覧には出ない", (await bob.get("/api/studio/gimmicks")).data.length === 0);
  t("他人は読めない", (await bob.get(`/api/studio/gimmicks/${gm.id}`)).status === 404);
  t("他人は上書きできない", (await bob.put(`/api/studio/gimmicks/${gm.id}`, { name: "乗っ取り" })).status === 404);
  t("他人は複製できない", (await bob.post(`/api/studio/gimmicks/${gm.id}/duplicate`)).status === 404);
  t("他人は消せない", (await bob.del(`/api/studio/gimmicks/${gm.id}`)).status === 404);
  t("中身は無事", (await alice.get(`/api/studio/gimmicks/${gm.id}`)).data.name === "ギフトでボール");
  t("ログインしていなければ読めない", (await srv.client().get("/api/studio/gimmicks")).status === 401);
  t("よそのページからの書き込みは断る", (await alice.post("/api/studio/gimmicks", sample, { Origin: "http://evil.example" })).status === 403);

  const aliceEditor = await alice.socket();
  const aliceObs = await srv.client().socket(`k=${aliceUser.overlayKey}`);
  const bobEditor = await bob.socket();
  const put = await alice.put(`/api/studio/gimmicks/${gm.id}`, { ...gm, name: "名前を変えた" });
  await settle();
  t("上書きできる", put.status === 200);
  t("本人のエディタに届く", aliceEditor.of("studioGimmick").some((m) => m.gimmick.name === "名前を変えた"));
  t("本人の OBS にも届く（置いてあるギミックがその場で変わる）", aliceObs.of("studioGimmick").length === 1);
  t("他人の画面には届かない", bobEditor.of("studioGimmick").length === 0);
  t("知らない ID の上書きは 404", (await alice.put("/api/studio/gimmicks/new-id-123", sample)).status === 404);
  t("ID の形が違えば 400", (await alice.put("/api/studio/gimmicks/..%2F..%2Fx", sample)).status === 400);

  const dup = await alice.post(`/api/studio/gimmicks/${gm.id}/duplicate`);
  t("複製できる", dup.status === 201 && dup.data.name === "名前を変えた のコピー");
  await alice.post("/api/studio/gimmicks", { name: "3つ目" });
  t("1人あたりのギミックの数に上限がある", (await alice.post("/api/studio/gimmicks", { name: "4つ目" })).status === 409);
  const del = await alice.del(`/api/studio/gimmicks/${dup.data.id}`);
  await settle();
  t("消せる", del.status === 200 && (await alice.get(`/api/studio/gimmicks/${dup.data.id}`)).status === 404);
  t("消したことが画面に届く", aliceEditor.of("studioGimmickDeleted").some((m) => m.id === dup.data.id));
  aliceEditor.close();
  aliceObs.close();
  bobEditor.close();
}

section("デザインに置いて、OBS で読む");
let scene;
{
  const bobGm = (await bob.post("/api/studio/gimmicks", { ...sample, name: "ボブのギミック" })).data;
  scene = (await alice.post("/api/studio/scenes", {
    name: "ギミックを置いたデザイン",
    elements: [
      { id: "g1", type: "gimmick", x: 100, y: 100, w: 800, h: 600, cfg: { gimmickId: gm.id, vars: [{ name: "goal", value: 50 }] } },
      // 他人のギミックの ID を書いても、中身は渡らない
      { id: "g2", type: "gimmick", cfg: { gimmickId: bobGm.id } },
    ],
    rules: [{ id: "r1", name: "フォローでボール", trigger: { type: "follow" }, actions: [{ kind: "gimmick", target: "g1", signal: "drop" }] }],
  })).data;
  t("ギミック枠を置いたデザインを保存できる", scene.elements.length === 2 && scene.elements[0].cfg.gimmickId === gm.id);

  const pub = (await srv.client().get(`/api/public/scenes/${scene.id}?k=${aliceUser.overlayKey}`)).data;
  t("オーバーレイには置いたギミックの中身が添えられる（自作の関数も）", pub.gimmicks?.[gm.id]?.graph.nodes.length === 4 && pub.gimmicks[gm.id].functions?.[0]?.id === "fn1");
  t("他人のギミックは添えられない", !pub.gimmicks?.[bobGm.id]);
  t("置いていない自分のギミックは添えない", Object.keys(pub.gimmicks).length === 1);
  t("保存されたデザインには、ギミックの中身は入らない（ID だけ）", !(await alice.get(`/api/studio/scenes/${scene.id}`)).data.gimmicks);

  const obs = await srv.client().socket(`k=${aliceUser.overlayKey}`);
  await alice.put(`/api/studio/scenes/${scene.id}`, scene);
  await settle();
  t("デザインを保存すると、OBS にギミックの中身ごと届く", obs.of("studioScene").at(-1)?.scene.gimmicks?.[gm.id]?.name === "名前を変えた");

  const editor = await alice.socket();
  const bobEditor = await bob.socket();
  await alice.post("/api/studio/event", { type: "follow", user: { name: "さくら" } });
  await settle();
  const action = editor.of("studioAction").find((m) => m.ruleId === "r1");
  t("ルールの「ギミックに合図」が本人の画面に届く", action?.actions[0]?.kind === "gimmick" && action.actions[0].signal === "drop");
  t("イベントの人も一緒に届く（ギミックの {user}）", action?.event?.user?.name === "さくら");
  t("OBS にも届く", obs.of("studioAction").some((m) => m.ruleId === "r1"));
  t("他人の画面には届かない", bobEditor.of("studioAction").length === 0);
  t("ギミックが直接受ける配信のイベントも届く（studioEvent）", editor.of("studioEvent").some((m) => m.event.type === "follow"));
  editor.close();
  bobEditor.close();
  obs.close();
}

section("アカウントを消すとギミックも消える");
{
  const carol = srv.client();
  await carol.register("carol@example.com");
  const g = (await carol.post("/api/studio/gimmicks", sample)).data;
  await carol.del("/api/account", { password: "password-123" });
  const { one } = await import("../server/db.js");
  t("データベースから消える", one("SELECT COUNT(*) AS n FROM gimmicks WHERE id = ?", g.id).n === 0);
  void bobUser;
}

srv.close();
finish();
