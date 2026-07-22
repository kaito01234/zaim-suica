# zaim-suica

Suica（交通系IC）の利用明細 CSV を読み取り、家計簿サービス **Zaim** に取引を登録するツール。

Google Drive の特定フォルダに置かれた CSV を定期的にチェックし、まだ登録していない取引だけを抽出して Zaim に登録する。
GAS の時間主導トリガーで、フォルダを一定間隔（既定は 15 分）ごとに確認する。
過去分を含む CSV を繰り返し置いても、取込ログ（Spreadsheet）と照合して差分だけを登録する。

CSV を Drive に出力する処理は、本プロジェクトの対象外とする（手動アップロードなどを想定する）。

## 取り込む CSV と分類

取り込む CSV は次の形式を想定する。

```
日付,内容,金額
2021/11/17,入 秋葉原 (つくばエクスプレス)  出 八潮 (つくばエクスプレス),-471
2021/11/17,チャージ 携帯電話,648
2021/11/13,物販 物販端末,-750
```

「内容」の先頭語から取引の種別を判定し、種別ごとに Zaim への登録方法を振り分ける。

| CSV の内容 | 種別 | Zaim への登録 |
| --- | --- | --- |
| `入 …出 …` | 乗車 | 支出（カテゴリ=交通、ジャンル=電車、口座=Suica） |
| `物販 …` | 買い物 | 支出（カテゴリ=食費、ジャンル=その他、口座=Suica） |
| `チャージ …` | チャージ | 収入（既定）または振替。`ZAIM_CHARGE_MODE` で切り替える |

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
| [gas/Config.gs](gas/Config.gs) | スクリプトプロパティの取得 |
| [gas/appsscript.json](gas/appsscript.json) | マニフェスト（OAuth スコープ） |
| [2026-07-13.csv](2026-07-13.csv) | 動作確認用のサンプル CSV |

## 開発環境（GitHub Codespaces と clasp）

このリポジトリには [.devcontainer/devcontainer.json](.devcontainer/devcontainer.json) がある。
Codespace を起動すると、Node 22 と clasp が入った状態で開発できる。
GAS エディタへの手動コピペは要らない。

1. Codespace を起動する（GitHub のリポジトリ画面から Code、Codespaces、Create の順）。
   起動時に clasp が自動でインストールされる。

2. scriptId を設定する。
   Apps Script エディタの URL `https://script.google.com/home/projects/<scriptId>/edit` から `<scriptId>` を取得し、[.clasp.json](.clasp.json) の `PUT_YOUR_SCRIPT_ID_HERE` を置き換える。
   プロジェクトがまだ無ければ、次の login のあとに `clasp create --type standalone --title zaim-suica --rootDir gas` で作成できる。

3. clasp にログインする。
   Codespace はブラウザ認証が使えないので `--no-localhost` を付ける。
   ```sh
   clasp login --no-localhost
   ```
   表示された URL をブラウザで開いて承認し、出てきたコードを端末に貼り付ける。

4. コードを GAS に反映する。
   ```sh
   clasp push --force
   ```
   `.clasp.json` の `rootDir` が `gas` を指すので、反映の対象は `gas/` 配下だけになる。
   GAS 側で直接編集した分を取り込むときは `clasp pull` を使う。

> `clasp login` が作る `~/.clasprc.json` には Google のトークンが入る。
> このファイルはコミットしない（`.gitignore` 済み）。
> `.clasp.json` は scriptId だけなので、コミットしてよい。

## セットアップ

### 1. コードを GAS に配置する

上記の手順で `clasp push` すればよい。
clasp を使わず手動でコピペする場合は、[script.google.com](https://script.google.com/) で新規プロジェクトを作り、`gas/*.gs` を同名のファイルに貼り付ける。
`appsscript.json` は「プロジェクトの設定」で「『appsscript.json』マニフェスト ファイルをエディタで表示する」をオンにしてから貼り付ける。

### 2. スクリプトプロパティを登録する

エディタの「プロジェクトの設定」の「スクリプト プロパティ」で、以下を追加する。
値は `.env` から転記する。

| キー | 値 |
| --- | --- |
| `ZAIM_CONSUMER_KEY` | `.env` の値 |
| `ZAIM_CONSUMER_SECRET` | `.env` の値 |
| `ZAIM_ACCESS_TOKEN` | `.env` の値 |
| `ZAIM_ACCESS_TOKEN_SECRET` | `.env` の値 |
| `DRIVE_FOLDER_ID` | 監視する Drive フォルダの ID（フォルダ URL の末尾） |
| `ZAIM_SUICA_ACCOUNT` | `モバイル Suica` |
| `ZAIM_CHARGE_MODE` | `income`（収入）または `transfer`（振替）。既定は `income` |
| `ZAIM_CHARGE_INCOME_CATEGORY` | `income` のときの収入カテゴリ。例：`その他` |
| `ZAIM_CHARGE_FROM_ACCOUNT` | `transfer` のときの資金元口座。例：`お財布` |
| `ZAIM_TRANSIT_CATEGORY`、`ZAIM_TRANSIT_GENRE` | 乗車のカテゴリとジャンル。例：`交通`、`電車` |
| `ZAIM_SHOPPING_CATEGORY`、`ZAIM_SHOPPING_GENRE` | 物販のカテゴリとジャンル。例：`食費`、`その他` |
| `CSV_ENCODING` | 任意。Shift_JIS の CSV なら `Shift_JIS` |
| `POLL_MINUTES` | 任意。ポーリング間隔。`1`、`5`、`10`、`15`、`30` のいずれか。既定は 15 |

`STATE_SPREADSHEET_ID` と `LAST_MODIFIED_HWM` は未設定でよい。
実行時に自動で作成、更新される。

### 3. 権限の承認と動作確認

1. エディタで `pollImportDryRun` を選んで実行する。
   初回は OAuth スコープの承認を求められるので許可する。
2. 実行ログに `[new] …` として、登録予定の明細が出ることを確認する。
3. 問題なければ `pollAndImport` を手動で実行する。
   Zaim に登録され、`zaim-suica-state` の `imported` シートにログが残る。

### 4. トリガーの作成

`installTrigger` を一度実行すると、`POLL_MINUTES`（既定は 15 分）ごとに `pollAndImport` が自動で実行される。
停止するときは `uninstallTrigger` を実行する。

## 注意

`.env` と `id.txt` は `.gitignore` 済みである。
認証情報はコミットしない。

Zaim API に登録できる日付は「過去・未来 5 年以内」に限られる。
それより古い明細は登録に失敗する。

スクリプトプロパティにはトークンを保存する。
プロジェクトの共有範囲に注意する。

取込ログ（`imported` シート）を空にすると、次回の実行で全件が新規と見なされ、再登録される。
