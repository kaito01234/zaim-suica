/**
 * メインエントリ。時間主導トリガーから pollAndImport を定期実行する。
 *
 * 初回セットアップ:
 *   1) スクリプトプロパティに Config.gs 記載の値を登録
 *   2) installTrigger() を一度実行してトリガーを作成
 *   3) （任意）pollImportDryRun() で登録せず変換結果だけログ確認
 */

// 監視フォルダを走査し、新規または更新された CSV のうち未取込の明細だけを Zaim に登録する
function pollAndImport() {
  runImport_(false);
}

// 登録せず、取込対象になる明細をログ出力するだけ（動作確認用）
function pollImportDryRun() {
  runImport_(true);
}

function runImport_(dryRun) {
  var folderId = requireProp_('DRIVE_FOLDER_ID');
  var folder = DriveApp.getFolderById(folderId);
  var encoding = CSV_ENCODING;

  var ss = getStateSpreadsheet_();

  // 前回処理した最終更新時刻。これより古いファイルは中身を読まずにスキップする。
  // フォルダに CSV が溜まり続けても、毎回読むのは新規または更新された分だけになる。
  var hwm = dryRun ? 0 : getHwm_();

  var targets = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (!/\.csv$/i.test(f.getName())) continue;
    // 境界を取りこぼさないよう >= で比較（重複は行単位の dedup が防ぐ）
    if (f.getLastUpdated().getTime() < hwm) continue;
    targets.push(f);
  }

  if (targets.length === 0) {
    Logger.log('新規/更新された CSV はありません。');
    return;
  }

  // 古いファイルから順に処理（出現回数の付与順を安定させる）
  targets.sort(function (a, b) {
    return a.getLastUpdated().getTime() - b.getLastUpdated().getTime();
  });

  var seen = loadSeenKeys_(ss);
  var ids = null; // 新規行が出るまで API 解決を遅延
  var newCount = 0;

  // ファイルごとに「登録 → ログ保存 → HWM更新」を完結させる。
  // 途中で実行時間上限に達しても、完了済みファイル分は二重登録されない。
  for (var i = 0; i < targets.length; i++) {
    var file = targets[i];
    var content = file.getBlob().getDataAsString(encoding);
    var rows = parseCsv_(content);

    // 出現回数はファイル単位で 0 から数え直す（同一 CSV を再処理しても key が一致するように）
    var counters = {};
    var fileRows = [];
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var base = baseKey_(row);
      var occ = counters[base] || 0;
      var full = base + '#' + occ;
      counters[base] = occ + 1;

      if (seen[full]) continue; // 既に取込済み
      newCount++;

      var kind = classify_(row);
      if (dryRun) {
        Logger.log('[new] ' + full + ' (' + kind + ')');
        seen[full] = true;
        continue;
      }

      if (!ids) ids = resolveIds_(getMapping());
      var rec = buildRecord_(kind, row, ids);
      var zaimId = postRecord_(rec);
      seen[full] = true;
      fileRows.push([full, rec.date, rec.kind, rec.amount, rec.comment, zaimId, file.getName(), new Date()]);
      Utilities.sleep(300); // レート制限対策
    }

    if (!dryRun) {
      appendImportedRows_(ss, fileRows);
      setHwm_(file.getLastUpdated().getTime()); // このファイルまで処理済み
    }
  }

  Logger.log(
    (dryRun ? '[dry-run] ' : '') +
      '対象ファイル ' + targets.length + ' 件 / 新規明細 ' + newCount + ' 件' +
      (dryRun ? '' : ' を登録しました。'),
  );
}

// 時間主導トリガーを作成（既存の pollAndImport トリガーは張り替える）
function installTrigger() {
  var minutes = POLL_MINUTES;
  if ([1, 5, 10, 15, 30].indexOf(minutes) === -1) minutes = 15; // everyMinutes は 1, 5, 10, 15, 30 のみ受け付ける
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pollAndImport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pollAndImport').timeBased().everyMinutes(minutes).create();
  Logger.log(minutes + ' 分ごとのトリガーを作成しました。');
}

// トリガーを削除
function uninstallTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pollAndImport') ScriptApp.deleteTrigger(t);
  });
  Logger.log('トリガーを削除しました。');
}
