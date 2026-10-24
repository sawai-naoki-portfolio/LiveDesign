// scripts/admin.js
// 運営用のコマンド（サーバーと同じ DATA_DIR / DB_FILE を見る）。
//
//   npm run admin -- users                       利用者の数と、最近登録した人
//   npm run admin -- reset-password <メール> <新しいパスワード>
//                                                パスワードを忘れた人の再設定（その人のログインはすべて切れる）
//   npm run admin -- set-plan <メール> <free|pro> プランを変える
//
// Docker のときは: docker exec livedesign npm run admin -- users
import { one, all, run } from "../server/db.js";
import { hashPassword, passwordProblem } from "../lib/auth/password.js";

const [command, ...args] = process.argv.slice(2);

function userByEmail(email) {
  const user = one("SELECT id, email, display_name FROM users WHERE email = ?", String(email ?? "").trim().toLowerCase());
  if (!user) {
    console.error(`見つかりません: ${email}`);
    process.exit(1);
  }
  return user;
}

switch (command) {
  case "users": {
    const { n } = one("SELECT COUNT(*) AS n FROM users");
    console.log(`利用者: ${n} 人`);
    for (const u of all("SELECT email, display_name, tiktok_username, plan, created_at FROM users ORDER BY created_at DESC LIMIT 20")) {
      console.log(`  ${new Date(u.created_at).toISOString().slice(0, 10)}  ${u.email ?? "(メールなし)"}  ${u.display_name}  @${u.tiktok_username || "-"}  ${u.plan}`);
    }
    break;
  }
  case "reset-password": {
    const [email, password] = args;
    const problem = passwordProblem(password);
    if (problem) {
      console.error(problem);
      process.exit(1);
    }
    const user = userByEmail(email);
    run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(password), user.id);
    run("DELETE FROM sessions WHERE user_id = ?", user.id);
    console.log(`パスワードを再設定しました: ${user.email}（ログインはすべて切りました）`);
    break;
  }
  case "set-plan": {
    const [email, plan] = args;
    if (!["free", "pro"].includes(plan)) {
      console.error("プランは free か pro");
      process.exit(1);
    }
    const user = userByEmail(email);
    run("UPDATE users SET plan = ? WHERE id = ?", plan, user.id);
    console.log(`${user.email} を ${plan} にしました`);
    break;
  }
  default:
    console.log("使い方: npm run admin -- users | reset-password <メール> <パスワード> | set-plan <メール> <free|pro>");
}
