// lib/timers.js
// タイマーまわりの小さな共通処理。

/**
 * 待っているだけのタイマーでプロセスを生かし続けない。
 * 付け忘れると、テストや Ctrl+C のあとも保存待ち・演出待ちのタイマーが
 * 残ってプロセスが終わらなくなる。
 * @template T
 * @param {T} timer setTimeout / setInterval の戻り値
 * @returns {T} そのまま返す（`const t = unrefTimer(setTimeout(...))` と書ける）
 */
export function unrefTimer(timer) {
  if (typeof timer?.unref === "function") timer.unref();
  return timer;
}
