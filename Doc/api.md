# API 仕様書 — LiveDesign

| 項目 | 内容 |
|---|---|
| ベース URL | `PUBLIC_URL`（例 `https://livedesign.example.com`） |
| 形式 | JSON（`Content-Type: application/json`）。素材のアップロードは Data URL を JSON に入れて送る |
| 文字コード | UTF-8 |
| エラー | `{"error": "日本語のメッセージ"}` とステータスコード。スタックトレースは返さない |
| CSRF 対策 | 書き込み系は `Origin` が自分のサイトでないもの・JSON でないものを 403 で断る（`sameOriginOnly`） |

## 認証方式

| 方式 | 付け方 | 使える範囲 |
|---|---|---|
| セッション Cookie | `ld_session`（HttpOnly・SameSite=Lax・https なら Secure）。ログイン／登録で発行 | `/api/auth/me`・`/api/account/*`・`/api/studio/*`・`/api/live/*` すべて（本人のデータだけ） |
| API キー | `Authorization: Bearer ld_xxxxxxxx` | `POST /api/studio/event`・`POST /api/studio/vars`・`GET /api/studio/vars` の 3 つだけ |
| URL の合鍵 | `/overlay?id=<デザインID>&k=<合鍵>`、WebSocket の `?k=` | オーバーレイ表示用の読み取りのみ |

API キーではデザインの読み書きやアカウントの設定はできないため、**キーが漏れてもアカウントは乗っ取られません**。

---

## 1. 認証 `/api/auth`

| メソッド | パス | 認証 | 内容 | 主なレスポンス |
|---|---|---|---|---|
| GET | `/api/auth/providers` | — | 使えるログイン方法 | `{google, tiktok, registration}` |
| GET | `/api/auth/me` | Cookie | 自分の情報 | `{user}` |
| POST | `/api/auth/register` | — | 新規登録 | 201 `{user}` ＋ Set-Cookie |
| POST | `/api/auth/login` | — | ログイン | 200 `{user}` ＋ Set-Cookie |
| POST | `/api/auth/logout` | Cookie | ログアウト（セッションを削除） | `{ok: true}` |
| GET | `/api/auth/google` ／ `/api/auth/tiktok` | — | OAuth 開始（state を Cookie に保存） | 302 |
| GET | `/api/auth/google/callback` ／ `/api/auth/tiktok/callback` | — | OAuth の戻り | 302 `/studio` |

### POST /api/auth/register

```json
{ "displayName": "さくら", "email": "sakura@example.com", "password": "8文字以上のパスワード" }
```

| ステータス | 条件 |
|---|---|
| 201 | 登録してログイン状態にする |
| 400 | メールの形が不正 ／ パスワードが 8〜200 文字でない |
| 403 | 新規登録を止めている（`REGISTRATION=closed`） |
| 409 | 登録済みのメールアドレス |
| 429 | 同じ IP からの登録が 1 時間に 10 回を超えた |

### POST /api/auth/login

| ステータス | 条件 |
|---|---|
| 200 | ログイン成功 |
| 401 | メールかパスワードが違う（**存在しないメールでも同じ時間をかけて**応答し、登録の有無を推測させない） |
| 429 | 同じ IP＋メールで 15 分に 10 回、または同じ IP で 15 分に 60 回を超えた |

---

## 2. アカウント `/api/account`（Cookie 必須）

| メソッド | パス | 内容 | リクエスト |
|---|---|---|---|
| PATCH | `/api/account` | 表示名・TikTok の @ID を変更 | `{displayName?, tiktokUsername?}`（URL を貼っても @ID に整える） |
| POST | `/api/account/password` | パスワード変更（**ほかの端末のセッションは切る**） | `{current, next}` |
| POST | `/api/account/keys/overlay` | URL の合鍵を作り直す（古い URL の OBS は即座に切断） | — |
| POST | `/api/account/keys/api` | API キーを作り直す | — |
| DELETE | `/api/account` | アカウント削除（デザイン・ギミック・素材・セッションも削除） | `{password}`（パスワード未設定なら `{confirm: "DELETE"}`） |

---

## 3. スタジオ `/api/studio`（Cookie 必須。一部は API キー可）

### デザイン・ギミック（同じ形の REST）

`/api/studio/scenes`（デザイン）と `/api/studio/gimmicks`（ギミック）は、`documentRoutes()` で同じ形に作っています。

| メソッド | パス | 内容 | 補足 |
|---|---|---|---|
| GET | `/api/studio/{kind}` | 自分の一覧（要約） | |
| GET | `/api/studio/{kind}/:id` | 1 件の本文 | 他人の ID は 404 |
| POST | `/api/studio/{kind}` | 作成（201） | 上限（既定 50 件）を超えると 409 |
| PUT | `/api/studio/{kind}/:id` | 上書き保存 | 保存すると開いている OBS の画面がその場で描き直される |
| POST | `/api/studio/{kind}/:id/duplicate` | 複製 | |
| DELETE | `/api/studio/{kind}/:id` | 削除 | |

