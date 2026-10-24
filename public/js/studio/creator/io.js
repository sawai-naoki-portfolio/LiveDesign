// public/js/studio/creator/io.js
// ギミックの書き出し（JSON。バックアップ・人に渡す）。読み込みは一覧（creator/home.js）から。
// JSON の中身はただのデータで、読み込んでもスクリプトとしては動かない（式は expr.js だけが読む）。
import { downloadJson } from "../editor/ui.js";

export function downloadGimmick(g) {
  // ID と更新日時は読み込んだ側で新しく付く
  const data = { livedesignGimmick: 1, ...g };
  delete data.id;
  delete data.updatedAt;
  downloadJson(`${g.name || "gimmick"}.gimmick.json`, data);
}
