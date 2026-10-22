# Coach Brain クラウド自動開発：調査・導入・有効化手順

調査日：2026-10-22（Australia/Brisbane）。調査対象は
`CoachTree/coach-brain-swim-planner-pro` の `main`、
`2f9b71a65b46cc706744d5ab9e10b6d7aa16fdb1`。

## 現状と確認の限界

| 対象 | 実際に確認した内容 |
| --- | --- |
| リポジトリ | public、既定ブランチ `main`。auto-merge 設定は false。 |
| アプリ | React 19 / CRA 5 / CRACO 7。`frontend/package-lock.json` と `yarn.lock` が共存。既存のデプロイは npm lock を使用。 |
| テスト | Jest/CRACO による25個のテストファイル。計算、季節計画、セッション生成、UI、ローカル保存、クラウド保存のモック等。ローカル実行で25スイート・844テスト成功。 |
| 既存 Actions | `.github/workflows/deploy-pages.yml` の1本。`push` to `main` と手動実行でビルド・公開。PRテストは未導入。 |
| 公開経路 | Node 20、`npm ci --legacy-peer-deps`、`PUBLIC_URL=. npm run build` → Pages artifact → `github-pages` 環境で公開。テスト実行はない。 |
| 公開実績 | 直近5件の実行は成功。最新は2026-10-20、[run 39349536842](https://github.com/CoachTree/coach-brain-swim-planner-pro/actions/runs/39349536842)。deployログで公開先 `https://coachtree.github.io/coach-brain-swim-planner-pro/` を確認。 |
| main の保護 | branches API は `protected: false`、保護状態 disabled、必須チェックなし。rulesets API は空配列。詳細 protection API は接続アプリの管理権限不足で403。未確認を「保護あり」とは扱わない。 |
| Supabase | 任意のサインイン・クラウド連携がある。ビルド時に `REACT_APP_SUPABASE_URL` と `REACT_APP_SUPABASE_PUBLISHABLE_KEY` を参照。実際の登録有無・値・DB設定は未確認。 |
| その他のデプロイ | `frontend/vercel.json` のSPA rewrite、`frontend/public/_redirects` がある。Vercel/Netlifyの稼働・外部連携は確認できない。 |
| 管理設定 | GitHub接続は設定用APIを一部提供しない。ブラウザは未ログインのため、Pages管理設定、ActionsのPR作成許可、環境の承認者、secret/variable一覧、課金設定は未確認。 |

注意：`SUPABASE_SETUP.md` に旧所有者のPages URLが残っている。
認証リダイレクトURLの実設定は別途確認が必要。このPRでは変更しない。
READMEの「環境変数不要」はローカル中心の利用には当てはまるが、
現在の任意クラウド連携には上記2変数が使われる。

## このPRで追加するもの

- `.github/workflows/ci.yml`：PRの全テスト、静的ビルド、自動化ガードのテスト。
  本番シークレットもデプロイ権限も使用しない。
- `.github/workflows/claude-development.yml`：初期無効・手動起動のClaude開発。
- `scripts/automation/bundle.mjs`：変更範囲・データ・ベースコミットの検査、
  専用ブランチとDraft PRのみを作る固定の公開処理。
- 自動化の境界を確認するテストと `CLAUDE.md`。

既存デプロイ、アプリの挙動、DB、シークレット、支払方法は変更しない。
このPR自体もマージしない。現在は **mainへのマージが本番公開の起点** なので、
マージには本番への影響を確認したうえでの明示的承認が必要。

## Macを閉じていても動く構成

```text
管理者がGitHub Actionsで1件の作業を指定
  ↓ 有効化変数、main指定、main保護、最新コミットを確認
claude-development環境の人の承認
  ↓
GitHub-hosted runner：Claude Codeがローカルで実装・テストコード作成
  GitHub tokenはcontents:read、Anthropic認証はこのジョブのみ
  ↓ 変更ファイルのJSON（短期artifact）
別のrunner：信頼済み検証コードで全変更を検査 → テスト → ビルド
  APIキー・本番シークレット・GitHub書込権限なし
  ↓ 成功時のみ
別のrunner：同じJSONを再検査 → 新規 claude/automation-<run>-<attempt>
  → Draft PR（mainの更新、merge、auto-merge、deploy処理なし）
  ↓
人がPRの差分とチェックを確認し、本番承認後にマージ
```

Claude実行にはGitHubホストのLinux runnerを使う。Mac、ローカル常駐、
個人PCのself-hosted runner、常時稼働VMは不要。

**モデルと書込権限を分離**する。生成ジョブではBashツールを無効にし、
生成したテスト等をAPIキーのある環境で実行させない。
Claudeのrestricted/bareモードでファイル操作範囲を作業領域に限定し、
自動検出の設定・hooks・MCPを読み込ませない。テスト失敗を受けた
自動修正ループは未導入で、初期版は失敗して停止する。
公式Claude Actionには明示的に
`github_token: ${{ github.token }}` を渡し、別のClaude Appによる
write権限トークンへの交換を行わせない。書込ジョブはmain上の検証済み
スクリプトだけを実行し、候補コードの依存インストールやテストを実行しない。

最初の自動変更範囲は限定する。計画・計算の純粋関数11種類と対応テスト、
`frontend/src/components/ui/` の対象ファイルに限定する。
20ファイル、UTF-8内容合計200 KiBまで。削除、実行可能ファイル、symlink、
パストラバーサル、重複パス、不正文字列、古いmainからの公開を拒否する。
正確な許可パスは検証スクリプトを参照。
認証、クラウド保存、DB、課金、ワークフロー、依存設定、エージェント設定、
公開設定は自動変更対象外。必要な拡張は別PRで人がレビューする。

これらは権限と変更範囲の制限であり、生成コードの正しさや無害さを保証する
サンドボックスではない。テストが通っても、人が意味的な変更を確認する。
承認済みの小さな作業だけを入力し、秘密情報や顧客データをプロンプトに入れない。

## 有効化前に必要な設定（未実施・承認待ち）

次の手順は管理者の実施用。シークレットをチャット、Issue、PRに貼らない。

1. **このPRをレビューする。** CI結果を確認する。現状のデプロイがmain更新で
   動くことを確認し、本番承認を得てからマージする。
2. **mainを保護する。** PR必須、必須チェックに`Frontend tests and build` と `Automation guard tests` を設定、
   force pushと削除を禁止。可能なら最新変更後のレビューを必須にし、
   管理者・自動化の例外を最小化する。単独所有者は自分のPRを自分で承認
   できないため、第三者レビュー必須にする場合は別の信頼できるreviewerが必要。
   preflightは保護の存在を確認するが、保護ルールの十分性までは証明しない。
3. **専用Environment `claude-development` を作成する。** Deployment branchesを
   `main`だけに限定し、required reviewerを設定。1人運用で自分が開始・承認する
   場合はself-review禁止との両立に注意する。Environmentは存在しないと自動作成
   され得るので、名前を書くだけでは承認保護にならない。
4. **Anthropicの認証と支出を承認する。** この実装の既定は専用APIキー。
   専用workspaceの利用上限・通知と支払方法を本人が確認し、そのEnvironmentに
   `ANTHROPIC_API_KEY` を登録。Supabaseや決済サービスのキーは渡さない。
   モデルにはソースと作業指示が送られることも確認する。
5. **Actions権限を確認する。** Settings → Actions → General の
   “Allow GitHub Actions to create and approve pull requests”を必要に応じて許可。
   この実装はPR作成だけを行い、承認APIを呼ばない。
   許可Actionに固定済みの公式Actionが含まれることを確認。
   既定tokenを一律writeへ変更する必要はなく、publishジョブだけが書込権限を要求。
6. **費用を確認する。** Anthropic API利用とGitHub Actions利用・artifact保存は別枠。
   実装は1実行20ターン、Claudeジョブ30分、見積り5 USDの停止目安、同時1件。
   `--max-budget-usd 5` は請求額の厳密な上限ではなく超過し得る。
   プロバイダ側の制限を併用する。無料枠や実際の残枠は未確認。
7. **最後に有効化する。** Repository variable
   `CLAUDE_AUTOMATION_ENABLED=true` を登録する。未設定/falseでは全処理を開始しない。
8. **小さな作業で試運転する。** Actions → Claude development → Run workflow、
   branch `main` を選択。例えば「seasonCalendarの境界条件の回帰テストを追加」。
   Environment承認後はMacを閉じてもクラウド側で続く。
   成功時のDraft PRを確認し、最初の1回はマージせず結果を点検する。

Pro/Max等のサブスクリプション認証を使う場合、本人が `claude setup-token` で
発行したトークンをEnvironmentの `CLAUDE_CODE_OAUTH_TOKEN` に登録し、workflowの
`anthropic_api_key` 入力を `claude_code_oauth_token` に切り替える別のレビューが必要。
今回はAPI方式のコードだけを用意し、どちらの認証も作成・登録・使用していない。
Claude GitHub Appの追加インストールや広いPATは、この方式では前提にしない。

## 運用と次の段階

- **停止**：`CLAUDE_AUTOMATION_ENABLED=false` とし、進行中のrunはActionsでCancel。
  変数変更だけでは既に開始したAPI呼び出しを停止しない。
- **失敗**：変更のない結果、範囲外の変更、テスト失敗、main更新は公開しない。
  runログを確認し、範囲を狭くして新しい実行を開始する。自動再試行はない。
  API処理の一部失敗では専用ブランチだけが残る場合がある。mainは変更されない。
- **PRチェック**：GITHUB_TOKENが作成/更新したPRのopened/synchronize/reopenedで、
  現行GitHub仕様ではCIが承認待ちになる場合がある。PRの “Approve workflows to run”
  をwrite権限者が実行する。publish前の独立検証は必須チェックの代わりにはならない。
- **記録**：候補artifactは1日保存。APIキーやClaude全文ログをartifactに保存しない。
  GitHubのrunログはリポジトリ設定に従う。publicなので作業指示も公開前提で扱う。
- **定期実行**：初回の成功と費用確認後に別PRで追加する。承認済みIssueの固定スナップショット、
  Issueごとの重複防止、1回1件、日次回数上限を設ける。現状はscheduleも@claudeトリガーもない。
  GitHub scheduleは遅延/欠落やpublic repoの長期無活動での停止があるため、時刻保証には使わない。
- **本番デプロイの保護**：github-pages環境の承認者・main限定を確認する。
  デプロイ前テストやNode 22への更新は別PR・本番承認で行う。今回のCIはNode 22。
  lockfile内のSupabase 2.111.0はNode >=22を要求し、既存デプロイのNode 20とは不整合がある。
- **テストの限界**：現在のJestは本番Supabase、実ブラウザの認証・決済、PDFの見た目を
  エンドツーエンドで保証しない。それらは必要に応じて別途検証する。

## 公式資料

- [Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions)
- [固定したClaude Action v1.0.258](https://github.com/anthropics/claude-code-action/commit/6b6870e649b5ff408753befeaee5fc7989d4e6a9)
- [Claude CLIの制限オプション](https://code.claude.com/docs/en/cli-reference)
- [GitHubトークンからのworkflow起動](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [GitHub Environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [GitHub Actions課金](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

## 検証記録

- ローカル Node.js 24.16.0：`CI=true npm test -- --watchAll=false --runInBand`、
  25スイート・844テスト成功（約24秒）。
- `CI=true PUBLIC_URL=. npm run build`：成功。main JavaScript gzip約368.25 kB。
- `node --test scripts/automation/*.test.mjs`：23テスト成功。
  GitHubへの書込はmockで検査し、APIや本番には接続していない。
- 全workflowのYAML解析、起動条件・権限・ジョブ依存関係の確認、差分の空白検査：成功。
- Node.js 22の実行はPRのGitHub CIで確認する。クラウドClaudeのAPI実行は
  認証・予算未承認のため未実施。手動workflowの初回実行は有効化後の確認事項。
- 任意のvisual-edits未導入、古いBrowserslistデータ、依存パッケージの非推奨警告がある。
  このPRでは依存更新を行わない。製品コードと既存lockfileに変更なし。
