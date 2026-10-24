// public/js/studio/shared/gimmick/expr.js
// ギミックの「式」を読む小さな電卓（Unity のスクリプトの代わり）。
//
//   score + 10            count * 2            random(0, W)
//   score >= 10 && !done  self.y > H - 100     "やった " + user
//
// JavaScript としては一切実行しない（eval も Function も使わない）。読めるのは
// 数・文字・四則演算・比較・論理・三項演算子・下の FUNCS の関数・scope で渡した名前だけ。
// ギミックは JSON で人と共有できるので、他人の作ったものを読み込んでもブラウザの中を触れないようにする。
//
// 読めない式はエラーにせず 0 を返す（配信中にギミックが止まらないように）。
// 何が悪かったかはエディタのコンソールに出せるよう、tryEval() で理由も返す。

const MAX_SOURCE = 400;
const MAX_DEPTH = 40;
const CACHE_LIMIT = 500;

// ===============================
// 字句（ことばに切る）
// ===============================
const PUNCT = ["&&", "||", "==", "!=", "<=", ">=", "+", "-", "*", "/", "%", "(", ")", ",", ".", "<", ">", "!", "?", ":"];
const ID_START = /[\p{L}_$]/u;
const ID_PART = /[\p{L}\p{N}_$]/u;

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(i));
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'" || c === "「") {
      const close = c === "「" ? "」" : c;
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== close) {
        if (src[j] === "\\" && j + 1 < src.length) { s += src[j + 1]; j += 2; continue; }
        s += src[j++];
      }
      if (j >= src.length) throw new Error("文字の閉じかっこがありません");
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < src.length && ID_PART.test(src[j])) j++;
      const word = src.slice(i, j);
      if (word === "and") out.push({ t: "op", v: "&&" });
      else if (word === "or") out.push({ t: "op", v: "||" });
      else if (word === "not") out.push({ t: "op", v: "!" });
      else if (word === "true" || word === "false") out.push({ t: "num", v: word === "true" ? 1 : 0 });
      else out.push({ t: "id", v: word });
      i = j;
      continue;
    }
    // 全角の記号も受け付ける（日本語入力のまま打っても動くように）
    const z = { "＋": "+", "－": "-", "＊": "*", "×": "*", "／": "/", "÷": "/", "（": "(", "）": ")", "，": ",", "＜": "<", "＞": ">", "＝": "=", "！": "!" }[c];
    const rest = z ? z + src.slice(i + 1) : src.slice(i);
    const p = PUNCT.find((x) => rest.startsWith(x));
    if (p) {
      out.push({ t: "op", v: p });
      i += z ? 1 + (p.length - 1) : p.length;
      continue;
    }
    if (c === "=" || z === "=") { // 1つだけの = は == とみなす（「score = 10」と書いても比較になる）
      out.push({ t: "op", v: "==" });
      i++;
      continue;
    }
    throw new Error(`読めない文字「${c}」`);
  }
  return out;
}

// ===============================
// 構文（木にする）
// ===============================
const BINARY = [
  ["||"], ["&&"], ["==", "!="], ["<", "<=", ">", ">="], ["+", "-"], ["*", "/", "%"],
];

function parse(tokens) {
  let pos = 0;
  let depth = 0;
  const peek = () => tokens[pos];
  const isOp = (v) => peek()?.t === "op" && peek().v === v;
  const expect = (v) => {
    if (!isOp(v)) throw new Error(`「${v}」がありません`);
    pos++;
  };

  function enter() {
    if (++depth > MAX_DEPTH) throw new Error("式が深すぎます");
  }

  function ternary() {
    enter();
    const cond = binary(0);
    let node = cond;
    if (isOp("?")) {
      pos++;
      const a = ternary();
      expect(":");
      const b = ternary();
      node = { k: "?", cond, a, b };
    }
    depth--;
    return node;
  }

  function binary(level) {
    if (level >= BINARY.length) return unary();
    let left = binary(level + 1);
    while (peek()?.t === "op" && BINARY[level].includes(peek().v)) {
      const op = tokens[pos++].v;
      const right = binary(level + 1);
      left = { k: "bin", op, left, right };
    }
    return left;
  }

  function unary() {
    if (isOp("!") || isOp("-") || isOp("+")) {
      const op = tokens[pos++].v;
      enter();
      const arg = unary();
      depth--;
      return { k: "un", op, arg };
    }
    return postfix();
  }

  function postfix() {
    let node = primary();
    while (isOp(".")) {
      pos++;
      const name = peek();
      if (name?.t !== "id") throw new Error("「.」のあとに名前がありません");
      pos++;
      node = { k: "member", obj: node, name: name.v };
    }
    return node;
  }

  function primary() {
    const tok = peek();
    if (!tok) throw new Error("式が途中で終わっています");
    if (tok.t === "num" || tok.t === "str") {
      pos++;
      return { k: "lit", v: tok.v };
    }
    if (tok.t === "id") {
      pos++;
      if (isOp("(")) {
        pos++;
        const args = [];
        if (!isOp(")")) {
          args.push(ternary());
          while (isOp(",")) { pos++; args.push(ternary()); }
        }
        expect(")");
        return { k: "call", name: tok.v, args };
      }
      return { k: "id", name: tok.v };
    }
    if (isOp("(")) {
      pos++;
      const node = ternary();
      expect(")");
      return node;
    }
    throw new Error(`思いがけない「${tok.v}」`);
  }

  const tree = ternary();
  if (pos < tokens.length) throw new Error(`余分な「${tokens[pos].v}」`);
  return tree;
}

