# Plan 3c: 日報ごとの共有オプトアウト Implementation Plan

> REQUIRED SUB-SKILL: subagent-driven-development。

**Goal:** 日報(drive)を「グループに共有しない」に個別指定できる UI を input.html と detail.html に足す。データ側の除外（`drive.shareOptOut` の日をプールに入れない）は Plan1 `driveToPoolItems` で実装・テスト済みなので、本プランは **UI 配線＋`drive.shareOptOut` フィールドの保存/反映** のみ。

**Architecture:** `drive.shareOptOut: boolean`（true=このグループ共有から除外）。input.html の保存時にチェックボックス値を drive に含める（編集時は既存値で初期化）。detail.html の「振り返りメモ」カードにトグルを追加し、保存時に drive.shareOptOut を更新。Worker の匿名化が shareOptOut の日をスキップ（既存）。

**Tech Stack:** 既存ページのインライン module script を最小編集。テストは Plan1 の driveToPoolItems(shareOptOut→[]) で担保済み（新規テスト不要、全スイート回帰のみ確認）。worktree `~/work/taxi-group-sharing`(branch feat/group-anon-sharing)。

---

### Task 1: input.html に共有オプトアウト チェックボックス

**Files:** Modify `input.html`

- [ ] **Step 1:** 保存ボタン付近（saveStatus の近く）に小さなチェックボックスを追加（既存フォームのスタイルに倣う）:
```html
<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);margin-top:8px;">
  <input type="checkbox" id="shareOptOutInput"> 👥 この日報はグループに共有しない
</label>
```
配置: 保存ボタン（btn）の近く・saveStatus の上あたり。

- [ ] **Step 2:** drive オブジェクト（行 572-586 の `const drive = {...}`）に1フィールド追加:
```js
    shareOptOut: document.getElementById('shareOptOutInput')?.checked || false,
```
（updatedAt の前あたりに追加。）

- [ ] **Step 3:** 編集時の初期化。既存日報を編集ロードする箇所（行 251 付近 `existing` を読む所、またはフォーム値を埋める箇所）で、`existing.shareOptOut` が true ならチェックを入れる:
```js
    const so = document.getElementById('shareOptOutInput');
    if (so && existing && existing.shareOptOut) so.checked = true;
```
（編集ロードの該当箇所に合わせて配置。new 入力時は未チェック=共有。）

- [ ] **Step 4:** `node --check` 不可（HTMLインライン）なのでブラウザ前提。`grep -n shareOptOut input.html` で3箇所（checkbox/ drive field / 編集初期化）入ったことを確認。
- [ ] **Step 5: Commit** `git add input.html && git commit -m "feat(share-optout): input.html に『グループに共有しない』トグル＋drive.shareOptOut保存"`

---

### Task 2: detail.html の振り返りメモカードにトグル

**Files:** Modify `detail.html`

- [ ] **Step 1:** 振り返りメモカードの innerHTML（行 263-273 付近）に、保存ボタンの近くへチェックボックスを追加:
```html
    <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);margin-top:8px;">
      <input type="checkbox" id="shareOptOutToggle" ${drive.shareOptOut ? 'checked' : ''}> 👥 この日報はグループに共有しない
    </label>
```
（textarea と保存ボタンの間あたり。`drive.shareOptOut` で初期チェック状態を反映。）

- [ ] **Step 2:** saveMemoBtn の onclick（行 274-287）で、メモ保存と同時に shareOptOut も更新:
```js
    drive.reviewMemo = newMemo;
    drive.shareOptOut = document.getElementById('shareOptOutToggle')?.checked || false;
    drive.updatedAt = new Date().toISOString();
    await saveDriveSafe(drive);
```
（既存の reviewMemo 代入の直後に shareOptOut 代入を足す。1回の保存で両方永続化。）

- [ ] **Step 3:** `grep -n shareOptOut detail.html` で2箇所（checkbox / 保存代入）確認。
- [ ] **Step 4: Commit** `git add detail.html && git commit -m "feat(share-optout): detail.html に共有しないトグル（メモ保存と同時に永続化）"`

---

### Task 3: 回帰確認

- [ ] **Step 1:** `cd ~/work/taxi-group-sharing && node --test tests/*.test.js 2>&1 | tail -5` → 全PASS（723件想定。新規テストなし・既存 driveToPoolItems の shareOptOut テストが除外を担保）。
- [ ] **Step 2:** （任意）SW更新不要（HTML編集のみだが、配信反映のため次回dev pushでCACHE_NAMEは別途bump。input.html/detail.htまは既にSTATIC_FILES登録済なので追加不要）。※新規ファイル無し＝precache-imports テスト影響なし。

---

## このプラン完了後
ユーザーは新規入力時/詳細画面で「この日報はグループに共有しない」を個別に切替可能。Workerの匿名化が shareOptOut の日をスキップ（Plan1/2で実装済）。残り Plan4（分析にプール表示）で「見る」体験が完成。

## Self-Review（記録）
- spec §3（既定共有・input/detailトグル・Workerスキップ） → Task1/2、除外はPlan1既存。✓
- drive.shareOptOut の往復（保存/編集初期化）→ input編集ロード初期化・detail初期チェック。✓
- 新規ファイル無し＝SW/precache影響なし。placeholder無し（実際の行番号は実装時に現物確認して合わせる）。
