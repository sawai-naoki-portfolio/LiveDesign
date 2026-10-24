// public/js/studio/editor/constants.js
// エディタのあちこちで使う選択肢。

/** ゴールの「数える値」に選べる、サーバーが数えている値 */
export const STAT_OPTIONS = [
  ["likes", "いいね数（配信累計）"],
  ["followers", "フォロー数（今回）"],
  ["shares", "シェア数（今回）"],
  ["coins", "ギフトのコイン（今回）"],
  ["gifts", "ギフトの個数（今回）"],
  ["comments", "コメント数（今回）"],
  ["joins", "入室数（今回）"],
];

export const TTS_LANGS = [
  ["ja-JP", "日本語"], ["en-US", "英語（米）"], ["en-GB", "英語（英）"], ["ko-KR", "韓国語"],
  ["zh-CN", "中国語（簡体）"], ["zh-TW", "中国語（繁体）"], ["es-ES", "スペイン語"], ["fr-FR", "フランス語"],
];

/** 見本（テンプレートや素材の小さな絵）の文字に差し込む値 */
export const SAMPLE_VALUES = Object.freeze({
  likes: 1234, followers: 56, comments: 789, coins: 3456, lastFollower: "さくら", lastGifter: "ゆうき",
  lastGift: "ローズ", top1Name: "さくら", top1Coins: 12000, deaths: 3,
});
