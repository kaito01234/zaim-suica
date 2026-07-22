/**
 * 設定はすべて「スクリプト プロパティ」に保存する（コードにトークンを埋め込まない）。
 * プロジェクトの設定 > スクリプト プロパティ から以下を登録しておくこと。
 *
 *   ZAIM_CONSUMER_KEY / ZAIM_CONSUMER_SECRET
 *   ZAIM_ACCESS_TOKEN / ZAIM_ACCESS_TOKEN_SECRET
 *   ZAIM_SUICA_ACCOUNT          … Suica に対応する Zaim 口座名
 *   ZAIM_CHARGE_FROM_ACCOUNT    … チャージの資金元口座名
 *   ZAIM_TRANSIT_CATEGORY / ZAIM_TRANSIT_GENRE
 *   ZAIM_SHOPPING_CATEGORY / ZAIM_SHOPPING_GENRE
 *   DRIVE_FOLDER_ID             … 監視する Drive フォルダの ID
 *   CSV_ENCODING                … 省略時 UTF-8（Shift_JIS の場合は指定）
 *   STATE_SPREADSHEET_ID        … 取込ログの Spreadsheet ID（未設定なら初回に自動作成）
 */

function props_() {
  return PropertiesService.getScriptProperties();
}

function prop_(key, fallback) {
  var v = props_().getProperty(key);
  return v === null || v === undefined || v === '' ? fallback : v;
}

function requireProp_(key) {
  var v = props_().getProperty(key);
  if (!v) throw new Error('スクリプトプロパティ ' + key + ' が未設定です。');
  return v;
}

function getZaimCreds() {
  return {
    consumerKey: requireProp_('ZAIM_CONSUMER_KEY'),
    consumerSecret: requireProp_('ZAIM_CONSUMER_SECRET'),
    token: requireProp_('ZAIM_ACCESS_TOKEN'),
    tokenSecret: requireProp_('ZAIM_ACCESS_TOKEN_SECRET'),
  };
}

function getMapping() {
  return {
    suicaAccount: prop_('ZAIM_SUICA_ACCOUNT', 'Suica'),
    chargeMode: prop_('ZAIM_CHARGE_MODE', 'income'), // income=収入 / transfer=振替
    chargeFromAccount: prop_('ZAIM_CHARGE_FROM_ACCOUNT', '現金'),
    chargeIncomeCategory: prop_('ZAIM_CHARGE_INCOME_CATEGORY', 'その他'),
    transitCategory: prop_('ZAIM_TRANSIT_CATEGORY', '交通'),
    transitGenre: prop_('ZAIM_TRANSIT_GENRE', '電車'),
    shoppingCategory: prop_('ZAIM_SHOPPING_CATEGORY', '食費'),
    shoppingGenre: prop_('ZAIM_SHOPPING_GENRE', 'その他'),
  };
}
