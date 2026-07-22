/** Suica CSV のパースと取引種別の判定・レコード化。 */

// "日付,内容,金額" を最初と最後のカンマで3分割（内容にカンマが含まれても安全）
function parseCsv_(text) {
  var lines = text.split(/\r?\n/);
  var rows = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    if (line.indexOf('日付') === 0) continue; // ヘッダー

    var first = line.indexOf(',');
    var last = line.lastIndexOf(',');
    if (first === -1 || first === last) continue;

    var dateRaw = line.slice(0, first).trim();
    var content = line.slice(first + 1, last).trim();
    var amountRaw = line.slice(last + 1).trim().replace(/[,¥\s]/g, '');
    var amount = parseInt(amountRaw, 10);
    if (isNaN(amount)) continue;

    rows.push({
      date: dateRaw.replace(/\//g, '-'),
      content: content,
      amount: amount,
    });
  }
  return rows;
}

// 内容の先頭トークンで種別判定
function classify_(row) {
  var head = row.content.split(/\s+/)[0] || '';
  if (head === 'チャージ') return 'charge';
  if (head === '入' || head === '出') return 'transit';
  if (head === '物販') return 'shopping';
  return 'other';
}

// 重複判定用のベースキー（同一内容の出現回数 #N は呼び出し側で付与）
function baseKey_(row) {
  return [row.date, row.amount, row.content].join('|');
}

// 分類結果と解決済み ID から Zaim 登録レコードを組み立て
function buildRecord_(kind, row, ids) {
  var amount = Math.abs(row.amount);
  var comment = row.content.slice(0, 100);

  if (kind === 'charge') {
    if (ids.chargeMode === 'income') {
      return {
        kind: kind,
        mode: 'income',
        date: row.date,
        amount: amount,
        comment: comment,
        category_id: ids.chargeIncomeCategoryId,
        to_account_id: ids.suicaAccountId,
      };
    }
    return {
      kind: kind,
      mode: 'transfer',
      date: row.date,
      amount: amount,
      comment: comment,
      from_account_id: ids.chargeFromAccountId,
      to_account_id: ids.suicaAccountId,
    };
  }

  var isTransit = kind === 'transit';
  return {
    kind: kind,
    mode: 'payment',
    date: row.date,
    amount: amount,
    comment: comment,
    category_id: isTransit ? ids.transitCategoryId : ids.shoppingCategoryId,
    genre_id: isTransit ? ids.transitGenreId : ids.shoppingGenreId,
    from_account_id: ids.suicaAccountId,
  };
}
