// test/structure.test.mjs
// フォルダ構成の約束を守れているかの検査。`npm test` で実行する。
//
// この構成の肝は「public/ の中身がそのまま公開範囲」という点と、
// サーバーの依存が一方向（config → net → db → auth → workspace / assets → studio → live / demo → index）であること。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { t, section, finish } from "./helpers/harness.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf-8");
const exists = (f) => fs.existsSync(path.join(ROOT, f));
const list = (dir) => (exists(dir) ? fs.readdirSync(path.join(ROOT, dir)) : []);

/** dir の下の .js を全部（相対パス） */
function walkJs(dir, out = []) {
  for (const name of list(dir)) {
    const rel = path.join(dir, name);
    if (fs.statSync(path.join(ROOT, rel)).isDirectory()) walkJs(rel, out);
    else if (name.endsWith(".js")) out.push(rel);
  }
  return out;
}
const importsOf = (file) => [...read(file).matchAll(/from "([^"]+)"/g)].map((m) => m[1]);

section("フォルダ");
for (const dir of [
  "server", "lib", "lib/studio", "lib/auth", "public", "public/css", "public/js/studio", "public/js/site", "test",
  "public/js/studio/editor", "public/js/studio/creator", "public/js/studio/shared", "public/js/studio/shared/gimmick",
]) {
  t(`${dir}/ がある`, exists(dir));
}