const cache = new Map();

/** 式を読んで木にする（同じ式は覚えておく）。読めなければ例外 */
function compile(src) {
  const key = String(src ?? "").slice(0, MAX_SOURCE);
  let hit = cache.get(key);
  if (hit) return hit;
  if (!key.trim()) hit = { k: "lit", v: 0 };
  else hit = parse(tokenize(key));
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, hit);
  return hit;
}

// ===============================
// 計算
// ===============================
const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(typeof v === "string" ? v.normalize("NFKC") : v); // 全角の数字（「４２」）も読む
  return Number.isFinite(n) ? n : 0;
};
/** 数として読めるか（コメントの「42」「４２」は読める、「42です」「」は読めない） */
const isNum = (v) => (typeof v === "number" ? Number.isFinite(v) : typeof v === "string" && /^\s*-?(\d+\.?\d*|\.\d+)\s*$/.test(v.normalize("NFKC")));
const truthy = (v) => (typeof v === "string" ? v !== "" && v !== "0" : num(v) !== 0);
const fin = (v) => (Number.isFinite(v) ? v : 0);

/**
 * 使える関数。scope.random があればそれを使う（テストで結果を決めるため）
 * @type {Record<string, (scope: object, ...args: any[]) => any>}
 */
const FUNCS = {
  random: (s, a = 0, b = 1) => num(a) + (s.random?.() ?? Math.random()) * (num(b) - num(a)),
  randint: (s, a = 0, b = 1) => Math.floor(num(a) + (s.random?.() ?? Math.random()) * (Math.floor(num(b)) - num(a) + 1)),
  chance: (s, p = 50) => ((s.random?.() ?? Math.random()) * 100 < num(p) ? 1 : 0),
  pick: (s, ...xs) => (xs.length ? xs[Math.floor((s.random?.() ?? Math.random()) * xs.length)] : 0),
  // n 番目を選ぶ（1 から数える。モンスターの番号から名前を引く、のような表に使う）
  choose: (s, n, ...xs) => { const k = Math.floor(num(n)); return k >= 1 && k <= xs.length ? xs[k - 1] : 0; },
  min: (s, ...xs) => (xs.length ? Math.min(...xs.map(num)) : 0),
  max: (s, ...xs) => (xs.length ? Math.max(...xs.map(num)) : 0),
  clamp: (s, v, a, b) => Math.min(num(b), Math.max(num(a), num(v))),
  abs: (s, v) => Math.abs(num(v)),
  floor: (s, v) => Math.floor(num(v)),
  ceil: (s, v) => Math.ceil(num(v)),
  round: (s, v, d = 0) => { const f = 10 ** Math.max(0, Math.min(8, num(d))); return Math.round(num(v) * f) / f; },
  sqrt: (s, v) => Math.sqrt(Math.max(0, num(v))),
  pow: (s, a, b) => fin(num(a) ** num(b)),
  sin: (s, deg) => Math.sin((num(deg) * Math.PI) / 180),
  cos: (s, deg) => Math.cos((num(deg) * Math.PI) / 180),
  atan2: (s, y, x) => (Math.atan2(num(y), num(x)) * 180) / Math.PI,
  dist: (s, x1, y1, x2, y2) => Math.hypot(num(x2) - num(x1), num(y2) - num(y1)),
  lerp: (s, a, b, t) => num(a) + (num(b) - num(a)) * num(t),
  len: (s, v) => String(v ?? "").length,
  str: (s, v) => String(v ?? ""),
  num: (s, v) => num(v),
  left: (s, v, n) => [...String(v ?? "")].slice(0, Math.max(0, num(n))).join(""),
  // そのタグのオブジェクトがいくつあるか（scope.count を世界が用意する）
  count: (s, tag) => num(s.count?.(String(tag ?? "")) ?? 0),
  // 数として読めるか（コメントで数字を答えるゲームなどに）
  isnum: (s, v) => (isNum(v) ? 1 : 0),
  // 文字が含まれているか（コメントに「草」が入っているか、など）
  has: (s, text, part) => (String(text ?? "").toLowerCase().includes(String(part ?? "").toLowerCase()) ? 1 : 0),
};

