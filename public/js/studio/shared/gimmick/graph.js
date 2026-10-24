// public/js/studio/shared/gimmick/graph.js
// ブループリント（ノードのつながり）を実行する。
//
//   ・イベントノードのきっかけが起きると、白い実行ピンの線をたどってアクションを順に実行する
//   ・アクションの入力ピンに線がつながっていれば、その先のノードから値をもらう
//     （ピュアノード＝計算は、読まれるたびにその場で計算する。アクションの出力は最後に実行したときの値）
//   ・つながっていない入力ピンは、ノードに書いた値を使う。オブジェクトのピンが空なら「このイベントのオブジェクト」
//   ・自作の関数・マクロは、それぞれ別のグラフ。呼ぶたびに「フレーム」（そのとき読める値の入れ物）を作って実行する
//       関数   … 入力ピンの値をその場で読んで渡し、「出口（Return）」に着いたら出力ピンの値を持って戻る。
//                「待つ」は使えない（UE と同じ。すぐに答えを返すため）。ピュア関数は計算ノードと同じく読まれるたびに動く
//       マクロ … 呼んだ所に中身を広げたのと同じ。実行ピンを複数持て、「待つ」も使える。入力ピンの値は読まれるたびに
//                呼んだ側から読み、「一度だけ」などの覚えておく値は呼んだ場所ごとに別々
//
// 配信中に止まらないように、1回のきっかけで動けるノードの数・計算の深さ・待ちの数・合図の連鎖に上限を付ける。
// 上限にかかったときやエラーは、その流れだけを止めてコンソールに理由を出す。
import { NODE_TYPES, pinsOf, canConnect, allowedIn } from "./nodes.js";

const MAX_STEPS = 6000;      // 1回のきっかけで実行できるノードの数（くり返しの中も含む）
const MAX_PULL_DEPTH = 64;   // ピュアノードを何段までたどるか（ぐるぐるつないだとき用）
const MAX_PENDING = 600;     // 「待つ」で待っている流れの数
const MAX_SIGNAL_DEPTH = 8;  // 合図 → 合図 → … の深さ
const MAX_RUN_DEPTH = 40;    // 「順番に」「くり返す」の入れ子の深さ
const MAX_CALL_DEPTH = 16;   // 関数・マクロの中で関数・マクロを呼ぶ深さ（自分を呼ぶ関数も、ここで止まる）

// 全角の英数字・記号（「！ジャンプ」「１２」）も半角と同じに読む（日本語入力のままコメントされることが多いので）
const nfkc = (s) => String(s ?? "").normalize("NFKC");
const lower = (s) => nfkc(s).trim().toLowerCase();
const isNumText = (v) => typeof v === "string" && /^\s*-?(\d+\.?\d*|\.\d+)\s*$/.test(nfkc(v));

/** 値をピンの種類に合わせる */
export function coerce(v, type) {
  switch (type) {
    case "number": {
      if (typeof v === "boolean") return v ? 1 : 0;
      const n = Number(typeof v === "string" ? nfkc(v) : v);
      return Number.isFinite(n) ? n : 0;
    }
    case "string":
      if (v === null || v === undefined) return "";
      if (typeof v === "number") return String(Math.round(v * 100) / 100);
      if (typeof v === "boolean") return v ? "はい" : "いいえ";
      if (typeof v === "object") return String(v.name ?? "");
      return String(v);
    case "bool":
      if (typeof v === "string") return v !== "" && v !== "0" && v !== "false" && v !== "いいえ";
      return !!v && v !== 0;
    case "entity":
      return v && typeof v === "object" && !v.dead ? v : null;
    default:
      return isNumText(v) ? Number(nfkc(v)) : v;
  }
}

/**
 * @param {object} world world.js が渡す、世界を動かす手段（spawn・kill・playSound…）
 * @param {{onTrace?: (nodeId: string, graphId: string) => void, onLog: (text: string, level: string) => void}} opts
 */
