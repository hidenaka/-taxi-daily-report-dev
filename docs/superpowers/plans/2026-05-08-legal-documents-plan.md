# 法的整備（C1+C2）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 特商法表記・利用規約・プライバシーポリシーの3文書を作成し、共通フッターモジュールを介して既存11ページに法務リンクを追加する。

**Architecture:** 静的HTMLベースの法務文書 + ESM共通フッターモジュール。各HTMLは`renderLegalFooter()` を1行追加するだけで対応。Service Worker キャッシュへの追加とバージョンbumpで PWA も対応。

**Tech Stack:** Vanilla HTML/CSS、ESM (`"type": "module"`)、`node --test`、Firebase / dev-prod デプロイフロー。

**設計仕様**: `docs/superpowers/specs/2026-05-07-legal-documents-design.md` を参照。

---

## ファイル構造

| 種別 | パス | 責務 |
|---|---|---|
| 新規 | `legal/tokuteishou.html` | 特商法表記（11項目テーブル） |
| 新規 | `legal/terms.html` | 利用規約（全15条） |
| 新規 | `legal/privacy.html` | プラポリ（9セクション） |
| 新規 | `js/legal-footer.js` | フッター描画モジュール |
| 新規 | `tests/legal-footer.test.js` | 軽量ユニットテスト |
| 新規 | `docs/legal-template-source.md` | テンプレ出典・改訂履歴 |
| 編集 | `css/style.css` | `.legal-doc` / `.legal-footer` スタイル追記 |
| 編集 | `index.html` | フッター呼び出し |
| 編集 | `input.html` | フッター呼び出し |
| 編集 | `detail.html` | フッター呼び出し |
| 編集 | `calendar.html` | フッター呼び出し |
| 編集 | `review.html` | フッター呼び出し |
| 編集 | `support.html` | フッター呼び出し |
| 編集 | `settings.html` | フッター呼び出し |
| 編集 | `admin.html` | フッター呼び出し |
| 編集 | `admin-settings.html` | フッター呼び出し |
| 編集 | `bulk-input.html` | フッター呼び出し |
| 編集 | `tools.html` | フッター呼び出し |
| 編集 | `sw.js` | キャッシュリスト + version bump |

**重要な前提**:
- 開発は **dev リポジトリ** で行う。`git push dev main` で dev、タグ push で prod。
- パスにスペース・日本語・チルダ含む（iCloud 同期）。常に quote。
- `migrate.html` は対象外（管理者用、外部公開しない）
- 法務文書3点は **fixed copy**（テンプレ + サービス特化文言）。後で弁護士レビュー前提。
- 事業者表示名・メールアドレス・月額料金は spec の TBD として `[TBD-OWNER]` `[TBD-EMAIL]` `[TBD-PRICE]` プレースホルダーで実装、運営開始時に確定。

---

## Task 1: フッター共通モジュール — TDD

**Files:**
- Create: `js/legal-footer.js`
- Test: `tests/legal-footer.test.js`

### - [ ] Step 1.1: 失敗するテストを書く

`tests/legal-footer.test.js` を新規作成:

```javascript
import { test, assert } from './run.js';

// JSDOM-less な簡易DOM環境
function setupMockDom(pathname = '/index.html') {
  globalThis.document = {
    _elements: [],
    _querySelectorAll: {},
    querySelector(sel) {
      if (sel === '.legal-footer') return this._legalFooter || null;
      if (sel === 'nav.bottom') return this._navBottom || null;
      return null;
    },
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        className: '',
        innerHTML: '',
        children: [],
        parentNode: null,
      };
      this._elements.push(el);
      return el;
    },
    body: {
      _children: [],
      appendChild(el) { this._children.push(el); el.parentNode = this; },
    },
  };
  globalThis.location = { pathname };
}

test('renderLegalFooter: 通常ページではフッターが追加される', async () => {
  setupMockDom('/index.html');
  const { renderLegalFooter } = await import(`../js/legal-footer.js?t=${Date.now()}`);
  renderLegalFooter();
  const created = globalThis.document._elements.find(e => e.className === 'legal-footer');
  assert.ok(created, 'legal-footer 要素が作成されるべき');
  assert.ok(created.innerHTML.includes('特定商取引法に基づく表記'));
  assert.ok(created.innerHTML.includes('利用規約'));
  assert.ok(created.innerHTML.includes('プライバシーポリシー'));
});

test('renderLegalFooter: legal/ パス内では skip', async () => {
  setupMockDom('/legal/terms.html');
  const { renderLegalFooter } = await import(`../js/legal-footer.js?t=${Date.now()}`);
  renderLegalFooter();
  const created = globalThis.document._elements.find(e => e.className === 'legal-footer');
  assert.equal(created, undefined, 'legal/ 配下では footer は作成されない');
});

test('renderLegalFooter: 既存フッターがある時は二重描画しない (idempotent)', async () => {
  setupMockDom('/index.html');
  globalThis.document._legalFooter = { className: 'legal-footer' };
  const { renderLegalFooter } = await import(`../js/legal-footer.js?t=${Date.now()}`);
  renderLegalFooter();
  const created = globalThis.document._elements.find(e => e.className === 'legal-footer');
  assert.equal(created, undefined, '既存フッターある時は何もしない');
});

test('renderLegalFooter: nav.bottom がある時はその真上に挿入', async () => {
  setupMockDom('/index.html');
  const navParent = {
    _children: [],
    insertBefore(newEl, ref) { this._children.push({ newEl, ref }); newEl.parentNode = this; },
  };
  const navMock = { parentNode: navParent };
  globalThis.document._navBottom = navMock;
  const { renderLegalFooter } = await import(`../js/legal-footer.js?t=${Date.now()}`);
  renderLegalFooter();
  assert.equal(navParent._children.length, 1);
  assert.equal(navParent._children[0].ref, navMock);
});
```

