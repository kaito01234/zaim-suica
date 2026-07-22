# zaim-suica

Suica（交通系IC）の利用明細 CSV を読み取り、家計簿サービス **Zaim** に取引を登録するツール。

Google Drive の特定フォルダに置かれた CSV を定期的にチェックし、まだ登録していない取引だけを抽出して Zaim に登録する。
Google Apps Script（GAS）の時間主導トリガーで、フォルダを一定間隔（既定は 15 分）ごとに確認する。
過去分を含む CSV を繰り返し置いても、取込ログ（Spreadsheet）と照合して差分だけを登録する。

CSV を Drive に出力する処理は、本プロジェクトの対象外とする（手動アップロードなどを想定する）。

## 取り込む CSV と分類

`日付, 内容, 金額` の 3 列からなる CSV を想定する。
「内容」の先頭語から取引の種別を判定し、種別ごとに Zaim への登録方法を振り分ける。

| CSV の内容 | 種別 | Zaim への登録 |
| --- | --- | --- |
| `入 …出 …` | 乗車 | 支出（カテゴリ=交通、ジャンル=電車、口座=Suica） |
| `物販 …` | 買い物 | 支出（カテゴリ=食費、ジャンル=その他、口座=Suica） |
| `チャージ …` | チャージ | 収入（既定）または振替。`Config.gs` の `chargeMode` で切り替える |

## 仕組み

```
[Drive フォルダ] --(15分ごとに polling)--> pollAndImport()
   *.csv を検出
     └ 前回の最終更新時刻(HWM)より新しいファイルだけ中身を読む
       └ 各行を key = 日付|金額|内容#出現回数 に変換
         └ imported シートに無い key だけ Zaim へ登録
           └ 登録した key を imported シートに追記し、HWM を更新
```

CSV が過去分を含めてフォルダに溜まり続けても支障はない。
古いファイルは後述の HWM 判定で中身を読まずにスキップし、毎回読むのは新規または更新されたファイルだけである。
仮に古いファイルを読み直しても、行単位の重複排除が二重登録を防ぐ。

### 差分抽出の考え方

重複判定のキーは、`日付|金額|内容` に**出現回数** `#0, #1, …` を付けた文字列である。
同じ日に同じ運賃で同じ区間の明細が 2 件あっても、`#0` と `#1` として両方を取り込める。
過去分を含む CSV を再び置いても、既存のキーは自動でスキップする。

判定には、Zaim への問い合わせではなく取込ログ（Spreadsheet）を使う。
問い合わせよりも速く、誤判定も起きにくい。

処理済みファイルは、最終更新時刻の最大値（**HWM**、high-water mark）をスクリプトプロパティに 1 つだけ保持する。
HWM より古いファイルは中身を読まずにスキップするので、フォルダが増え続けても処理量は膨らまない。

登録とログ保存と HWM 更新は、ファイル単位で完結させる。
実行時間の上限で途中中断しても、完了済みのファイル分が二重登録されることはない。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| [gas/Code.gs](gas/Code.gs) | メイン。`pollAndImport`（本番実行）、`pollImportDryRun`（確認）、`installTrigger`（トリガー設置） |
| [gas/Zaim.gs](gas/Zaim.gs) | Zaim API クライアント（OAuth 1.0a、HMAC-SHA1 署名） |
| [gas/Csv.gs](gas/Csv.gs) | CSV の解析、種別判定、登録レコードの生成 |
| [gas/State.gs](gas/State.gs) | 取込ログ Spreadsheet の読み書き |
| [gas/Config.gs](gas/Config.gs) | 設定の読み出しとマッピング定義 |
| [gas/appsscript.json](gas/appsscript.json) | マニフェスト（OAuth スコープ） |

## デプロイ（GitHub Actions）

`main` に push すると、[.github/workflows/deploy-gas.yml](.github/workflows/deploy-gas.yml) が `clasp push` で `gas/` の内容を Apps Script プロジェクトに反映する。
コードの編集は Codespace でもローカルでもよく、push するだけで反映される。手動コピペは要らない。

初回だけ、次の準備が必要になる。

1. scriptId を設定する。
   Apps Script エディタの URL `https://script.google.com/home/projects/<scriptId>/edit` から `<scriptId>` を取得し、[.clasp.json](.clasp.json) の `PUT_YOUR_SCRIPT_ID_HERE` を置き換える。

