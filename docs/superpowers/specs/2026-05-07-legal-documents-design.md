# 法的整備（C1+C2）— 設計仕様

**作成日**: 2026-05-07
**対象**: タクシー日報アプリ（dev/prod デプロイ環境）
**スコープ**: C1 法務文書 + C2 システム上の表示・リンク。C3 インボイス対応と申込・退会フロー UI は B（課金統合）に内包。

## 背景

A（車種別データ分割）が完了し、B（admin.html 課金統合）の前提として法的整備が必要。

知人中心の有料課金サービスを開始するにあたり、特商法・利用規約・プライバシーポリシーが必須。「ご請求により開示」方式（消費者庁 2023年ガイドライン許容範囲）で個人情報露出を最小化しつつ、サブスク提供者として最低限の体裁を整える。

## 確定事項

| 項目 | 決定事項 |
|---|---|
| スコープ | C1 法務文書 + C2 フッター/リンク表示 |
| 事業形態 | 個人事業主×「請求により開示」方式 |
| 料金体系 | 月額サブスク 一本（金額は B で確定） |
| 解約 | いつでも可、返金なし、当月末まで利用可 |
| データ削除 | 退会後30日で自動削除、バックアップは90日保持後削除 |
| 文書品質 | テンプレートベース + サービス用カスタマイズ。後日弁護士レビューを前提 |
| 開示請求受付 | メール（具体アドレスは B 着手時に確定） |

## アーキテクチャ

```
タクシー日報/
├── legal/                          (新規ディレクトリ)
│   ├── tokuteishou.html            (特商法表記)
│   ├── terms.html                  (利用規約)
│   └── privacy.html                (プライバシーポリシー)
├── js/
│   └── legal-footer.js             (新規: 共通フッター描画モジュール)
├── css/
│   └── style.css                   (.legal-doc / .legal-footer スタイル追記)
├── docs/
│   └── legal-template-source.md    (新規: テンプレ出典・改訂履歴)
└── 既存 HTML 11ファイル
    フッター呼び出し1行ずつ追加 + sw.js キャッシュ更新
```

## ファイル詳細

### 1. `legal/tokuteishou.html`（特定商取引法に基づく表記）

法定11項目を表で記載。「請求により開示」方式。

| 項目 | 記載内容 |
|---|---|
| 販売事業者 | ご請求があった場合、遅滞なく電子メールにて開示します |
| 運営責任者名 | 同上 |
| 所在地 | 同上 |
| 電話番号 | 同上 |
| メールアドレス | `<TBD: B 着手時に確定>` |
| 販売価格 | 申込画面に表示。月額サブスクリプション制 |
| 支払方法 | クレジットカード等（外部決済サービスを利用） |
| 支払時期 | 月額・前払い |
| 役務の提供時期 | 決済完了後ただちに |
| 返品・キャンセル | サービスの性質上、申込確定後の返金はいたしません。解約はいつでも可能で、当月末までサービスをご利用いただけます |
| 動作環境 | iOS Safari / Android Chrome / デスクトップ各種ブラウザの最新版 |

### 2. `legal/terms.html`（利用規約）

15条構成。タクシー業務 SaaS 特有の条項を含む。

1. 適用範囲
2. 利用登録（招待制、運営者の承認制）
3. アカウント・パスワード管理
4. 料金・支払（外部決済サービス、月額前払い）
5. 本サービスの内容（日報入力、月度集計、車種別分析、営業サポート、シフト管理）
6. **利用者データの取り扱い**（運行データの匿名化集計分析、運営者は個別データ閲覧可能）
7. 禁止事項（不正アクセス、データ偽装、第三者への ID 共有等）
8. サービスの変更・中断・終了（事前告知、メンテナンス、最終的な廃止プロセス）
9. 解約（次月分の課金停止、当月末まで利用可、日割なし）
10. 退会後のデータ（30日保持、その後自動削除、バックアップ90日後削除）
11. **免責事項**（営業成果保証なし、利用結果の責任は利用者、システム障害補償なし）
12. 反社会的勢力の排除
13. 個人情報の取り扱い（プラポリ参照）
14. 規約変更（事前告知、引き続き利用で同意とみなす）
15. 準拠法・裁判管轄（日本法・東京地方裁判所）

