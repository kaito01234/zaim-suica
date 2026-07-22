# zaim-suica (Google Apps Script 版)

Google Drive の特定フォルダに置かれた **Suica CSV** を定期的にチェックし、
**新規取引だけ**を抽出して Zaim に自動登録する GAS プロジェクト。

- サーバー不要。GAS の時間主導トリガーでフォルダをポーリング（既定 15 分ごと）。
- 過去分と重複する CSV でも、取込ログ（Spreadsheet）と突き合わせて**差分だけ**登録。
- Zaim 認証は既存の永続アクセストークンを再利用（GAS 内で OAuth 認可のやり直し不要）。
- 乗車→支出 / 物販→支出 / チャージ→**収入**（`ZAIM_CHARGE_MODE=transfer` で振替に切替可）。

> CSV を Drive に出力する部分は本プロジェクトの対象外です（手動アップロード等を想定）。

## 仕組み

```
[Drive フォルダ] --(15分ごと polling)--> pollAndImport()
   *.csv を検出
     └ 前回の最終更新時刻(HWM)より新しいファイルだけ中身を読む
       └ 各行を key= 日付|金額|内容#出現回数 に変換
         └ imported シートに無い key だけ Zaim へ登録
           └ 登録した key を imported シートに追記 / HWM を更新
```

> CSV が過去分を含めフォルダに**永久に溜まり続けても問題ありません**。
> 古いファイルは HWM 判定で中身を読まずにスキップし、毎回読むのは新規/更新分だけです。
> 万一古いファイルを読み直しても、行単位の重複排除が二重登録を防ぎます。

### 重複排除（差分抽出）の考え方

- キーは `日付|金額|内容` に **同一内容の出現回数** `#0, #1, ...` を付けたもの。
  - 同じ日に全く同じ運賃・同じ区間の明細が 2 件あっても、`#0` `#1` として両方取り込める。
  - 過去分を含む CSV を再アップロードしても、既存 key は自動でスキップ。
- 判定は **Zaim への問い合わせではなく取込ログ（Spreadsheet）** で行う。高速かつ誤判定が少ない。
- 処理済みファイルは**最終更新時刻の最大値（HWM）をスクリプトプロパティに1つ**だけ保持し、
  それより古いファイルは中身を読まずにスキップ。フォルダが無限に増えても効率が落ちない。
- ファイルごとに「登録→ログ保存→HWM更新」を完結させるので、実行時間上限で中断しても
  完了済みファイル分が二重登録されることはない。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `Code.gs` | メイン。`pollAndImport`（本番） / `pollImportDryRun`（確認） / `installTrigger` |
| `Zaim.gs` | Zaim API クライアント（OAuth1.0a / HMAC-SHA1） |
| `Csv.gs` | CSV パース・種別判定・レコード化 |
| `State.gs` | 取込ログ Spreadsheet の読み書き |
| `Config.gs` | スクリプトプロパティの取得 |
| `appsscript.json` | マニフェスト（OAuth スコープ） |

## セットアップ

### 1. プロジェクト作成

**方法A: 手動コピペ**
[script.google.com](https://script.google.com/) で新規プロジェクトを作り、`*.gs` の中身を同名ファイルに貼り付け。
`appsscript.json` は「プロジェクトの設定 >『appsscript.json』マニフェスト ファイルをエディタで表示する」をONにして貼り付け。

**方法B: clasp（推奨・CLI）**
```sh
npm install -g @google/clasp
clasp login
clasp create --type standalone --title "zaim-suica" --rootDir ./gas
clasp push
```

### 2. スクリプトプロパティを登録

エディタの「プロジェクトの設定 > スクリプト プロパティ」で以下を追加（値は親ディレクトリの `.env` からコピー）。

| キー | 値 |
| --- | --- |
| `ZAIM_CONSUMER_KEY` | （`.env` の値） |
| `ZAIM_CONSUMER_SECRET` | （`.env` の値） |
| `ZAIM_ACCESS_TOKEN` | （`.env` の値） |
| `ZAIM_ACCESS_TOKEN_SECRET` | （`.env` の値） |
| `DRIVE_FOLDER_ID` | 監視する Drive フォルダの ID（フォルダURLの末尾） |
| `ZAIM_SUICA_ACCOUNT` | `モバイル Suica` |
| `ZAIM_CHARGE_MODE` | `income`（収入） or `transfer`（振替）。既定 `income` |
| `ZAIM_CHARGE_INCOME_CATEGORY` | `income` のとき使う収入カテゴリ。例 `その他` |
| `ZAIM_CHARGE_FROM_ACCOUNT` | `transfer` のときの資金元口座。例 `お財布` |
| `ZAIM_TRANSIT_CATEGORY` / `ZAIM_TRANSIT_GENRE` | `交通` / `電車` |
| `ZAIM_SHOPPING_CATEGORY` / `ZAIM_SHOPPING_GENRE` | `食費` / `その他` |
| `CSV_ENCODING` | （任意）Shift_JIS の CSV なら `Shift_JIS` |
| `POLL_MINUTES` | （任意）ポーリング間隔。`1/5/10/15/30` のいずれか。既定 15 |

`STATE_SPREADSHEET_ID` と `LAST_MODIFIED_HWM` は未設定でOK（実行時に自動作成・自動更新されます）。

### 3. 権限承認 & 動作確認

1. エディタで `pollImportDryRun` を選び「実行」。初回は OAuth スコープの承認を求められるので許可。
2. 実行ログに `[new] ...` として **登録される予定の明細**が出ることを確認。
3. 問題なければ `pollAndImport` を手動実行 → Zaim に登録され、`zaim-suica-state` の `imported` シートにログが残る。

### 4. トリガー作成

`installTrigger` を一度実行すると、`POLL_MINUTES`（既定 15 分）ごとに `pollAndImport` が自動実行されます。
停止したいときは `uninstallTrigger` を実行。

## 注意

- Zaim API の日付は「過去・未来 5 年以内」が有効。それ以前の明細は登録に失敗します。
- スクリプトプロパティにトークンを保存します。プロジェクトの共有範囲に注意してください。
- 取込ログを消すと（`imported` シートを空にすると）次回に全件が「新規」とみなされ再登録されます。