export function createGraphRuntime(world, opts) {
  let g = null;
  let main = indexGraph(null, null);
  let fns = new Map(); // 関数・マクロの id → {fn, gi}

  let pending = [];
  let states = new Map();   // 「一度だけ」「交互に」などの覚えておく値
  let everyNext = new Map();
  let whenState = new Map();
  let likeBank = new Map();
  let budget = null;        // 今のきっかけで、あと何ノード動けるか
  let runDepth = 0;
  let pullDepth = 0;

  // ===============================
  // 読み込み（イベントグラフと、関数・マクロのグラフをそれぞれ索引にする）
  // ===============================
  function indexGraph(graph, gimmick, fn = null) {
    const gi = { id: fn?.id || "", nodes: new Map(), byType: new Map(), execOut: new Map(), dataIn: new Map() };
    for (let n of graph?.nodes || []) {
      if (!NODE_TYPES[n.type] || gi.nodes.has(n.id) || !allowedIn(n.type, fn ? fn.kind : null)) continue;
      // 入口・出口は、自分が入っている関数・マクロのピンを持つ
      if (NODE_TYPES[n.type].inner && n.values?.fn !== fn.id) n = { ...n, values: { ...n.values, fn: fn.id } };
      gi.nodes.set(n.id, n);
      if (!gi.byType.has(n.type)) gi.byType.set(n.type, []);
      gi.byType.get(n.type).push(n);
    }
    for (const l of graph?.links || []) {
      const a = gi.nodes.get(l.from);
      const b = gi.nodes.get(l.to);
      if (!a || !b) continue;
      const outPin = pinsOf(a, gimmick).outputs.find((p) => p.name === l.fromPin);
      const inPin = pinsOf(b, gimmick).inputs.find((p) => p.name === l.toPin);
      // ピンが無くなった・種類が合わなくなった（変数や関数の入出力を変えた）線は使わない
      if (!outPin || !inPin || !canConnect(outPin.type, inPin.type)) continue;
      if (outPin.type === "exec") {
        const key = `${a.id}:${outPin.name}`;
        if (!gi.execOut.has(key)) gi.execOut.set(key, []);
        gi.execOut.get(key).push({ node: b, pin: inPin.name });
      } else {
        gi.dataIn.set(`${b.id}:${inPin.name}`, { node: a, pin: outPin.name });
      }
    }
    return gi;
  }

  function load(gimmick) {
    g = gimmick;
    main = indexGraph(gimmick?.graph, gimmick);
    fns = new Map();
    for (const f of gimmick?.functions || []) {
      if (f?.id && !fns.has(f.id) && (f.kind === "function" || f.kind === "macro")) fns.set(f.id, { fn: f, gi: indexGraph(f.graph, gimmick, f) });
    }
  }

  function reset() {
    pending = [];
    states = new Map();
    everyNext = new Map();
    whenState = new Map();
    likeBank = new Map();
    budget = null;
    runDepth = 0;
    pullDepth = 0;
  }

  // イベントはイベントグラフにあるものだけが動く（関数・マクロの中のイベントノードは動かない）
  const ofType = (type) => main.byType.get(type) || [];

  /** イベントグラフの新しいフレーム */
  function frame(outputs, ctx) {
    return {
      gi: main,
      outputs,
      payload: ctx.payload || {},
      self: ctx.self ?? null,
      other: ctx.other ?? null,
      depth: ctx.depth || 0,
      callDepth: 0,
      stateKey: "",
      aborted: false,
    };
  }

  // ===============================
  // 値を読む
  // ===============================
  function literal(node, p, X) {
    if (p.type === "entity") return p.self ? X.self ?? null : null;
    const raw = node.values?.[p.name];
    if (raw === undefined) return p.default;
    return raw;
  }

  function input(node, name, X) {
    const p = pinsOf(node, g).inputs.find((x) => x.name === name);
    if (!p) return undefined;
    const link = X.gi.dataIn.get(`${node.id}:${name}`);
    let v;
    if (!link) {
      v = literal(node, p, X);
      // 空のまま（optional）は「そのまま」の意味なので変換しない
      if (p.optional && (v === "" || v === undefined || v === null)) return undefined;
    } else {
      v = output(link.node, link.pin, X);
    }
    return coerce(v, p.type);
  }

  function isPure(node) {
    const d = NODE_TYPES[node.type];
    return d.isPure ? d.isPure(node, g) : !!d.compute;
  }

  function output(src, pinName, X) {
    // 関数の入口：呼んだときに読んでおいた値
    if (src.type === "fn.entry") return X.args?.[pinName];
    // マクロの入口：呼んだ側のピンを、読まれるたびに読む
    if (src.type === "macro.in") return X.parent ? input(X.call, pinName, X.parent) : undefined;
    const d = NODE_TYPES[src.type];
    if (d.compute && isPure(src)) {
      if (pullDepth > MAX_PULL_DEPTH) {
        world.warnOnce(`pull:${src.id}`, "計算ノードのつながりが深すぎます（ぐるぐるつながっていませんか）");
        return undefined;
      }
      pullDepth++;
      try {
        return d.compute(api, src, (n) => input(src, n, X), X)?.[pinName];
      } catch (err) {
        world.warnOnce(`eval:${src.id}`, `「${d.title}」でエラー: ${err?.message || err}`);
        return undefined;
      } finally {
        pullDepth--;
      }
    }
    return X.outputs.get(src.id)?.[pinName];
  }

  // ===============================
  // 関数・マクロ
  // ===============================
  /** 呼ぶ準備。呼べないときは理由をコンソールに出して null */
  function callee(callNode, X, kind) {
    const entry = fns.get(callNode.values?.fn);
    if (!entry || entry.fn.kind !== kind) {
      world.warnOnce(`call:${callNode.id}`, kind === "macro" ? "呼ぶマクロが見つかりません（消されたかもしれません）" : "呼ぶ関数が見つかりません（消されたかもしれません）");
      return null;
    }
    if ((X.callDepth || 0) >= MAX_CALL_DEPTH) {
      world.warnOnce(`calldepth:${entry.fn.id}`, `「${entry.fn.name}」の中で関数・マクロを呼ぶ深さが ${MAX_CALL_DEPTH} を超えたので止めました（自分を呼び続けていませんか）`);
      return null;
    }
    return entry;
  }

  function childFrame(X, entry, callNode, extra) {
    return {
      gi: entry.gi,
      outputs: new Map(),
      payload: X.payload,
      self: X.self,
      other: X.other,
      depth: X.depth,
      callDepth: (X.callDepth || 0) + 1,
      stateKey: `${X.stateKey || ""}${callNode.id}/`,
      parent: X,
      call: callNode,
      aborted: false,
      inFunction: X.inFunction || entry.fn.kind === "function",
      ...extra,
    };
  }

  /** 関数を呼ぶ。出力ピンの値を返す（出口に着かなければ空の値） */
  function callFunction(callNode, get, X) {
    const entry = callee(callNode, X, "function");
    const f = entry?.fn;
    const empty = Object.fromEntries((f?.outputs || []).map((p) => [p.id, undefined]));
    if (!entry) return empty;
    const args = Object.fromEntries((f.inputs || []).filter((p) => p.type !== "exec").map((p) => [p.id, get(p.id)]));
    const Xf = childFrame(X, entry, callNode, { args, returned: null });
    const start = entry.gi.byType.get("fn.entry")?.[0];
    // ピュア関数は計算の途中（きっかけの外）からも呼ばれるので、そのときは自分で上限を用意する
    const own = budget === null;
    if (own) budget = { left: MAX_STEPS };
    try {
      if (start && entry.gi.execOut.has(`${start.id}:then`)) {
        runFrom(start, "then", Xf);
      } else {
        // 入口から何もつながっていなければ、出口の値をそのまま計算する（計算だけの関数を手早く作れるように）
        const ret = entry.gi.byType.get("fn.return")?.[0];
        if (ret) returnFrom(ret, (n) => input(ret, n, Xf), Xf);
      }
      if (budget.left < 0) X.aborted = true;
    } finally {
      if (own) budget = null;
    }
    return Xf.returned || empty;
  }

  /** 実行ピンの無いマクロ：出口の値をそのまま計算する */
  function pureMacro(callNode, X) {
    const entry = callee(callNode, X, "macro");
    const out = entry?.gi.byType.get("macro.out")?.[0];
    if (!out) return {};
    const Xm = childFrame(X, entry, callNode);
    return Object.fromEntries((entry.fn.outputs || []).filter((p) => p.type !== "exec").map((p) => [p.id, input(out, p.id, Xm)]));
  }

  /** マクロに入る（実行ピン pinIn から） */
  function enterMacro(callNode, pinIn, X) {
    const entry = callee(callNode, X, "macro");
    if (!entry) return;
    const start = entry.gi.byType.get("macro.in")?.[0];
    if (!start) {
      world.warnOnce(`noentry:${entry.fn.id}`, `マクロ「${entry.fn.name}」に入口がありません`);
      return;
    }
    runFrom(start, pinIn, childFrame(X, entry, callNode));
  }

  /** マクロの出口に着いた：出力ピンの値を呼んだ側に渡して、呼んだ側の実行ピン pinIn から続ける */
  function leaveMacro(outNode, get, X, pinIn) {
    if (!X.parent || !X.call) return;
    const entry = fns.get(X.call.values?.fn);
    const vals = Object.fromEntries((entry?.fn.outputs || []).filter((p) => p.type !== "exec").map((p) => [p.id, get(p.id)]));
    X.parent.outputs.set(X.call.id, vals);
    runFrom(X.call, pinIn, X.parent);
  }

  /** 関数の出口（Return）に着いた */
  function returnFrom(node, get, X) {
    if (!X.call || X.returned) return;
    const entry = fns.get(X.call.values?.fn);
    X.returned = Object.fromEntries((entry?.fn.outputs || []).map((p) => [p.id, get(p.id)]));
    X.aborted = true; // 出口のあとは、この関数の中の続きは動かさない
  }

  // ===============================
  // 実行
  // ===============================
  function spend(X) {
    if (X.aborted) return false;
    if (--budget.left < 0) {
      X.aborted = true;
      world.warnOnce("max-steps", `1回のきっかけで動くノードが ${MAX_STEPS} を超えたので止めました（実行の線がぐるぐる回っていませんか）`);
      return false;
    }
    return true;
  }

  /** ノードの出口（実行ピン）の先を実行する */
  function runFrom(node, pinName, X) {
    const targets = X.gi.execOut.get(`${node.id}:${pinName}`);
    if (!targets) return;
    if (runDepth > MAX_RUN_DEPTH) {
      X.aborted = true;
      world.warnOnce("max-depth", "「順番に」「くり返す」の入れ子が深すぎるので止めました");
      return;
    }
    runDepth++;
    try {
      for (const t of targets) runNode(t.node, t.pin, X);
    } finally {
      runDepth--;
    }
  }

  function runNode(start, startPin, X) {
    let node = start;
    let pinIn = startPin;
    while (node && spend(X)) {
      const d = NODE_TYPES[node.type];
      if (!d.exec) return;
      opts.onTrace?.(node.id, X.gi.id);
      let res;
      try {
        res = d.exec(api, node, (n) => input(node, n, X), X, pinIn);
      } catch (err) {
        world.warnOnce(`exec:${node.id}:${err?.message}`, `「${d.title}」でエラー: ${err?.message || err}`);
        return;
      }
      let next = res;
      if (res && typeof res === "object") {
        next = res.next;
        if (res.out) X.outputs.set(node.id, res.out);
      }
      if (!next) return;
      const targets = X.gi.execOut.get(`${node.id}:${next}`);
      if (!targets?.length) return;
      if (targets.length > 1) {
        for (const t of targets.slice(1)) runNode(t.node, t.pin, X);
      }
      node = targets[0].node;
      pinIn = targets[0].pin;
    }
  }

  /** イベントノードを動かす（outputs はイベントの出力ピンの値） */
  function fire(node, outputs = {}, ctx = {}) {
    const own = budget === null;
    if (own) budget = { left: MAX_STEPS };
    try {
      const X = frame(new Map([[node.id, outputs]]), { ...ctx, self: ctx.self ?? outputs.self, other: ctx.other ?? outputs.other });
      opts.onTrace?.(node.id);
      runFrom(node, "then", X);
      return true;
    } finally {
      if (own) budget = null;
    }
  }

  // ===============================
  // ノードから世界を動かす手段
  // ===============================
  const api = {
    random: () => world.random(),
    time: () => world.time,
    W: () => world.W,
    H: () => world.H,
    truthy: (v) => coerce(v, "bool"),
    runFrom,
    /** 「一度だけ」などの覚えておく値。マクロの中では呼んだ場所ごとに別々 */
    state(node, X) {
      const key = `${X?.stateKey || ""}${node.id}`;
      let s = states.get(key);
      if (!s) { s = {}; states.set(key, s); }
      return s;
    },
    later(seconds, node, pinName, X) {
      if (X.inFunction) {
        world.warnOnce(`latent:${node.id}`, "関数の中では「待つ」は使えません（すぐに答えを返すため）。待つ処理はマクロかイベントグラフに置いてください");
        return;
      }
      if (pending.length >= MAX_PENDING) {
        world.warnOnce("max-pending", "「待つ」で待っている流れが多すぎるので、古いものを捨てました");
        pending.shift();
      }
      pending.push({ at: world.time + seconds, node, pin: pinName, X });
    },
    spawn: (prefabId, o, X) => world.spawn(prefabId, o, X),
    kill: (e, effectId) => world.kill(e, effectId),
    withTag: (tag) => world.withTag(tag),
    instanceOf: (objectId) => world.instanceOf(objectId),
    tween: (e, x, y, s) => world.tween(e, x, y, s),
    playSound: (id, v) => world.playSound(id, v),
    playEffect: (id, x, y) => world.playEffect(id, x, y),
    shake: (s, d) => world.shake(s, d),
    flash: (c, d) => world.flash(c, d),
    restart: () => world.restart(),
    log: (text) => opts.onLog(text, "info"),
    warnOnce: (key, text) => world.warnOnce(key, text),
    getVar: (name) => world.getVar(name),
    setVar: (name, v) => world.setVar(name, v),
    scope: (X, extra) => world.scope(X, extra),
    format: (text, X) => world.format(text, X),
    signal: (name, X) => signal(name, X.payload, (X.depth || 0) + 1, X),
    callFunction,
    pureMacro,
    enterMacro,
    leaveMacro,
    returnFrom,
  };

  // ===============================
  // きっかけ
  // ===============================
  function start() {
    for (const n of ofType("event.start")) fire(n);
  }

  /** 毎フレーム：待ちの続き・タイマー・毎フレーム・条件 */
  function tick(dt) {
    if (pending.length) {
      const due = pending.filter((p) => p.at <= world.time);
      if (due.length) {
        pending = pending.filter((p) => p.at > world.time);
        for (const p of due) {
          budget = { left: MAX_STEPS };
          // マクロの中で待っていたときは、呼んだ側の流れも続きから動けるようにする。
          // 待ったあとは新しいきっかけと同じなので、合図の連鎖の深さも数え直す
          // （「合図 → 待つ → 合図 → 待つ…」は止まらない輪ではなく、時間をかけた繰り返し）
          for (let f = p.X; f; f = f.parent) { f.aborted = false; f.depth = 0; }
          try { runFrom(p.node, p.pin, p.X); } finally { budget = null; }
        }
      }
    }
    for (const n of ofType("event.every")) {
      const sec = Math.max(0.05, Number(n.values?.seconds) || 1);
      const st = everyNext.get(n.id) || { next: sec, times: 0 };
      let guard = 0;
      while (world.time >= st.next && guard++ < 5) {
        st.times++;
        fire(n, { times: st.times });
        st.next += sec;
      }
      if (world.time >= st.next) st.next = world.time + sec;
      everyNext.set(n.id, st);
    }
    for (const n of ofType("event.tick")) fire(n, { dt });
    for (const n of ofType("event.when")) {
      budget = { left: MAX_STEPS };
      let now = false;
      try { now = coerce(input(n, "cond", frame(new Map(), {})), "bool"); } finally { budget = null; }
      const before = whenState.get(n.id) || false;
      whenState.set(n.id, now);
      if (now && !before) fire(n);
    }
  }

  function signalOutputs(p = {}) {
    return { user: p.user ?? "", count: Number(p.count) || 0, coins: Number(p.coins) || 0, gift: p.gift ?? "", comment: p.comment ?? "", avatar: p.avatar ?? "" };
  }

  /** 合図。何個のイベントが動いたかを返す */
  function signal(name, payload = {}, depth = 0, from = null) {
    if (depth > MAX_SIGNAL_DEPTH) {
      world.warnOnce(`depth:${name}`, `合図「${name}」が繰り返し呼ばれているので止めました`);
      return 0;
    }
    const key = lower(name);
    let n = 0;
    for (const node of ofType("event.signal")) {
      if (lower(node.values?.name) !== key) continue;
      fire(node, signalOutputs(payload), { payload, depth, self: from?.self, other: from?.other });
      n++;
    }
    return n;
  }

  /** 配信のイベント。payload は world.js の payloadFromEvent() の形 */
  function live(ev, payload) {
    const type = ev?.type;
    if (!type) return;
    for (const node of ofType(`event.${type}`)) {
      const v = node.values || {};
      const out = { user: payload.user, avatar: payload.avatar };
      if (type === "gift") {
        const names = String(v.giftName ?? "").split(/[,、\n]/).map(lower).filter(Boolean);
        if (names.length && !names.includes(lower(ev.gift?.name))) continue;
        if (Number(v.minCoins) > 0 && payload.coins < Number(v.minCoins)) continue;
        Object.assign(out, { gift: payload.gift, count: payload.count, coins: payload.coins, giftImage: payload.giftImage });
      } else if (type === "chat") {
        const text = String(ev.text ?? "");
        let args = "";
        if (v.match === "command") {
          const a = world.matchCommand(text, v.keyword);
          if (a === null) continue;
          args = a;
        } else if (v.match === "contains") {
          if (!v.keyword || !lower(text).includes(lower(v.keyword))) continue;
        } else if (v.match === "exact") {
          if (lower(text) !== lower(v.keyword)) continue;
        }
        Object.assign(out, { comment: text, args });
      } else if (type === "like") {
        const every = Math.max(0, Number(v.every) || 0);
        let count = Number(ev.likes) || 0;
        if (every > 0) {
          const bank = (likeBank.get(node.id) || 0) + count;
          count = Math.floor(bank / every);
          likeBank.set(node.id, bank - count * every);
          if (count === 0) continue;
        }
        out.count = count;
      }
      fire(node, out, { payload: { ...payload, args: out.args ?? payload.args, count: out.count ?? payload.count } });
    }
  }

  return {
    load,
    reset,
    start,
    tick,
    signal,
    live,
    fire,
    ofType,
    /** エディタの「今すぐ動かす」 */
    fireById(id, payload = {}) {
      const node = main.nodes.get(id);
      if (!node || NODE_TYPES[node.type]?.kind !== "event") return false;
      fire(node, { ...signalOutputs(payload), ...payload }, { payload });
      return true;
    },
    get pendingCount() { return pending.length; },
  };
}