#### 第6条（利用者データの取り扱い）の正確な文言

```
1. 当社は、利用者が登録した運行データ（運行日時、エリア、売上、車種等）を、
   本サービスの「営業サポート機能」において匿名化・集計した統計情報として、
   他の利用者にも提供することがあります。

2. 個人を特定できる情報（氏名、userId、個別の日次データ）は、他の利用者には
   提供されません。ただし、サービス運営の必要上、運営者（管理者）には
   個別データが閲覧可能です。

3. 利用者は、本機能による集計分析への登録データの利用に同意するものとします。
```

#### 第11条（免責事項）の正確な文言

```
1. 本サービスが提供する分析・推奨情報は、過去データに基づく統計的参考であり、
   実際の営業成果や売上を保証するものではありません。

2. 本サービスを利用した結果生じた営業上の損失について、運営者は一切責任を
   負いません。

3. 利用者は、本サービスから得られる情報を自身の判断と責任において利用する
   ものとします。

4. システム障害・メンテナンス・天候APIの不具合等による一時的な利用不可に
   ついて、運営者は補償を行いません。
```

### 3. `legal/privacy.html`（プライバシーポリシー）

個人情報保護法準拠 9セクション。

1. 個人情報の定義
2. 取得する情報（userId、パスワードハッシュ、運行データ、デバイス情報、IPアドレス）
3. 利用目的（サービス提供・改善、ベンチマーク統合分析、不正利用防止、お問い合わせ対応）
4. 業務委託先（Google = Firebase、Open-Meteo = 天候API）
5. データ保管場所（Firebase Asia-Northeast1 / 東京）
6. データ保持期間（利用中は永続、退会後30日、バックアップは追加60日）
7. 開示・訂正・削除請求等の手続き（メール受付、本人確認、無料）
8. Cookie・localStorage の使用（自動ログイン、車種フィルタ状態保持）
9. 改定・お問い合わせ

#### 第4条（業務委託先）の正確な文言

```
当社は、データ保管および分析処理のため、以下に業務委託しております。これら
委託先は当社が定めた管理基準に基づき適切に管理しています。

- Google Inc.（Firebase）
  保管場所: Asia-Northeast1（東京）
  目的: ユーザー認証、データ保管、リアルタイム同期

- Open-Meteo
  目的: 天候情報の取得（運行日報の天候記録）

これらは個人情報保護法上の「第三者提供」には該当しません。
```

### 4. `js/legal-footer.js`（共通フッター描画モジュール）

```javascript
// js/legal-footer.js — 法務文書フッターの共通描画モジュール

export function renderLegalFooter() {
  // 既に存在する場合は何もしない（idempotent）
  if (document.querySelector('.legal-footer')) return;

  // 法務ページ内では別表示なのでスキップ
  if (location.pathname.includes('/legal/')) return;

  const footer = document.createElement('footer');
  footer.className = 'legal-footer';
  footer.innerHTML = `
    <div class="legal-footer-links">
      <a href="legal/tokuteishou.html">特定商取引法に基づく表記</a>
      <span class="legal-footer-sep">|</span>
      <a href="legal/terms.html">利用規約</a>
      <span class="legal-footer-sep">|</span>
      <a href="legal/privacy.html">プライバシーポリシー</a>
    </div>
    <div class="legal-footer-copyright">© 2026 [事業者表示名]</div>
  `;

  // bottom-nav の真上に挿入。bottom-nav が無いページは末尾に追加
  const nav = document.querySelector('nav.bottom');
  if (nav) {
    nav.parentNode.insertBefore(footer, nav);
  } else {
    document.body.appendChild(footer);
  }
}
```