2. clasp の認証情報を取得する。
   clasp のログインはブラウザから localhost にコールバックを返す方式で、Codespace では localhost に戻れないため直接は完了できない（かつての `--no-localhost` の OOB 方式も Google が廃止済み）。
   Codespace で取得するには、次のどちらかを使う。
   - **VS Code デスクトップから Codespace に接続して `clasp login`**：ポートが手元の localhost に転送されるので、そのままログインできる。
   - **ブラウザだけの Codespace**：`clasp login` の URL を承認すると `http://localhost:PORT/?code=…` に飛んで表示エラーになる。その `code=…` を含む URL を、Ports パネルにある転送先の公開 URL（`https://<codespace>-<PORT>.app.github.dev/?code=…`）に置き換えて開くと、ログインが完了する。

   どちらでも `~/.clasprc.json` が生成される。

3. 認証情報を Secret に登録する。
   `cat ~/.clasprc.json` の中身をコピーし、GitHub の Settings、Secrets and variables、Actions で `CLASPRC_JSON` という名前のリポジトリ Secret に貼り付ける。

以降は `main` への push で自動反映される。
手動で流すときは Actions タブから `Deploy to Apps Script` を `Run workflow`（workflow_dispatch）で実行する。

> `~/.clasprc.json` には Google のトークンが入る。Secret にだけ登録し、コミットしない（`.gitignore` 済み）。
> `.clasp.json` は scriptId だけなので、コミットしてよい。
> ワークフローは `push` でのみ動き、`pull_request` では動かない。Public リポジトリで Secret を露出させないため。

## セットアップ

### 1. GAS プロジェクトを用意する

Apps Script プロジェクトがまだ無ければ、Codespace で `clasp login` 後に `clasp create --type standalone --title zaim-suica --rootDir gas` で作成する。
既存のプロジェクトを使う場合は、上記デプロイ手順のとおり scriptId を [.clasp.json](.clasp.json) に設定する。
コードの反映は上記のデプロイ（push）に任せる。

### 2. スクリプトプロパティを登録する

エディタの「プロジェクトの設定」の「スクリプト プロパティ」で登録する。
登録が必須なのは、秘密情報のトークンと環境ごとに変わるフォルダ ID だけである。

| キー | 値 |
| --- | --- |
| `ZAIM_CONSUMER_KEY` | dev.zaim.net のアプリ登録で発行した値 |
| `ZAIM_CONSUMER_SECRET` | dev.zaim.net のアプリ登録で発行した値 |
| `ZAIM_ACCESS_TOKEN` | OAuth 認可で取得した値 |
| `ZAIM_ACCESS_TOKEN_SECRET` | OAuth 認可で取得した値 |
| `DRIVE_FOLDER_ID` | 監視する Drive フォルダの ID（フォルダ URL の末尾） |

`STATE_SPREADSHEET_ID` と `LAST_MODIFIED_HWM` は未設定でよい。
実行時に自動で作成、更新される。

### 3. マッピングなどの設定を確認する

口座名やカテゴリ名などのマッピング、CSV の文字コード、ポーリング間隔は、スクリプトプロパティではなく [gas/Config.gs](gas/Config.gs) を直接編集して設定する。
既定値は次のとおりで、Zaim の設定がこれと一致していれば編集は要らない。
変えたい項目や増やしたい項目があれば `Config.gs` を書き換えて `clasp push` する。

| 設定 | 既定値 |
| --- | --- |
| `suicaAccount` | `モバイル Suica` |
| `chargeMode` | `income`（収入）。`transfer` で振替 |
| `chargeIncomeCategory` | `その他` |
| `chargeFromAccount` | `お財布`（`transfer` のときの資金元） |
| `transitCategory`、`transitGenre` | `交通`、`電車` |
| `shoppingCategory`、`shoppingGenre` | `食費`、`その他` |
| `CSV_ENCODING` | `UTF-8`（Shift_JIS の CSV なら `Shift_JIS`） |
| `POLL_MINUTES` | `15`（`1`、`5`、`10`、`15`、`30` のいずれか） |

### 4. 権限の承認と動作確認

1. エディタで `pollImportDryRun` を選んで実行する。
   初回は OAuth スコープの承認を求められるので許可する。
2. 実行ログに `[new] …` として、登録予定の明細が出ることを確認する。
3. 問題なければ `pollAndImport` を手動で実行する。
   Zaim に登録され、`zaim-suica-state` の `imported` シートにログが残る。

### 5. トリガーの作成

`installTrigger` を一度実行すると、`POLL_MINUTES`（既定は 15 分）ごとに `pollAndImport` が自動で実行される。
停止するときは `uninstallTrigger` を実行する。

## 注意

Zaim API に登録できる日付は「過去・未来 5 年以内」に限られる。
それより古い明細は登録に失敗する。

スクリプトプロパティにはトークンを保存する。
プロジェクトの共有範囲に注意する。

取込ログ（`imported` シート）を空にすると、次回の実行で全件が新規と見なされ、再登録される。
