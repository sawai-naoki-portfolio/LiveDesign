// test/run.mjs
// `npm test` の本体。test/ の *.test.mjs を1本ずつ**別プロセスで**流す。
//
// 別プロセスにするのは、server/config.js が読み込んだ瞬間に置き場所
// （DATA_DIR・DEMO_MODE）を決めてしまうため。同じプロセスで続けて読むと、
// 前のテストが向けた一時フォルダを次のテストが引きずる。
//
// 1本が失敗しても最後まで流し、失敗したものを最後にまとめて出す。
// 名前で絞れる: `npm test -- studio-logic`
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const filters = process.argv.slice(2);

// フォルダ構成の約束を最初に見る。ここが壊れていると他のテストの失敗の意味が変わる。
const files = fs.readdirSync(TEST_DIR)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort((a, b) => (a === "structure.test.mjs" ? -1 : b === "structure.test.mjs" ? 1 : a.localeCompare(b)))
  .filter((f) => filters.length === 0 || filters.some((q) => f.includes(q)));

if (files.length === 0) {
  console.error(`該当するテストがありません: ${filters.join(" ")}`);
  process.exit(1);
}

const failed = [];
for (const file of files) {
  console.log(`\n━━━━ ${file} ━━━━`);
  const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(TEST_DIR, file)], { stdio: "inherit" });
  if (result.status !== 0) failed.push(file);
}

console.log("");
if (failed.length === 0) {
  console.log(`✅ ${files.length} 本すべてパス`);
} else {
  console.log(`❌ ${files.length} 本中 ${failed.length} 本が失敗: ${failed.join(", ")}`);
  process.exit(1);
}
