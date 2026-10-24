// public/js/studio/editor/document.js
// 編集中の文書（アーティストモードのデザイン・クリエイターモードのギミック）の、
// 元に戻す／やり直しと自動保存。editor/state.js と creator/state.js が同じものを使う。
//
//   change(fn, {coalesce})  … 1回の操作（プロパティの変更・削除・並べ替え）。履歴に1つ積む。
//                             同じ欄を続けて触った変更（色を選んでいる途中など）は coalesce で1つにまとめる
//   live(fn) → endLive()    … ドラッグ中など、指を離すまで何度も呼ぶもの。履歴は endLive() で1つだけ
//
// 書き換えると少し待って保存する。保存している間にまた書き換えられたら、保存し終えてからもう一度保存する。
const HISTORY_LIMIT = 150;
const SAVE_DELAY_MS = 700;
const COALESCE_MS = 1200;

const SAVE_LABELS = {
  saved: "✓ 保存済み", dirty: "● 未保存", saving: "保存中…", error: "⚠ 保存できません（クリックで再試行）",
};

/** 保存の様子を el に書く。保存できなかったときは、クリックでもう一度保存する */
export function paintSaveState(el, state, retry) {
  el.textContent = SAVE_LABELS[state] || "";
  el.className = `save-state ${state}`;
  el.onclick = state === "error" ? () => retry() : null;
}

/**
 * @param {object} o
 * @param {() => object|null} o.get 編集中の文書（無ければ何もしない）
 * @param {() => string} o.snapshot 履歴に積む形（文書の中身の JSON）
 * @param {(json: string) => void} o.restore 履歴の形から文書へ戻す
 * @param {(doc: object) => void} [o.normalize] 書き換えのたびに整えるもの（グループの枠など）
 * @param {(doc: object) => Promise<unknown>} o.save サーバーへ保存する
 * @param {(detail: {live?: boolean, history?: boolean, coalesce?: string}) => void} o.onChange 書き換わった
 * @param {(state: "saved"|"dirty"|"saving"|"error") => void} o.onSaveState 保存の様子が変わった
 */
export function createDocument({ get, snapshot, restore, normalize = () => { }, save, onChange, onSaveState }) {
  // ===============================
  // 履歴
  // ===============================
  const undoStack = [];
  const redoStack = [];
  let lastCoalesce = null;
  let lastChangeAt = 0;
  let liveBefore = null;

  function pushUndo(before) {
    undoStack.push(before);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }

  function change(fn, opts = {}) {
    const doc = get();
    if (!doc) return;
    const before = snapshot();
    fn(doc);
    normalize(doc);
    if (snapshot() === before) return;
    const now = Date.now();
    if (!(opts.coalesce && opts.coalesce === lastCoalesce && now - lastChangeAt < COALESCE_MS)) pushUndo(before);
    lastCoalesce = opts.coalesce || null;
    lastChangeAt = now;
    markDirty();
    onChange(opts);
  }

  function live(fn) {
    const doc = get();
    if (!doc) return;
    if (liveBefore === null) liveBefore = snapshot();
    fn(doc);
    normalize(doc);
    onChange({ live: true });
  }

  function endLive() {
    if (liveBefore === null) return;
    const before = liveBefore;
    liveBefore = null;
    if (snapshot() !== before) {
      pushUndo(before);
      lastCoalesce = null;
      markDirty();
    }
    onChange({});
  }

  function step(from, to) {
    if (!from.length) return;
    to.push(snapshot());
    restore(from.pop());
    markDirty();
    onChange({ history: true });
  }

  function resetHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
    lastCoalesce = null;
  }

  // ===============================
  // 保存
  // ===============================
  let saveTimer = null;
  let saving = false;
  let saveState = "saved";
  // 保存中にまた書き換えられたかを見分ける番号。保存し終えたとき番号が進んでいれば、もう一度保存する
  let dirtyVersion = 0;
  let savedVersion = 0;

  function setSaveState(state) {
    saveState = state;
    onSaveState(state);
  }

  function markDirty() {
    dirtyVersion++;
    setSaveState("dirty");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DELAY_MS);
  }

  async function flushSave() {
    clearTimeout(saveTimer);
    const doc = get();
    if (!doc || dirtyVersion === savedVersion || saving) return;
    saving = true;
    const version = dirtyVersion;
    setSaveState("saving");
    try {
      await save(doc);
      savedVersion = version;
      setSaveState(dirtyVersion === savedVersion ? "saved" : "dirty");
    } catch (e) {
      setSaveState("error");
      console.error("保存に失敗しました", e);
    } finally {
      saving = false;
    }
    if (dirtyVersion !== savedVersion && saveState !== "error") saveTimer = setTimeout(flushSave, SAVE_DELAY_MS);
  }

  // 保存しきれていないまま閉じようとしたら、保存を始めて、閉じてよいか確かめる
  window.addEventListener("beforeunload", (e) => {
    if (saveState === "saved") return;
    flushSave();
    e.preventDefault();
    e.returnValue = "";
  });

  return {
    change,
    live,
    endLive,
    undo: () => step(undoStack, redoStack),
    redo: () => step(redoStack, undoStack),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    resetHistory,
    flushSave,
  };
}
