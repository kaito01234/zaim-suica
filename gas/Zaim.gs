/** Zaim API クライアント。OAuth 1.0a を HMAC-SHA1 署名で扱う。 */

var ZAIM_API_ = 'https://api.zaim.net/v2';

// RFC3986 に準拠したパーセントエンコード
function pctEncode_(value) {
  return encodeURIComponent(String(value)).replace(/[!*'()]/g, function (c) {
    return '%' + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

// 署名の対象と実際の送信でエンコードを一致させるため、クエリとボディの文字列を自前で組み立てる
function encodeParams_(params) {
  return Object.keys(params)
    .map(function (k) {
      return pctEncode_(k) + '=' + pctEncode_(params[k]);
    })
    .join('&');
}

function signatureBaseString_(method, url, params) {
  var enc = Object.keys(params)
    .sort()
    .map(function (k) {
      return pctEncode_(k) + '=' + pctEncode_(params[k]);
    })
    .join('&');
  return [method.toUpperCase(), pctEncode_(url), pctEncode_(enc)].join('&');
}

function buildAuthHeader_(method, url, params, creds) {
  var oauth = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: Utilities.getUuid().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.token,
    oauth_version: '1.0',
  };

  var all = {};
  Object.keys(params).forEach(function (k) {
    all[k] = params[k];
  });
  Object.keys(oauth).forEach(function (k) {
    all[k] = oauth[k];
  });

  var base = signatureBaseString_(method, url, all);
  var signingKey = pctEncode_(creds.consumerSecret) + '&' + pctEncode_(creds.tokenSecret || '');
  var sig = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_1,
    base,
    signingKey,
  );
  oauth.oauth_signature = Utilities.base64Encode(sig);

  return (
    'OAuth ' +
    Object.keys(oauth)
      .sort()
      .map(function (k) {
        return pctEncode_(k) + '="' + pctEncode_(oauth[k]) + '"';
      })
      .join(', ')
  );
}

function zaimRequest_(method, path, params) {
  params = params || {};
  params.mapping = 1;
  var url = ZAIM_API_ + path;
  var creds = getZaimCreds();
  var header = buildAuthHeader_(method, url, params, creds);

  var options = {
    method: method.toLowerCase(),
    headers: { Authorization: header },
    muteHttpExceptions: true,
  };

  var finalUrl = url;
  var body = encodeParams_(params);
  if (method === 'GET') {
    if (body) finalUrl += '?' + body;
  } else {
    options.contentType = 'application/x-www-form-urlencoded';
    options.payload = body;
  }

  var res = UrlFetchApp.fetch(finalUrl, options);
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Zaim API ' + code + ': ' + text);
  }
  return JSON.parse(text);
}

// 口座、カテゴリ、ジャンルの名前を ID に解決する
function resolveIds_(mapping) {
  var accounts = zaimRequest_('GET', '/home/account').accounts;
  var categories = zaimRequest_('GET', '/home/category').categories;
  var genres = zaimRequest_('GET', '/home/genre').genres;

  function findAccount(name) {
    var hit = accounts.filter(function (a) {
      return a.name === name;
    })[0];
    if (!hit)
      throw new Error(
        '口座「' + name + '」が見つかりません。候補: ' + accounts.map(function (a) { return a.name; }).join(', '),
      );
    return hit.id;
  }
  function findCategory(name, mode) {
    mode = mode || 'payment';
    var hit = categories.filter(function (c) {
      return c.name === name && c.mode === mode;
    })[0];
    if (!hit)
      throw new Error('カテゴリ「' + name + '」(' + mode + ') が見つかりません。');
    return hit.id;
  }
  function findGenre(name, categoryId) {
    var hit =
      genres.filter(function (g) {
        return g.name === name && g.category_id === categoryId;
      })[0] ||
      genres.filter(function (g) {
        return g.name === name;
      })[0];
    if (!hit) throw new Error('ジャンル「' + name + '」が見つかりません。');
    return hit.id;
  }

  var transitCategoryId = findCategory(mapping.transitCategory);
  var shoppingCategoryId = findCategory(mapping.shoppingCategory);
  return {
    chargeMode: mapping.chargeMode,
    suicaAccountId: findAccount(mapping.suicaAccount),
    // チャージの扱いに応じて必要なものだけ解決
    chargeFromAccountId:
      mapping.chargeMode === 'transfer' ? findAccount(mapping.chargeFromAccount) : 0,
    chargeIncomeCategoryId:
      mapping.chargeMode === 'income'
        ? findCategory(mapping.chargeIncomeCategory, 'income')
        : 0,
    transitCategoryId: transitCategoryId,
    transitGenreId: findGenre(mapping.transitGenre, transitCategoryId),
    shoppingCategoryId: shoppingCategoryId,
    shoppingGenreId: findGenre(mapping.shoppingGenre, shoppingCategoryId),
  };
}

// レコードを Zaim に登録し、money.id を返す
function postRecord_(rec) {
  var resp;
  if (rec.mode === 'transfer') {
    resp = zaimRequest_('POST', '/home/money/transfer', {
      amount: rec.amount,
      date: rec.date,
      from_account_id: rec.from_account_id,
      to_account_id: rec.to_account_id,
      comment: rec.comment,
    });
  } else if (rec.mode === 'income') {
    resp = zaimRequest_('POST', '/home/money/income', {
      category_id: rec.category_id,
      amount: rec.amount,
      date: rec.date,
      to_account_id: rec.to_account_id,
      comment: rec.comment,
      place: rec.comment,
    });
  } else {
    resp = zaimRequest_('POST', '/home/money/payment', {
      category_id: rec.category_id,
      genre_id: rec.genre_id,
      amount: rec.amount,
      date: rec.date,
      from_account_id: rec.from_account_id,
      comment: rec.comment,
      place: rec.comment,
    });
  }
  return resp && resp.money ? resp.money.id : '';
}