本文の上限は 8MB。保存前に `lib/studio/scene.js` / `gimmick.js` で**形・数・文字数・色や URL の形**を検査し、保存できる形に整えます（要素 500・入れ子 4 段・ルール 100・1 ルールのアクション 12 など）。

### イベント・カウンター

| メソッド | パス | 認証 | 内容 |
|---|---|---|---|
| POST | `/api/studio/event` | Cookie / **API キー** | イベントを投入。本番と同じルール判定を通る |
| POST | `/api/studio/vars` | Cookie / **API キー** | カウンター・タイマーを操作 |
| GET | `/api/studio/vars` | Cookie / **API キー** | 今の値 |
| POST | `/api/studio/scenes/:id/rules/:ruleId/test` | Cookie | ルールの「テスト」ボタン（クールダウンを無視してそのルールだけ流す） |
| POST | `/api/studio/stats/reset` | Cookie | 今回の配信の数字をリセット |

```bash
curl -X POST https://livedesign.example.com/api/studio/event \
  -H "Authorization: Bearer ld_xxxxxxxx" -H "Content-Type: application/json" \
  -d '{"type":"gift","user":{"name":"さくら"},"gift":{"name":"ローズ","coin":1,"count":5}}'
```

| `type` | 追加の項目 |
|---|---|
| `chat` | `text` |
| `gift` | `gift: {name, coin, count, pictureUrl?}` |
| `like` | `likes` |
| `envelope` | `coins` |
| `follow` / `share` / `join` | — |

```json
{ "kind": "counter", "name": "deaths", "op": "add", "value": 1 }
```

### 素材 `/api/studio/assets`

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/studio/assets` | 自分の素材一覧（使用量と上限は `X-Storage-Used` / `X-Storage-Quota` ヘッダー） |
| POST | `/api/studio/assets` | アップロード（画像 PNG/JPEG/GIF/WebP/AVIF・動画 WebM/MP4・音声 MP3/WAV/OGG、1 ファイル 25MB、合計は `STORAGE_QUOTA_MB`） |
| DELETE | `/api/studio/assets/:name` | 削除 |

SVG と HTML は受け付けません。配布（`/studio-assets/<userId>/<name>`）には `X-Content-Type-Options: nosniff` と `Content-Security-Policy: default-src 'none'` を付けます。

---

## 4. TikTok LIVE 接続 `/api/live`（Cookie 必須）

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/live/status` | 接続状態（unset / idle / connecting / connected / waiting / busy / demo）とエラー内容・次に繋ぎ直す時刻 |
| POST | `/api/live/retry` | 待っている間隔を飛ばして今すぐ繋ぎ直す |

---

## 5. 公開・その他

| メソッド | パス | 認証 | 内容 |
|---|---|---|---|
| GET | `/api/public/scenes/:id?k=` | 合鍵 | オーバーレイ用のデザイン（置いたギミックの中身を添える。他人のギミックは渡らない） |
| GET | `/healthz` | — | DB まで読めれば `{"ok":true}`、読めなければ 503（Docker の HEALTHCHECK 用） |
| GET | `/`・`/login`・`/studio`・`/overlay` | — | ページ。ログイン済みなら `/` と `/login` は `/studio` へ、未ログインの `/studio` は `/login?next=` へ |

---

## 6. WebSocket

| 項目 | 内容 |
|---|---|
| 接続 | `wss://<host>/`（エディタは Cookie、オーバーレイは `?k=合鍵`）。認証できなければ `4401` で閉じる |
| 接続直後 | `{"type":"state", role, demo, connection, studio}` で今の状態をまとめて送る |
| 配信 | **その人の画面にだけ**送る（`broadcastTo(userId, …)`） |
| 受信の上限 | 4KB（配るだけの経路なので大きなメッセージは切る） |
| 生存確認 | 30 秒ごとに ping。応答がなければ切断 |
| 停止時 | `1001` で閉じ、画面は再起動後に自動で繋ぎ直す |

| `type` | 方向 | 内容 |
|---|---|---|
| `state` | サーバー → 画面 | 接続直後の全体状態 |
| `studioEvent` | サーバー → 画面 | 届いたイベント（チャット・ギフト…）。視聴者 ID は載せない |
| `studioAction` | サーバー → 画面 | 発火したルールの見た目のアクション（アラート・パーティクル・音・読み上げ…） |
| `studioScene` / `studioSceneDeleted` | サーバー → 画面 | デザインの保存・削除（OBS がその場で描き直す） |
| `studioGimmick` / `studioGimmickDeleted` | サーバー → 画面 | ギミックの保存・削除 |
| `studioVars` | サーバー → 画面 | カウンター・タイマー・今回の数字（まとめて送る） |
| `connectionStatus` | サーバー → 画面 | TikTok LIVE の接続状態 |
