// test/helpers/harness.mjs
// 自己テストの小さな道具。追加のテストツールを入れずに済ませるためのもので、
// `node test/xxx.test.mjs` と1本だけ直接流しても同じように動く。
import path from "path";

let pass = 0;
let fail = 0;

/** cond が真ならパス。名前は「何が守られているか」を書く */
export function t(name, cond) {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name); }
}

export function section(name) { console.log(`\n[${name}]`); }

/** 集計を出して終わる。1件でも失敗していれば終了コード1（test/run.mjs が拾う） */
export function finish() {
  const label = path.basename(process.argv[1] ?? "", ".test.mjs");
  console.log(`\n${fail === 0 ? `✅ ${label}: 全 ${pass} 件パス` : `❌ ${label}: ${pass} 件パス / ${fail} 件失敗`}`);
  process.exit(fail === 0 ? 0 : 1);
}