section("公開範囲");
{
  const pages = ["index.html", "login.html", "studio.html", "overlay.html"];
  for (const page of pages) t(`public/${page} がある`, exists(`public/${page}`));

  // HTML が参照している相対パスが public/ に実在するか（無いと本番だけ 404 になる）
  const missing = [];
  for (const page of pages) {
    for (const m of read(`public/${page}`).matchAll(/(?:src|href)="([^"]+)"/g)) {
      const ref = m[1];
      if (ref.startsWith("/") || ref.startsWith("http") || ref.startsWith("data:")) continue;
      if (!exists(path.join("public", ref))) missing.push(`${page} → ${ref}`);
    }
  }
  t("HTMLが参照するファイルが全て public/ にある", missing.length === 0);
  missing.forEach((m) => console.log("      欠落:", m));

  // スクリプトは public/js/ に置き、HTML には書かない（テストや他のスクリプトから中身を読めなくなる）
  const inline = pages.filter((page) => /<script>/.test(read(`public/${page}`)));
  t("HTML にスクリプトを直接書いていない", inline.length === 0);

  // 接続（connectServer）は ws-client.js にある。type="module" は後回しで実行されるので、
  // 普通の <script> の ws-client.js が先に読まれる。順番は書いた通りに保っておく
  for (const [page, main] of [["studio.html", "studio/studio.js"], ["overlay.html", "studio/overlay.js"]]) {
    const html = read(`public/${page}`);
    const client = html.indexOf('<script src="js/ws-client.js"></script>');
    const entry = html.indexOf(`<script type="module" src="js/${main}"></script>`);
    t(`${page} は ws-client.js と ${main} を読む`, client >= 0 && entry > client);
  }

  // モジュールが import しているファイルが全部ある（書き間違えると画面が真っ白になる）
  const broken = [];
  for (const file of walkJs("public/js/studio")) {
    for (const ref of importsOf(file)) {
      if (ref.startsWith(".") && !exists(path.join(path.dirname(file), ref))) broken.push(`${file} → ${ref}`);
    }
  }
  t("スタジオのモジュールが読むファイルが全部ある", broken.length === 0);
  broken.forEach((m) => console.log("      欠落:", m));

  // 読んでいる名前が、相手のファイルで export されている（無い名前を読むとモジュールごと動かない）
  const exportsOf = (file) => {
    const code = read(file);
    const names = new Set([...code.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([\w$]+)/g)].map((m) => m[1]));
    for (const m of code.matchAll(/export\s+const\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(",")) names.add(part.split(":").pop().trim());
    }
    return names;
  };
  const missingNames = [];
  for (const file of [...walkJs("public/js/studio"), ...walkJs("server"), ...walkJs("lib")]) {
    for (const m of read(file).matchAll(/import\s*\{([^}]*)\}\s*from\s*"(\.[^"]+)"/g)) {
      const target = path.join(path.dirname(file), m[2]);
      if (!exists(target)) continue;
      const names = exportsOf(target);
      for (const part of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
        const name = part.split(/\s+as\s+/)[0];
        if (!names.has(name)) missingNames.push(`${file} → ${m[2]} の ${name}`);
      }
    }
  }
  t("読んでいる名前が全部 export されている", missingNames.length === 0);
  missingNames.forEach((m) => console.log("      無い名前:", m));

  // オーバーレイ（OBS に映る側）はエディタの部品を読まない。読むと操作画面の
  // 不具合で配信画面まで止まる（アーティストモードの editor/ も、クリエイターモードの creator/ も）
  const overlaySide = ["public/js/studio/overlay.js", ...walkJs("public/js/studio/shared")];
  const leaks = overlaySide.filter((f) => importsOf(f).some((r) => r.includes("editor/") || r.includes("creator/")));
  t("オーバーレイと共通部品はエディタ（アーティスト・クリエイター）を読まない", leaks.length === 0);
  leaks.forEach((m) => console.log("      逆向き:", m));

  // ギミックの式は人と共有した JSON から来るので、JavaScript として実行する道を作らない
  const gimmickCode = walkJs("public/js/studio/shared/gimmick").map((f) => [f, read(f).replace(/\/\/.*$/gm, "")]);
  const evals = gimmickCode.filter(([, code]) => /\beval\s*\(|new\s+Function\b|\bFunction\s*\(|setTimeout\s*\(\s*["'`]|innerHTML/.test(code)).map(([f]) => f);
  t("ギミックのエンジンは eval・Function・innerHTML を使わない", gimmickCode.length > 0 && evals.length === 0);
  evals.forEach((m) => console.log("      危ない:", m));
  t("ギミックのエンジンは画面の外（Node）でも読める部品を分けている（world.js は DOM を触らない）",
    !/document\.|window\./.test(read("public/js/studio/shared/gimmick/world.js").replace(/\/\/.*$/gm, "")));

  // 秘密や実行時データが public/ に紛れ込んでいないか
  const leaked = [];
  const walk = (dir) => {
    for (const name of list(dir)) {
      const rel = path.join(dir, name);
      if (fs.statSync(path.join(ROOT, rel)).isDirectory()) walk(rel);
      else if (/^(\.env|state.*\.json|.*\.db(-wal|-shm)?)$/.test(name) || rel.includes(`${path.sep}scenes${path.sep}`)) leaked.push(rel);
    }
  };
  walk("public");
  t("public/ に設定や実行時データが混ざっていない", leaked.length === 0);
}

section("サーバーの依存の向き");
{
  const local = (file) => importsOf(file).filter((r) => r.startsWith("./")).map((r) => r.replace(/^\.\/|\.js$/g, ""));
  // 読んでよい相手。ここに無いものを読むと循環参照になる（読み込み順で undefined を掴む）
  const ALLOWED = {
    config: [],
    net: ["config"],
    db: ["config"],
    auth: ["config", "net", "db"],
    workspace: ["db", "net"],
    assets: ["config", "net", "auth"],
    studio: ["config", "net", "db", "auth", "workspace", "assets"],
    live: ["config", "net", "auth", "studio"],
    demo: ["net", "studio"],
  };
  for (const [name, allowed] of Object.entries(ALLOWED)) {
    const bad = local(`server/${name}.js`).filter((n) => !allowed.includes(n));
    t(`${name}.js が読むのは ${allowed.join(" / ") || "（なし）"} だけ`, bad.length === 0);
    bad.forEach((b) => console.log("      逆向き:", `${name}.js → ${b}.js`));
  }
  t("server/ のファイルが一覧と合っている（足したら ALLOWED にも足す）",
    list("server").filter((f) => f.endsWith(".js")).every((f) => f.replace(/\.js$/, "") in ALLOWED));
  t("live.js と demo.js は studio.js を通してイベントを渡す",
    /studioIngest\(/.test(read("server/live.js")) && /studioIngest\(/.test(read("server/demo.js")));
  const libBad = walkJs("lib").filter((f) => importsOf(f).some((r) => r.includes("server/")));
  t("lib/ は server/ を読まない（単体で試せるように）", libBad.length === 0);
  // 設定は config.js に集める（どこで何を読んでいるかを1か所で見られるように）
  const envReaders = ["index.js", ...walkJs("server"), ...walkJs("lib"), ...walkJs("scripts")]
    .filter((f) => f !== path.join("server", "config.js") && /process\.env/.test(read(f)));
  t("環境変数を読むのは server/config.js だけ", envReaders.length === 0);
  envReaders.forEach((f) => console.log("      読んでいる:", f));
}

section("実行時データの置き場所");
{
  const code = read("server/config.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  t("保存先は data/ に集約されている", /DATA_DIR/.test(code) && /path\.join\(ROOT, "data"\)/.test(code));
  t("基準は cwd ではなくファイルの場所", /fileURLToPath/.test(code) && !/process\.cwd\(\)/.test(code));
  t(".gitignore が data/ を除外している", /^data\/$/m.test(read(".gitignore")));
  t(".gitignore が .env を除外している", /^\.env$/m.test(read(".gitignore")));
  t(".env.example がある（必要な設定の一覧）", exists(".env.example"));
}

section("index.js は配線だけ");
{
  const lines = read("index.js").split("\n").length;
  t(`index.js が薄い（${lines}行 < 60）`, lines < 60);
}

section("ログインの守り");
{
  // ログインが要る REST は、すべて requireUser を通す（付け忘れると誰でも他人のデザインを読める）。
  // 本文を読むより先に確かめる（ログインしていない人の大きな本文を読まされないように）
  const studio = read("server/studio.js");
  const auth = read("server/auth.js");
  const studioGuard = studio.indexOf("? requireUserOrApiKey : requireUser)(req, res, next)");
  t("/api/studio は本文を読む前に本人を確かめる", studioGuard > 0 && studioGuard < studio.indexOf("express.json(") && studioGuard < studio.indexOf('router.use("/assets", assetsRouter)'));
  t("API キーで使えるのはイベントとカウンターだけ", /const API_KEY_PATHS = new Set\(\["\/event", "\/vars"\]\);/.test(studio));
  t("requireUser は API キーを受け付けない（アカウントの設定はログインした本人だけ）", /export const requireUser = guard\(sessionUser\);/.test(auth));
  t("/api/live は requireUser を通す", /router\.use\(sameOriginOnly, requireUser\)/.test(read("server/live.js")));
  t("/api/account は本文を読む前に requireUser を通す", /accountRouter\.use\(sameOriginOnly, requireUser, express\.json\(/.test(auth));
  // 合鍵なしで読める口は、オーバーレイ用の1つだけ（ほかは requireUser を付けたルーターの中）
  const publicRoutes = ["index.js", ...walkJs("server")]
    .flatMap((f) => [...read(f).matchAll(/app\.(?:get|post|put|patch|delete)\("(\/api\/[^"]+)"/g)].map((m) => m[1]));
  t("ログイン不要の API はオーバーレイ用の読み出しだけ", publicRoutes.length === 1 && publicRoutes[0] === "/api/public/scenes/:id");
  t("オーバーレイ用の読み出しは合鍵で持ち主を決める", /findUserByOverlayKey\(String\(req\.query\.k/.test(studio));
  // ログインのあとに戻る先は、サーバー（ログイン済みのとき）と画面（ログインしたあと）で同じ決まりにする
  const serverNext = /return (\/\^.*\$\/)\.test\(s\)/.exec(auth)?.[1];
  const clientNext = /const NEXT_RE = (\/\^.*\$\/);/.exec(read("public/js/site/login.js"))?.[1];
  t("ログインのあとに戻る先の決まりが、サーバーと画面で同じ", !!serverNext && serverNext === clientNext);
  t("パスワードは scrypt で保存する", /crypto\.scrypt/.test(read("lib/auth/password.js")));
  t("セッションはハッシュで保存する", /sha256\(token\)/.test(read("server/auth.js")));
}

finish();