const hasOwn = (o, k) => o !== null && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);

function evaluate(node, scope) {
  switch (node.k) {
    case "lit": return node.v;
    case "id": {
      const v = scope.get ? scope.get(node.name) : hasOwn(scope.vars, node.name) ? scope.vars[node.name] : undefined;
      return v === undefined ? 0 : v;
    }
    case "member": {
      const obj = evaluate(node.obj, scope);
      // 読めるのは世界が渡した「ただのオブジェクト」の自前の値だけ（__proto__ などは辿らない）
      if (obj === null || typeof obj !== "object" || !hasOwn(obj, node.name)) return 0;
      const v = obj[node.name];
      return typeof v === "number" || typeof v === "string" ? v : 0;
    }
    case "call": {
      if (!hasOwn(FUNCS, node.name)) throw new Error(`知らない関数「${node.name}」`);
      return FUNCS[node.name](scope, ...node.args.map((a) => evaluate(a, scope)));
    }
    case "un": {
      const v = evaluate(node.arg, scope);
      if (node.op === "!") return truthy(v) ? 0 : 1;
      if (node.op === "-") return -num(v);
      return num(v);
    }
    case "?": return truthy(evaluate(node.cond, scope)) ? evaluate(node.a, scope) : evaluate(node.b, scope);
    case "bin": {
      if (node.op === "&&") return truthy(evaluate(node.left, scope)) ? (truthy(evaluate(node.right, scope)) ? 1 : 0) : 0;
      if (node.op === "||") return truthy(evaluate(node.left, scope)) || truthy(evaluate(node.right, scope)) ? 1 : 0;
      const a = evaluate(node.left, scope);
      const b = evaluate(node.right, scope);
      switch (node.op) {
        case "+":
          if (typeof a === "string" || typeof b === "string") return `${a}${b}`.slice(0, 2000);
          return fin(num(a) + num(b));
        case "-": return fin(num(a) - num(b));
        case "*": return fin(num(a) * num(b));
        case "/": return num(b) === 0 ? 0 : fin(num(a) / num(b));
        case "%": return num(b) === 0 ? 0 : fin(num(a) % num(b));
        case "==": return typeof a === "string" || typeof b === "string" ? (String(a) === String(b) ? 1 : 0) : (num(a) === num(b) ? 1 : 0);
        case "!=": return typeof a === "string" || typeof b === "string" ? (String(a) !== String(b) ? 1 : 0) : (num(a) !== num(b) ? 1 : 0);
        case "<": return num(a) < num(b) ? 1 : 0;
        case "<=": return num(a) <= num(b) ? 1 : 0;
        case ">": return num(a) > num(b) ? 1 : 0;
        case ">=": return num(a) >= num(b) ? 1 : 0;
        default: return 0;
      }
    }
    default: return 0;
  }
}

/**
 * 式を計算する。読めない・計算できないときは { error } を返す。
 * @param {string|number} src
 * @param {{get?: (name: string) => any, vars?: object, random?: () => number, count?: (tag: string) => number}} scope
 * @returns {{value: any, error?: string}}
 */
export function tryEval(src, scope = {}) {
  if (typeof src === "number") return { value: Number.isFinite(src) ? src : 0 };
  try {
    return { value: evaluate(compile(src), scope) };
  } catch (e) {
    return { value: 0, error: e.message };
  }
}

/** 式の値（読めなければ fallback） */
export function evalExpr(src, scope, fallback = 0) {
  const r = tryEval(src, scope);
  return r.error ? fallback : r.value;
}

/** 数として計算する */
export const evalNumber = (src, scope, fallback = 0) => num(evalExpr(src, scope, fallback));

/** 条件として計算する（0・空文字・読めない式は「いいえ」） */
export const evalBool = (src, scope) => truthy(evalExpr(src, scope, 0));

/**
 * 文字の中の {式} を計算して差し込む。「{user} さん +{count * 10}点」のように使う。
 * 計算できない {…} はそのまま残す（書きかけの文字が消えないように）。
 */
export function interpolate(text, scope) {
  const s = String(text ?? "");
  if (!s.includes("{")) return s;
  return s.replace(/\{([^{}]{1,200})\}/g, (whole, src) => {
    const r = tryEval(src, scope);
    if (r.error) return whole;
    const v = r.value;
    if (typeof v === "number") return String(Math.round(v * 100) / 100);
    return String(v);
  });
}

/** エディタ用：式が読めるか（読めなければ理由） */
export function checkExpr(src) {
  try {
    compile(src);
    return null;
  } catch (e) {
    return e.message;
  }
}
