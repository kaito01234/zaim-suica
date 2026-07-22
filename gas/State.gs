/**
 * 取込状態を保存する。
 *   imported シート（Spreadsheet）：取り込んだ明細のログ。key 列で重複を判定する
 *   LAST_MODIFIED_HWM（スクリプトプロパティ）：処理済みファイルの最終更新時刻の最大値。
 *     これより古いファイルは中身を読まずにスキップする。フォルダが増え続けても効率を保つため
 * STATE_SPREADSHEET_ID が未設定なら初回に自動作成し、ID をプロパティに保存する。
 */

function getStateSpreadsheet_() {
  var id = prop_('STATE_SPREADSHEET_ID', null);
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      // ID が無効なら作り直す
    }
  }
  var ss = SpreadsheetApp.create('zaim-suica-state');
  props_().setProperty('STATE_SPREADSHEET_ID', ss.getId());

  var imported = ss.getActiveSheet();
  imported.setName('imported');
  imported.appendRow(['key', 'date', 'kind', 'amount', 'content', 'zaim_id', 'file', 'imported_at']);

  return ss;
}

function importedSheet_(ss) {
  return ss.getSheetByName('imported');
}

// ハイウォーターマーク（処理済みファイルの最終更新時刻の最大値, ミリ秒）
function getHwm_() {
  return Number(prop_('LAST_MODIFIED_HWM', '0')) || 0;
}
function setHwm_(millis) {
  props_().setProperty('LAST_MODIFIED_HWM', String(millis));
}

// 取込済みフルキー(key#N) の集合を返す
function loadSeenKeys_(ss) {
  var sheet = importedSheet_(ss);
  var last = sheet.getLastRow();
  var seen = {};
  if (last < 2) return seen;
  var values = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    seen[values[i][0]] = true;
  }
  return seen;
}

function appendImportedRows_(ss, rows) {
  if (!rows.length) return;
  var sheet = importedSheet_(ss);
  sheet
    .getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length)
    .setValues(rows);
}
