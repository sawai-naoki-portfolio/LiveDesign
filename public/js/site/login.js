// public/js/site/login.js
// /login … メールとパスワードでのログイン・新規登録と、Google / TikTok でのログイン。
// ?mode=signup で新規登録から、?next=/studio?... でログインのあとに戻る先、?error= で失敗の理由を出す。
(function () {
  const params = new URLSearchParams(location.search);
  // 戻る先は自分のサイトの中だけ。使える文字も絞る（タブや改行はブラウザが消すので、
  // 「/<タブ>/evil.example」が「//evil.example」＝よそのサイトになってしまう）。server/auth.js の safeNext と同じ形
  const NEXT_RE = /^\/(?![/\\])[\w\-./?=&%#~]*$/;
  const next = NEXT_RE.test(params.get("next") || "") ? params.get("next") : "/studio";
  const $ = (id) => document.getElementById(id);
  let mode = params.get("mode") === "signup" ? "signup" : "login";
  let registrationOpen = true;

  function setMode(m) {
    mode = m;
    const signup = mode === "signup";
    $("tabLogin").classList.toggle("active", !signup);
    $("tabSignup").classList.toggle("active", signup);
    $("title").textContent = signup ? "新規登録（無料）" : "ログイン";
    $("lead").textContent = signup
      ? "メールアドレスとパスワードを決めるだけ。TikTok のパスワードは要りません。"
      : "デザインと配信の設定はアカウントに保存されます。";
    $("nameField").hidden = !signup;
    $("password").autocomplete = signup ? "new-password" : "current-password";
    $("password").placeholder = signup ? "8文字以上" : "";
    $("submit").textContent = signup ? "登録してはじめる" : "ログイン";
    $("submit").disabled = signup && !registrationOpen;
    $("closedNote").hidden = !(signup && !registrationOpen);
    $("error").textContent = "";
  }

  $("tabLogin").addEventListener("click", () => setMode("login"));
  $("tabSignup").addEventListener("click", () => setMode("signup"));

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("error").textContent = "";
    $("submit").disabled = true;
    const body = { email: $("email").value, password: $("password").value };
    if (mode === "signup") body.displayName = $("displayName").value;
    try {
      const res = await fetch(mode === "signup" ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "うまくいきませんでした。もう一度お試しください");
      location.href = next;
    } catch (err) {
      $("error").textContent = err.message;
      $("submit").disabled = false;
    }
  });

  if (params.get("error")) $("error").textContent = params.get("error");

  // Google / TikTok でのログインは、運営が鍵を設定しているときだけ出す
  fetch("/api/auth/providers").then((r) => r.json()).then((p) => {
    registrationOpen = p.registration !== false;
    const q = `?next=${encodeURIComponent(next)}`;
    if (p.google) { $("googleBtn").hidden = false; $("googleBtn").href = `/api/auth/google${q}`; }
    if (p.tiktok) { $("tiktokBtn").hidden = false; $("tiktokBtn").href = `/api/auth/tiktok${q}`; }
    $("oauthBlock").hidden = !(p.google || p.tiktok);
    setMode(mode);
  }).catch(() => setMode(mode));

  setMode(mode);
})();