### 5. CSS 追記（`css/style.css`）

```css
/* === 法務フッター === */
.legal-footer {
  text-align: center;
  font-size: 11px;
  color: var(--muted);
  padding: 16px 12px 80px; /* bottom: 80px は nav.bottom 56px + 余白 */
  background: var(--bg);
  border-top: 1px solid #e0e0e0;
  margin-top: 24px;
}
.legal-footer-links a {
  color: var(--muted);
  text-decoration: none;
  margin: 0 4px;
  white-space: nowrap;
}
.legal-footer-links a:hover { text-decoration: underline; }
.legal-footer-sep { color: #ccc; margin: 0 4px; }
.legal-footer-copyright { margin-top: 6px; color: #999; font-size: 10px; }

/* === 法務文書ページ === */
.legal-doc {
  max-width: 720px;
  margin: 0 auto;
  padding: 16px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
}
.legal-doc h1 { font-size: 20px; margin: 16px 0 12px; }
.legal-doc h2 { font-size: 16px; margin: 20px 0 8px; padding-top: 8px; border-top: 1px solid #eee; }
.legal-doc table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 12px 0; }
.legal-doc th, .legal-doc td { border: 1px solid #ddd; padding: 8px; text-align: left; vertical-align: top; }
.legal-doc th { background: #f5f5f5; width: 30%; font-weight: 600; }
.legal-doc ol, .legal-doc ul { padding-left: 24px; margin: 8px 0; }
.legal-doc li { margin-bottom: 4px; }
.legal-doc .updated-at { color: var(--muted); font-size: 11px; text-align: right; margin-top: 24px; }
.legal-doc .back-link { display: inline-block; margin: 12px 0; color: var(--primary); text-decoration: none; font-size: 13px; }
```

### 6. 既存 HTML へのフッター呼び出し（11ファイル）

各ファイルの `<script type="module">` 末尾で:

```javascript
import { renderLegalFooter } from './js/legal-footer.js';
renderLegalFooter();
```

対象:
- `index.html`, `input.html`, `detail.html`, `calendar.html`
- `review.html`, `support.html`, `settings.html`, `admin.html`
- `admin-settings.html`, `bulk-input.html`, `tools.html`

非対象（フッター不要）:
- `migrate.html`（管理者向けマイグレーション、外部公開しない）
- `legal/*.html`（自身が法務ページ）

### 7. `sw.js` 編集

キャッシュリストに `legal/*.html` を追加、cache version bump:

```javascript
const CACHE_NAME = 'taxi-daily-v80';
const STATIC_FILES = [
  // ... 既存リスト ...
  './legal/tokuteishou.html',
  './legal/terms.html',
  './legal/privacy.html',
  './js/legal-footer.js',
];
```

### 8. `docs/legal-template-source.md`

テンプレートの出典・改訂履歴を記録。後で弁護士に渡す時の前提資料となる。

```markdown
# 法務文書テンプレート出典・改訂履歴

## 元テンプレート出典
- 特商法表記: 経済産業省 通信販売の表示モデル + 消費者庁 2023年改正特商法ガイドライン
- 利用規約: 経済産業省 SaaS 標準モデル契約 + GitHub 公開 OSS規約 参考
- プラポリ: 個人情報保護委員会 ガイドライン準拠

## カスタマイズ事項
- 利用規約 第6条: タクシー業務データの統合分析を明示（このサービス特有）
- 利用規約 第11条: 営業成果保証なしの免責を強化（タクシー業務 SaaS 特有）
- プラポリ 第4条: Firebase + Open-Meteo を業務委託先として明示

## 改訂履歴
- 2026-05-07 初版作成

## TODO（B 着手時または運営開始時）
- 開示請求受付メールアドレス確定
- 月額サブスク料金確定 → 第4条/特商法表記に反映
- 事業者表示名（屋号 or 本名）確定 → フッター copyright に反映
```

