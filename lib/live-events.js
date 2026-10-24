// lib/live-events.js
// TikTok LIVE のイベント（tiktok-live-connector の形）から、人とギフトの情報を読み出す。
// バージョンやイベントの種類によって値の入っている場所が違うので、ここに集めておく。

// ===============================
// 人
// ===============================
/**
 * 人を見分けるキー。表示名（nickName）も @ID（uniqueId）も本人が変えられるので、
 * 変わらない数値の userId を使う。取れないときだけ @ID に落とす。
 */
export function getUserKey(user) {
  const id = user?.userId ?? user?.userIdStr ?? user?.id;
  if (id !== undefined && id !== null && String(id) !== "") return String(id);
  const handle = user?.uniqueId || user?.displayId;
  return handle ? `@${handle}` : null;
}

export function getUserName(user) {
  return user?.nickName || user?.nickname || user?.uniqueId || user?.displayId || "名無し";
}

/** アイコンの URL。イベントの種類によって入っている場所が違う。取れなければ空文字 */
export function getUserAvatar(user) {
  return user?.profilePictureUrl || user?.avatarThumb?.urlList?.[0] || user?.profilePicture?.url?.[0] || "";
}

// ===============================
// ギフト
// ===============================
/**
 * ギフト本体の情報。v2 は `giftDetails`、v1 は `gift`、拡張情報付きは `extendedGiftInfo`。
 * ここを読み違えると連打の判定が素通りになり、ローズ10連打が 1+2+…+10=55コインに化ける。
 */
function giftDetailsOf(data) {
  return data?.giftDetails || data?.gift || data?.extendedGiftInfo || null;
}

export function getGiftName(data) {
  const details = giftDetailsOf(data);
  return data?.giftName || details?.giftName || details?.name || "ギフト";
}

/** ギフト1個あたりのコイン数（取れなければ 0） */
export function getGiftCoin(data) {
  const details = giftDetailsOf(data);
  const coin = Number(details?.diamondCount ?? details?.diamond_count ?? data?.diamondCount);
  return Number.isFinite(coin) && coin > 0 ? coin : 0;
}

/** ギフトの画像の URL（v2 は Image.url が配列、v1 は urlList） */
export function getGiftPictureUrl(data) {
  const details = giftDetailsOf(data);
  return (
    data?.giftPictureUrl ||
    details?.icon?.url?.[0] ||
    details?.image?.url?.[0] ||
    details?.giftImage?.url?.[0] ||
    details?.icon?.urlList?.[0] ||
    details?.image?.urlList?.[0] ||
    ""
  );
}

/**
 * 連打できるギフト（type=1: ローズ・GG など）の連打の途中か。
 * 連打中は repeatCount を増やしながら何度も届くので、終わったときの1回だけを数える。
 * repeatEnd が無いものは「確定」とみなす（数え漏れる方が困るため）。
 */
export function isStreakInProgress(data) {
  const details = giftDetailsOf(data);
  const type = details?.giftType ?? details?.type;
  if (Number(type) !== 1) return false;
  return data?.repeatEnd === 0 || data?.repeatEnd === false;
}