### - [ ] Step 1.2: テスト実行 → 失敗を確認

Run:
```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報"
npm test -- tests/legal-footer.test.js 2>&1 | tail -10
```

Expected: ERR_MODULE_NOT_FOUND（`js/legal-footer.js` が存在しない）

### - [ ] Step 1.3: `js/legal-footer.js` を実装

```javascript
// js/legal-footer.js — 法務文書フッターの共通描画モジュール

export function renderLegalFooter() {
  // 法務ページ内では別表示なのでスキップ
  if (location.pathname.includes('/legal/')) return;

  // 既に存在する場合は何もしない（idempotent）
  if (document.querySelector('.legal-footer')) return;

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
    <div class="legal-footer-copyright">© 2026 [TBD-OWNER]</div>
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

### - [ ] Step 1.4: テスト全パスを確認

Run:
```bash
npm test -- tests/legal-footer.test.js 2>&1 | tail -10
```

Expected: 4 tests pass.

### - [ ] Step 1.5: 全テスト実行 (regression check)

Run:
```bash
npm test 2>&1 | tail -5
```

Expected: 既存テスト + 新規4テスト = 80 pass, 0 fail.

### - [ ] Step 1.6: コミット

```bash
git add js/legal-footer.js tests/legal-footer.test.js
git commit -m "feat: add legal-footer module with idempotent rendering"
```

---

## Task 2: CSS スタイル追加

**Files:**
- Modify: `css/style.css`（末尾追記）

### - [ ] Step 2.1: スタイル追記

`css/style.css` の末尾に以下を追記:

```css