## エッジケース処理

| ケース | 挙動 |
|---|---|
| 法務ページ内でフッター呼び出し | `location.pathname.includes('/legal/')` で skip |
| `nav.bottom` が無いページ | `document.body.appendChild(footer)` でフォールバック |
| フッターが二重描画 | `.legal-footer` 既存check で idempotent |
| 法務ページからホームへ戻る | 各法務ページに `<a class="back-link" href="../index.html">← ホーム</a>` 配置 |

## テスト戦略

C はほぼ静的 HTML + 軽量モジュールなので、ユニットテストは最小限。

### `tests/legal-footer.test.js`（新規、軽量）

JSDOM-less な簡易チェック:
- `renderLegalFooter` が `legal/` パス判定で early return することを確認
- 既存フッター存在時の idempotent 動作

実機確認:
- 11ページすべてでフッター表示
- 3ページ全部のリンクが動く
- スマホ・デスクトップで崩れない

## 実装範囲

| # | ファイル | 種別 | 責務 |
|---|---|---|---|
| 1 | `legal/tokuteishou.html` | 新規 | 特商法表記 |
| 2 | `legal/terms.html` | 新規 | 利用規約 |
| 3 | `legal/privacy.html` | 新規 | プラポリ |
| 4 | `js/legal-footer.js` | 新規 | 共通フッター |
| 5 | `tests/legal-footer.test.js` | 新規 | 軽量ユニットテスト |
| 6 | `css/style.css` | 編集 | 法務フッター・文書スタイル追記 |
| 7 | 11個の既存 HTML | 編集 | フッター呼び出し1行追加 |
| 8 | `sw.js` | 編集 | キャッシュリスト + cache version bump |
| 9 | `docs/legal-template-source.md` | 新規 | テンプレ出典・改訂履歴 |

## スコープアウト

- 申込確認画面の同意 UI → B（課金統合）
- 退会フロー UI → B
- インボイス対応（適格請求書発行） → B
- クッキー同意バナー → 招待制で日本利用のみ、GDPR非該当のため不要
- 問合せフォーム → メールアドレス記載で代替
- 特定電子メール法対応 → 広告メール送信予定なしのため不要
- 景表法表記 → 不当表示なしの運用で対応

## 既知の TBD（B 着手時または運営開始時に確定）

- 開示請求受付メールアドレス
- 月額サブスク料金
- 事業者表示名（フッター copyright および開示時の名称）
- これらが確定したら `docs/legal-template-source.md` の TODO セクションを更新

## 成功基準

ユーザー（運営者）が手動で確認:

- [ ] 全11ページのフッターに3点リンク表示
- [ ] 各リンクが正しい legal ページに遷移
- [ ] スマホ表示でフッターが崩れない（特に nav.bottom との重なり）
- [ ] 全文書が日本語として自然に読める
- [ ] 利用規約 第6条のデータ統合分析の表現が、support.html の実際の挙動と一致
- [ ] 「請求により開示」のメール宛先が動作する
- [ ] `npm test` で既存テスト + `legal-footer.test.js` 全パス
- [ ] dev環境で動作確認後、本番タグ deploy

## デプロイ手順

既存ルール（AGENTS.md）通り:
1. dev リポジトリで実装 → コミット → push
2. `https://hidenaka.github.io/-taxi-daily-report-dev/` で各ページ確認
3. 確認OK後、タグ付け → 自動デプロイで本番反映

## B（課金）への引き継ぎ事項

C 完了時点で B に渡す:
- 申込確認画面に「利用規約に同意する」checkbox を必須に（同意なしで決済不可）
- 退会フロー UI を `settings.html` に追加（「退会する」ボタン）
- 退会後30日カウントダウンの実装
- インボイス対応（適格請求書発行事業者の登録番号表示、請求書フォーマット）
- 月額料金の確定 → 利用規約・特商法表記の更新
