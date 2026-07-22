/**
 * 設定。
 *
 * スクリプトプロパティから読むのは、秘密情報と環境依存の値だけ。
 *   ZAIM_CONSUMER_KEY, ZAIM_CONSUMER_SECRET, ZAIM_ACCESS_TOKEN, ZAIM_ACCESS_TOKEN_SECRET：Zaim のトークン
 *   DRIVE_FOLDER_ID：監視する Drive フォルダの ID
 * これらは requireProp_ で必須にし、未設定なら実行時に例外を投げる。
 *
 * それ以外の設定（マッピング、CSV の文字コード、ポーリング間隔）は、秘密でも環境依存でもないので、
 * このファイルを直接編集して変える。追加したい項目もここに書く。
 *
 * STATE_SPREADSHEET_ID と LAST_MODIFIED_HWM は実行時に自動で作成、更新される。
 */

// CSV の文字コード。Shift_JIS の CSV なら 'Shift_JIS' にする
var CSV_ENCODING = 'UTF-8';

// ポーリング間隔（分）。1, 5, 10, 15, 30 のいずれか
var POLL_MINUTES = 15;

// 取引の振り分け先。Zaim 上の名前で指定する（ID は実行時に解決する）
function getMapping() {
  return {
    suicaAccount: 'モバイル Suica', // 乗車と物販の口座、チャージの入金先
    chargeMode: 'income', // income は収入、transfer は振替
    chargeFromAccount: 'お財布', // transfer のときの資金元
    chargeIncomeCategory: 'その他', // income のときの収入カテゴリ
    transitCategory: '交通',
    transitGenre: '電車',
    shoppingCategory: '食費',
    shoppingGenre: 'その他',
  };
}

function props_() {
  return PropertiesService.getScriptProperties();
}

// 必須のスクリプトプロパティ。未設定なら例外
function requireProp_(key) {
  var v = props_().getProperty(key);
  if (!v) throw new Error('スクリプトプロパティ ' + key + ' が未設定です。');
  return v;
}

// 自動管理される内部状態（STATE_SPREADSHEET_ID, LAST_MODIFIED_HWM）の読み出し用。
// 未設定なら fallback を返す
function prop_(key, fallback) {
  var v = props_().getProperty(key);
  return v === null || v === undefined || v === '' ? fallback : v;
}

function getZaimCreds() {
  return {
    consumerKey: requireProp_('ZAIM_CONSUMER_KEY'),
    consumerSecret: requireProp_('ZAIM_CONSUMER_SECRET'),
    token: requireProp_('ZAIM_ACCESS_TOKEN'),
    tokenSecret: requireProp_('ZAIM_ACCESS_TOKEN_SECRET'),
  };
}
