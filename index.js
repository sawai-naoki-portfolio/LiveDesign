// index.js
// 起動と配線だけ。処理の中身は server/ の各モジュールにある（一覧と役割は README の「フォルダ」）。
//
// 依存は一方向（config → net → db → auth → workspace / assets → studio → live / demo → index）。
import { DEMO_MODE, configWarnings } from "./server/config.js";
import { app, startServer, stopServer, onClientConnect, onPresenceChange } from "./server/net.js";
import { isDatabaseHealthy, closeDatabase } from "./server/db.js";
import "./server/auth.js";
import { flushAllWorkspaces } from "./server/workspace.js";
import { getStudioSnapshot } from "./server/studio.js";
import { syncUser, connectionStatus } from "./server/live.js";
import { startDemoMode } from "./server/demo.js";

for (const warning of configWarnings()) console.warn(`⚠ ${warning}`);

// 生きているかの確認（Docker の HEALTHCHECK・監視サービス用）。データベースまで読めるかを見る
app.get("/healthz", (req, res) => {
  const ok = isDatabaseHealthy();
  res.status(ok ? 200 : 503).json({ ok });
});

// 接続してきた画面に、その人の今の状態をひとまとめで返す
onClientConnect((who) => ({
  type: "state",
  role: who.role,
  demo: DEMO_MODE,
  connection: connectionStatus(who.userId),
  studio: getStudioSnapshot(who.userId),
}));

// 画面を開いている間だけ、その人の TikTok LIVE に繋ぐ
onPresenceChange((userId) => syncUser(userId));

export const server = startServer();
if (DEMO_MODE) startDemoMode();

// 止めるとき（Ctrl+C・docker stop）は、受付をやめてから、書き出していないカウンターを保存して閉じる。
// 待ちきれないときは5秒で打ち切る（docker stop は10秒で強制終了するので、その前に書き終える）。
async function shutdown(signal) {
  console.log(`${signal} を受け取りました。止めています…`);
  await Promise.race([stopServer(), new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
  flushAllWorkspaces();
  closeDatabase();
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => shutdown(signal));
// 落ちたときも、書けるものは書いておく
process.on("exit", flushAllWorkspaces);