/* === 法務フッター === */
.legal-footer {
  text-align: center;
  font-size: 11px;
  color: var(--muted);
  padding: 16px 12px 80px;
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
.legal-doc h3 { font-size: 14px; margin: 12px 0 6px; color: var(--text); }
.legal-doc table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 12px 0; }
.legal-doc th, .legal-doc td { border: 1px solid #ddd; padding: 8px; text-align: left; vertical-align: top; }
.legal-doc th { background: #f5f5f5; width: 30%; font-weight: 600; }
.legal-doc ol, .legal-doc ul { padding-left: 24px; margin: 8px 0; }
.legal-doc li { margin-bottom: 4px; }
.legal-doc p { margin: 6px 0; }
.legal-doc .updated-at { color: var(--muted); font-size: 11px; text-align: right; margin-top: 24px; }
.legal-doc .back-link { display: inline-block; margin: 12px 0; color: var(--primary); text-decoration: none; font-size: 13px; }
.legal-doc .back-link:hover { text-decoration: underline; }
```

### - [ ] Step 2.2: コミット

```bash
git add css/style.css
git commit -m "feat: add legal footer and document styles"
```

---

## Task 3: 特商法表記ページ作成

**Files:**
- Create: `legal/tokuteishou.html`

### - [ ] Step 3.1: ディレクトリとファイル作成

`legal/tokuteishou.html` を新規作成:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>特定商取引法に基づく表記 — タクシー日報</title>
<link rel="stylesheet" href="../css/style.css">
<link rel="icon" type="image/png" sizes="32x32" href="../favicon-32.png">
</head>
<body>
<main class="legal-doc">
  <a href="../index.html" class="back-link">← ホームに戻る</a>
  <h1>特定商取引法に基づく表記</h1>

  <table>
    <tr><th>販売事業者</th><td>ご請求があった場合、遅滞なく電子メールにて開示します</td></tr>
    <tr><th>運営責任者名</th><td>ご請求があった場合、遅滞なく電子メールにて開示します</td></tr>
    <tr><th>所在地</th><td>ご請求があった場合、遅滞なく電子メールにて開示します</td></tr>
    <tr><th>電話番号</th><td>ご請求があった場合、遅滞なく電子メールにて開示します</td></tr>
    <tr><th>メールアドレス</th><td>[TBD-EMAIL]</td></tr>
    <tr><th>販売価格</th><td>各プランのお申込画面にて表示します。月額サブスクリプション制です</td></tr>
    <tr><th>商品代金以外の必要料金</th><td>本サービス利用にかかる通信費はお客様のご負担となります</td></tr>
    <tr><th>支払方法</th><td>クレジットカード等（外部決済サービスを利用）</td></tr>
    <tr><th>支払時期</th><td>月額・前払い。お申込時に初回決済、以降毎月の更新日に自動課金</td></tr>
    <tr><th>役務の提供時期</th><td>決済完了後ただちにご利用いただけます</td></tr>
    <tr><th>返品・キャンセル</th><td>サービスの性質上、申込確定後の返金はいたしません。解約はいつでも可能で、当月末までサービスをご利用いただけます。日割計算はいたしません</td></tr>
    <tr><th>動作環境</th><td>iOS Safari / Android Chrome / デスクトップ各種ブラウザの最新版</td></tr>
  </table>

  <p style="margin-top:24px;font-size:12px;color:var(--muted);">
    ※ 上記「ご請求があった場合、遅滞なく電子メールにて開示します」と記載の項目について、
    お客様より開示請求があった場合、上記メールアドレスへご連絡いただければ、
    遅滞なく（原則1週間以内）に開示いたします。
  </p>

  <div class="updated-at">最終更新: 2026年5月8日</div>
  <a href="../index.html" class="back-link">← ホームに戻る</a>
</main>
</body>
</html>
```

### - [ ] Step 3.2: dev サーバで確認

Run:
```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報"
python3 -m http.server 8765 &
SERVER_PID=$!
sleep 2
curl -sI http://localhost:8765/legal/tokuteishou.html | head -1
kill $SERVER_PID 2>/dev/null
```

Expected: `HTTP/1.0 200 OK`

### - [ ] Step 3.3: コミット

```bash
git add legal/tokuteishou.html
git commit -m "feat: add tokuteishou (specified commercial transactions act) page"
```

---

## Task 4: 利用規約ページ作成

**Files:**
- Create: `legal/terms.html`

### - [ ] Step 4.1: ファイル作成

`legal/terms.html` を新規作成:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>利用規約 — タクシー日報</title>
<link rel="stylesheet" href="../css/style.css">
<link rel="icon" type="image/png" sizes="32x32" href="../favicon-32.png">
</head>
<body>
<main class="legal-doc">
  <a href="../index.html" class="back-link">← ホームに戻る</a>
  <h1>利用規約</h1>
  <p>本利用規約（以下「本規約」といいます）は、[TBD-OWNER]（以下「当社」といいます）が提供するタクシー日報サービス（以下「本サービス」といいます）の利用条件を定めるものです。利用者は、本サービスを利用することにより、本規約に同意したものとみなされます。</p>

  <h2>第1条（適用範囲）</h2>
  <p>本規約は、利用者と当社との間の本サービスの利用に関わる一切の関係に適用されます。</p>

  <h2>第2条（利用登録）</h2>
  <ol>
    <li>本サービスは招待制であり、当社の承認を経て利用登録が完了します。</li>
    <li>当社は、利用登録の申請者が以下のいずれかに該当する場合、登録を拒否することがあります。
      <ul>
        <li>申請内容に虚偽がある場合</li>
        <li>過去に本規約違反により登録を取り消された経歴がある場合</li>
        <li>その他、当社が登録を相当でないと判断した場合</li>
      </ul>
    </li>
  </ol>

  <h2>第3条(アカウント・パスワード管理)</h2>
  <ol>
    <li>利用者は、自己の責任においてユーザーIDおよびパスワードを管理するものとします。</li>
    <li>ユーザーIDおよびパスワードを第三者に譲渡・貸与・共有することはできません。</li>
    <li>ユーザーIDおよびパスワードの管理不十分による損害について、当社は責任を負いません。</li>
  </ol>

  <h2>第4条(料金・支払)</h2>
  <ol>
    <li>本サービスの利用料金は、月額サブスクリプション制とし、具体的な金額はお申込画面にて表示します（[TBD-PRICE]）。</li>
    <li>支払いは、当社が指定する外部決済サービスを通じてクレジットカード等で行うものとします。</li>
    <li>支払時期は前払いとし、お申込時に初回決済、以降毎月の更新日に自動課金されます。</li>
  </ol>

  <h2>第5条(本サービスの内容)</h2>
  <p>本サービスは、タクシー乗務員向けに以下の機能を提供します。</p>
  <ul>
    <li>日次乗務データの記録および月度集計</li>
    <li>車種別パフォーマンス分析</li>
    <li>営業サポート機能（推奨検索、エリア効率分析等）</li>
    <li>シフトカレンダー管理</li>
  </ul>

  <h2>第6条(利用者データの取り扱い)</h2>
  <ol>
    <li>当社は、利用者が登録した運行データ(運行日時、エリア、売上、車種等)を、本サービスの「営業サポート機能」において匿名化・集計した統計情報として、他の利用者にも提供することがあります。</li>
    <li>個人を特定できる情報(氏名、ユーザーID、個別の日次データ)は、他の利用者には提供されません。ただし、サービス運営の必要上、運営者(管理者)には個別データが閲覧可能です。</li>
    <li>利用者は、本機能による集計分析への登録データの利用に同意するものとします。</li>
  </ol>

  <h2>第7条(禁止事項)</h2>
  <p>利用者は、本サービスの利用にあたり、以下の行為を行ってはなりません。</p>
  <ul>
    <li>不正アクセス、システムへの過度な負荷をかける行為</li>
    <li>運行データの偽装、虚偽データの登録</li>
    <li>第三者へのアカウント情報の共有・譲渡</li>
    <li>本サービスのリバースエンジニアリング、複製、再配布</li>
    <li>その他、当社が不適切と判断する行為</li>
  </ul>

  <h2>第8条(本サービスの変更・中断・終了)</h2>
  <ol>
    <li>当社は、利用者への事前通知なく本サービスの内容を変更することがあります。</li>
    <li>システムメンテナンス、災害、その他の事由により、本サービスの提供を一時的に中断することがあります。</li>
    <li>本サービスを終了する場合、当社は終了の30日前までに利用者に通知します。</li>
  </ol>

  <h2>第9条(解約)</h2>
  <ol>
    <li>利用者は、いつでも本サービスを解約することができます。</li>
    <li>解約のお手続き後、次回の更新日からの課金が停止されます。</li>
    <li>解約月の利用料金は当月末まで有効であり、日割計算による返金はいたしません。</li>
  </ol>

  <h2>第10条(退会後のデータ)</h2>
  <ol>
    <li>退会後30日間は、お客様の運行データを保持します(復帰可能期間)。</li>
    <li>30日経過後、当社のシステムから当該データを順次削除します。</li>
    <li>当社の災害対策のためのバックアップデータについては、削除日からさらに60日間保持後、削除します。</li>
  </ol>

  <h2>第11条(免責事項)</h2>
  <ol>
    <li>本サービスが提供する分析・推奨情報は、過去データに基づく統計的参考であり、実際の営業成果や売上を保証するものではありません。</li>
    <li>本サービスを利用した結果生じた営業上の損失について、運営者は一切責任を負いません。</li>
    <li>利用者は、本サービスから得られる情報を自身の判断と責任において利用するものとします。</li>
    <li>システム障害・メンテナンス・天候APIの不具合等による一時的な利用不可について、運営者は補償を行いません。</li>
  </ol>

  <h2>第12条(反社会的勢力の排除)</h2>
  <p>利用者は、自らが暴力団、暴力団員、その他反社会的勢力に該当しないことを表明し、また将来にわたっても該当しないことを誓約します。当社は、利用者がこれに違反した場合、何らの催告なく直ちに利用契約を解除することができます。</p>

  <h2>第13条(個人情報の取り扱い)</h2>
  <p>当社は、利用者の個人情報を、別途定める「プライバシーポリシー」に従って適切に取り扱います。</p>

  <h2>第14条(規約変更)</h2>
  <p>当社は、必要に応じて本規約を変更することができます。変更後の規約は、本サービス内に表示した時点から効力を生じるものとし、利用者が変更後も本サービスを利用する場合、変更に同意したものとみなされます。重要な変更がある場合は、事前に通知します。</p>

  <h2>第15条(準拠法・裁判管轄)</h2>
  <ol>
    <li>本規約の解釈にあたっては、日本法を準拠法とします。</li>
    <li>本サービスに関して紛争が生じた場合には、東京地方裁判所を第一審の専属的合意管轄裁判所とします。</li>
  </ol>

  <div class="updated-at">最終更新: 2026年5月8日</div>
  <a href="../index.html" class="back-link">← ホームに戻る</a>
</main>
</body>
</html>
```

### - [ ] Step 4.2: 動作確認

Run:
```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報"
python3 -m http.server 8765 &
SERVER_PID=$!
sleep 2
curl -sI http://localhost:8765/legal/terms.html | head -1
kill $SERVER_PID 2>/dev/null
```

Expected: `HTTP/1.0 200 OK`

### - [ ] Step 4.3: コミット

```bash
git add legal/terms.html
git commit -m "feat: add terms of service page"
```

---

## Task 5: プライバシーポリシーページ作成

**Files:**
- Create: `legal/privacy.html`

### - [ ] Step 5.1: ファイル作成

`legal/privacy.html` を新規作成:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>プライバシーポリシー — タクシー日報</title>
<link rel="stylesheet" href="../css/style.css">
<link rel="icon" type="image/png" sizes="32x32" href="../favicon-32.png">
</head>
<body>
<main class="legal-doc">
  <a href="../index.html" class="back-link">← ホームに戻る</a>
  <h1>プライバシーポリシー</h1>
  <p>[TBD-OWNER](以下「当社」といいます)は、本サービスの提供にあたり、個人情報を以下のとおり取り扱います。</p>

  <h2>1. 個人情報の定義</h2>
  <p>本ポリシーにおいて「個人情報」とは、個人情報保護法に定める「個人情報」を指し、特定の個人を識別できる情報(氏名、生年月日その他の記述等により特定の個人を識別できるもの)をいいます。</p>

  <h2>2. 取得する情報</h2>
  <p>当社は、本サービスの提供にあたり、以下の情報を取得します。</p>
  <ul>
    <li>ユーザーID(利用者が指定する文字列)</li>
    <li>パスワードのハッシュ値(平文では保存しません)</li>
    <li>表示名(任意)</li>
    <li>運行データ(運行日時、エリア、売上、車種、運行時間、降車地等)</li>
    <li>デバイス情報(ブラウザ種別、OS、画面サイズ等)</li>
    <li>IPアドレス、アクセスログ</li>
  </ul>

  <h2>3. 利用目的</h2>
  <p>取得した情報は、以下の目的のために利用します。</p>
  <ul>
    <li>本サービスの提供および本人認証</li>
    <li>本サービスの機能改善および新機能開発</li>
    <li>営業サポート機能における匿名化されたベンチマーク統合分析</li>
    <li>不正利用の防止</li>
    <li>お問い合わせへの対応</li>
  </ul>

  <h2>4. 業務委託先</h2>
  <p>当社は、データ保管および分析処理のため、以下に業務委託しております。これら委託先は当社が定めた管理基準に基づき適切に管理しています。</p>
  <ul>
    <li><strong>Google Inc.(Firebase)</strong><br>
      保管場所: Asia-Northeast1(東京)<br>
      目的: ユーザー認証、データ保管、リアルタイム同期</li>
    <li><strong>Open-Meteo</strong><br>
      目的: 天候情報の取得(運行日報の天候記録)</li>
  </ul>
  <p>これらは個人情報保護法上の「第三者提供」には該当しません。</p>

  <h2>5. データ保管場所</h2>
  <p>利用者のデータは Firebase の Asia-Northeast1(東京)リージョンに保管されます。</p>

  <h2>6. データ保持期間</h2>
  <ol>
    <li>本サービス利用中は、データを継続して保持します。</li>
    <li>退会後30日間は、復帰可能期間としてデータを保持します。</li>
    <li>30日経過後、システムからデータを順次削除します。</li>
    <li>災害対策のためのバックアップデータについては、削除日からさらに60日間保持後、削除します。</li>
  </ol>

  <h2>7. 開示・訂正・削除請求等の手続き</h2>
  <ol>
    <li>利用者は、当社に対し、自己の個人情報について開示・訂正・削除・利用停止を請求することができます。</li>
    <li>請求は、下記お問い合わせ先まで電子メールにてご連絡ください。</li>
    <li>本人確認のうえ、遅滞なく対応いたします。</li>
    <li>請求の手数料は無料です。</li>
  </ol>

  <h2>8. Cookie・localStorage の使用</h2>
  <p>本サービスは、利便性向上のため Cookie および localStorage を使用します。具体的には以下の目的で使用します。</p>
  <ul>
    <li>自動ログイン機能(ユーザーID保持)</li>
    <li>表示設定の保持(車種フィルタ等)</li>
    <li>セッション情報の保持</li>
  </ul>
  <p>Cookie の使用を希望されない場合は、ブラウザの設定で無効化できますが、一部機能が利用できなくなる可能性があります。</p>

  <h2>9. 改定・お問い合わせ</h2>
  <ol>
    <li>本ポリシーは、必要に応じて改定することがあります。重要な変更がある場合は、本サービス内で通知します。</li>
    <li>本ポリシーに関するお問い合わせは、下記までご連絡ください。</li>
  </ol>
  <p style="margin-left:16px;">お問い合わせ先: [TBD-EMAIL]</p>

  <div class="updated-at">最終更新: 2026年5月8日</div>
  <a href="../index.html" class="back-link">← ホームに戻る</a>
</main>
</body>
</html>
```

### - [ ] Step 5.2: 動作確認

Run:
```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報"
python3 -m http.server 8765 &
SERVER_PID=$!
sleep 2
curl -sI http://localhost:8765/legal/privacy.html | head -1
kill $SERVER_PID 2>/dev/null
```

Expected: `HTTP/1.0 200 OK`

### - [ ] Step 5.3: コミット

```bash
git add legal/privacy.html
git commit -m "feat: add privacy policy page"
```

---

## Task 6: テンプレ出典・改訂履歴ドキュメント

**Files:**
- Create: `docs/legal-template-source.md`

### - [ ] Step 6.1: ファイル作成

`docs/legal-template-source.md` を新規作成:

```markdown
# 法務文書テンプレート出典・改訂履歴

## 元テンプレート出典
- 特商法表記: 経済産業省 通信販売の表示モデル + 消費者庁 2023年改正特商法ガイドライン(「請求により開示」方式)
- 利用規約: 経済産業省 SaaS 標準モデル契約 + GitHub 公開 OSS規約 参考
- プラポリ: 個人情報保護委員会 ガイドライン準拠

## カスタマイズ事項
- 利用規約 第6条: タクシー業務データの統合分析を明示(このサービス特有)
- 利用規約 第11条: 営業成果保証なしの免責を強化(タクシー業務 SaaS 特有)
- プラポリ 第4条: Firebase + Open-Meteo を業務委託先として明示

## 改訂履歴
- 2026-05-08 初版作成

## TODO(B 着手時または運営開始時)
- 開示請求受付メールアドレス確定 → `[TBD-EMAIL]` を実際の値に置換
  対象: legal/tokuteishou.html, legal/privacy.html
- 月額サブスク料金確定 → `[TBD-PRICE]` を実際の金額に置換
  対象: legal/terms.html(第4条)
- 事業者表示名(屋号 or 本名)確定 → `[TBD-OWNER]` を実際の値に置換
  対象: legal/terms.html, legal/privacy.html, js/legal-footer.js (copyright)

## 文書間の整合性チェック項目
- 解約条件: 利用規約 第9条 ⇔ 特商法表記 「返品・キャンセル」
- データ保持期間: 利用規約 第10条 ⇔ プラポリ 第6条
- 月額前払い: 利用規約 第4条 ⇔ 特商法表記 「支払時期」
```

### - [ ] Step 6.2: コミット

```bash
git add docs/legal-template-source.md
git commit -m "docs: add legal template source and revision log"
```

---

## Task 7: 既存HTML 11ファイルへフッター呼び出し追加

**Files:**
- Modify: `index.html`, `input.html`, `detail.html`, `calendar.html`, `review.html`, `support.html`, `settings.html`, `admin.html`, `admin-settings.html`, `bulk-input.html`, `tools.html`

各ファイルに **同じ2行** を追加:
1. `<script type="module">` 内の最後の import 行の直後に `import { renderLegalFooter } from './js/legal-footer.js';`
2. その後の任意の場所(できれば bottom-nav 描画行の近く)に `renderLegalFooter();`

実装は1ファイルずつ行い、各ファイルで commit する。

### - [ ] Step 7.1: index.html にフッター追加

`index.html` を編集。

最後の `import` 行を見つける。具体的には:
```javascript
import { processInvite } from './js/invite-crypto.js';
```
この直後の行に追加:
```javascript
import { processInvite } from './js/invite-crypto.js';
import { renderLegalFooter } from './js/legal-footer.js';
```

そして `document.getElementById('navHost').innerHTML = renderBottomNav('home');` の直後に追加:
```javascript
document.getElementById('navHost').innerHTML = renderBottomNav('home');
renderLegalFooter();
```

確認:
```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報"
grep -n "renderLegalFooter" index.html
```

Expected: 2 matches.

コミット:
```bash
git add index.html
git commit -m "feat: integrate legal footer in index.html"
```

### - [ ] Step 7.2: input.html にフッター追加

`input.html` を編集。

import セクションの最後(最終 import 行の直後)に:
```javascript
import { renderLegalFooter } from './js/legal-footer.js';
```

`renderBottomNav` 呼び出し行の直後に:
```javascript
renderLegalFooter();
```

具体位置を確認:
```bash
grep -n "renderBottomNav\|navHost" input.html | head -3
```

確認:
```bash
grep -n "renderLegalFooter" input.html
```

Expected: 2 matches.

コミット:
```bash
git add input.html
git commit -m "feat: integrate legal footer in input.html"
```

### - [ ] Step 7.3: detail.html にフッター追加

`detail.html` の同じパターンで:
- `import { renderLegalFooter } from './js/legal-footer.js';` を最終 import の直後
- `renderLegalFooter();` を `renderBottomNav` の直後

確認:
```bash
grep -n "renderLegalFooter" detail.html
```

Expected: 2 matches.

コミット:
```bash
git add detail.html
git commit -m "feat: integrate legal footer in detail.html"
```

### - [ ] Step 7.4: calendar.html にフッター追加

同パターン。

確認・コミット:
```bash
grep -n "renderLegalFooter" calendar.html  # 2 matches
git add calendar.html
git commit -m "feat: integrate legal footer in calendar.html"
```

### - [ ] Step 7.5: review.html にフッター追加

同パターン。

確認・コミット:
```bash
grep -n "renderLegalFooter" review.html  # 2 matches
git add review.html
git commit -m "feat: integrate legal footer in review.html"
```

### - [ ] Step 7.6: support.html にフッター追加

同パターン。

確認・コミット:
```bash
grep -n "renderLegalFooter" support.html  # 2 matches
git add support.html
git commit -m "feat: integrate legal footer in support.html"
```

### - [ ] Step 7.7: settings.html にフッター追加

同パターン。

確認・コミット:
```bash
grep -n "renderLegalFooter" settings.html  # 2 matches
git add settings.html
git commit -m "feat: integrate legal footer in settings.html"
```

### - [ ] Step 7.8: admin-settings.html にフッター追加

同パターン。

確認・コミット:
```bash
grep -n "renderLegalFooter" admin-settings.html  # 2 matches
git add admin-settings.html
git commit -m "feat: integrate legal footer in admin-settings.html"
```

### - [ ] Step 7.9: bulk-input.html にフッター追加

同パターン。

確認・コミット:
```bash
grep -n "renderLegalFooter" bulk-input.html  # 2 matches
git add bulk-input.html
git commit -m "feat: integrate legal footer in bulk-input.html"
```

### - [ ] Step 7.10: tools.html にフッター追加

同パターン。

確認・コミット:
```bash
grep -n "renderLegalFooter" tools.html  # 2 matches
git add tools.html
git commit -m "feat: integrate legal footer in tools.html"
```

### - [ ] Step 7.11: admin.html にフッター追加

`admin.html` は `nav.bottom` がない管理者ページ。`renderLegalFooter()` は body 末尾に footer を追加するため動作OK。

import セクションの最後に:
```javascript
import { renderLegalFooter } from './js/legal-footer.js';
```

ロード処理の最後(`</script>` の直前)に:
```javascript
renderLegalFooter();
```

確認・コミット:
```bash
grep -n "renderLegalFooter" admin.html  # 2 matches
git add admin.html
git commit -m "feat: integrate legal footer in admin.html"
```

### - [ ] Step 7.12: 全ファイル統合確認

Run:
```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報"
grep -l "renderLegalFooter" *.html | wc -l
```

Expected: 11 (index, input, detail, calendar, review, support, settings, admin, admin-settings, bulk-input, tools)

```bash
npm test 2>&1 | tail -5
```

Expected: 80 tests pass.

---

## Task 8: Service Worker キャッシュ更新

**Files:**
- Modify: `sw.js`

### - [ ] Step 8.1: STATIC_FILES に legal ページと legal-footer.js を追加

`sw.js` を編集。

現在の `CACHE_NAME` を確認:
```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報"
head -3 sw.js
```

`CACHE_NAME` のバージョンを `v80` に bump。STATIC_FILES の末尾(`'./favicon-32.png'` の前)に4ファイルを追加。

具体例(現在 v79 想定):
```javascript
const CACHE_NAME = 'taxi-daily-v80';
const STATIC_FILES = [
  './',
  './index.html',
  './input.html',
  './detail.html',
  './calendar.html',
  './review.html',
  './support.html',
  './settings.html',
  './bulk-input.html',
  './css/style.css',
  './js/app.js',
  './js/parser.js',
  './js/payroll.js',
  './js/storage.js',
  './js/cache.js',
  './js/userid.js',
  './js/weather.js',
  './js/chart-helpers.js',
  './js/legal-footer.js',
  './legal/tokuteishou.html',
  './legal/terms.html',
  './legal/privacy.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './favicon-32.png'
];
```

(注: 実際の `CACHE_NAME` 現在値を確認してから +1 する。`grep CACHE_NAME sw.js` で確認)

### - [ ] Step 8.2: 動作確認

Run:
```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報"
node -c sw.js  # syntax check
npm test 2>&1 | tail -3
```

Expected: テスト 80 pass。

### - [ ] Step 8.3: コミット

```bash
git add sw.js
git commit -m "feat: add legal pages to SW cache (version bump)"
```

---

## Task 9: 統合動作確認(手動 + 自動)

**Files:** なし(検証のみ)

### - [ ] Step 9.1: 全テスト確認

Run:
```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報"
npm test 2>&1 | tail -5
```

Expected: 80 tests pass。

### - [ ] Step 9.2: ローカルサーバで全ページのフッター確認

Run:
```bash
python3 -m http.server 8765 &
SERVER_PID=$!
sleep 2
for page in index.html input.html detail.html calendar.html review.html support.html settings.html admin.html admin-settings.html bulk-input.html tools.html; do
  echo "=== $page ==="
  curl -s "http://localhost:8765/$page" | grep -c "renderLegalFooter"
done
echo "=== legal pages ==="
for page in legal/tokuteishou.html legal/terms.html legal/privacy.html; do
  echo "$page"
  curl -sI "http://localhost:8765/$page" | head -1
done
kill $SERVER_PID 2>/dev/null
```

Expected:
- 各既存ページで `1` 以上(import + 呼び出し で実際は 2)
- 法務3ページが `HTTP/1.0 200 OK`

### - [ ] Step 9.3: 結果のメモ

問題なければ次へ。問題があれば修正してから次へ進む。

---

## Task 10: dev リポジトリへ push

**Files:** なし(リモート操作)

### - [ ] Step 10.1: dev push

Run:
```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報"
git log --oneline c365341..HEAD | head -20
```

すべて Task 1-9 のコミットが並んでいることを確認。

```bash
git push dev main 2>&1 | tail -5
```

Expected: `* main -> main` の表示。

### - [ ] Step 10.2: dev URL で動作確認

`https://hidenaka.github.io/-taxi-daily-report-dev/` をブラウザで開き(GitHub Pages 反映に1-2分):

ブラウザで以下を確認(これはユーザーが目視で行う、自動化不要):
- [ ] 「🚧 開発環境」バッジが見える
- [ ] 各ページ最下部にフッターが表示
- [ ] 3つのリンクすべてが正しい legal ページに遷移
- [ ] スマホ画面でフッターが崩れない
- [ ] nav.bottom と重ならない

### - [ ] Step 10.3: ユーザー承認待ち

dev で動作確認 OK と明示的にユーザーから返事をもらう。問題があれば修正・再 push。

---

## Task 11: 本番タグ deploy(ユーザー承認後のみ)

このタスクは **ユーザーが dev で OK と返事してから** 実行する。自動実行しない。

### - [ ] Step 11.1: 次のタグバージョンを決定

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報"
git tag --sort=-v:refname | head -5
```

直近タグから minor +1 を提案(例 v1.8.0 → v1.9.0)。

### - [ ] Step 11.2: タグ作成 + push

```bash
git tag <決定したバージョン>
git push dev <決定したバージョン>
```

### - [ ] Step 11.3: GitHub Actions 確認

```bash
sleep 30
gh run list --limit 3 --repo hidenaka/-taxi-daily-report-dev 2>&1 | head -5
```

Expected: `Deploy to Production` workflow が `success` で完了。

### - [ ] Step 11.4: 本番 URL で動作確認

`https://hidenaka.github.io/taxi-daily-report/` を開く(自動デプロイ反映1-2分):
- [ ] 「🚧 開発環境」バッジが**ない**
- [ ] フッター・法務ページ動作OK

---

## 完了基準

- [x] 全11ページのフッターに3点リンク表示
- [x] 各リンクが legal/tokuteishou.html, legal/terms.html, legal/privacy.html に遷移
- [x] スマホ表示でフッターが崩れない
- [x] `npm test` で 80 tests pass(76 既存 + 4 新規)
- [x] dev環境でユーザーが動作確認OK
- [x] 本番デプロイ完了

## 既知のリスク・注意点

- **TBD プレースホルダー**: `[TBD-OWNER]`, `[TBD-EMAIL]`, `[TBD-PRICE]` が legal ページに残っている。B 着手時または運営開始時に確定し、置換コミットを別途行う。
- **データ統合分析の表現の正確性**: 利用規約 第6条 が support.html の実装と齟齬がないか手動レビューが必要。具体的には「他の利用者には個別データは見えない」が現在の挙動と一致するか確認(実装時に support.html の `dropoffAreaAnalysis`、`hourlyDowEfficiency` 等が個別 userId を露出しないことを再確認)。
- **iCloudパス問題**: 過去にスペース入りパスで gh / git が時折挙動不安定。問題が出たら一度カレントを確認してから再実行。
- **法務文書はテンプレベース**: 後日弁護士レビュー前提。docs/legal-template-source.md に出典明記済み。
- **migrate.html はフッター対象外**: 管理者用、外部公開しない仕様のため意図的に除外。
- **admin.html はナビなしページ**: `nav.bottom` がないため body 末尾にフォールバック挿入(legal-footer.js のロジック通り)。
