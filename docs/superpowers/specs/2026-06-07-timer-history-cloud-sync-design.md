# 休憩タイマー履歴のハイブリッドFirestore同期 設計

- 日付: 2026-06-07
- 対象: `tools/index.html`（乗務タイマー）＋新規 `tools/js/timer-sync.js`・`tools/js/timer-cloud.js`＋`firestore.rules`
- 状態: 設計確定（ユーザー承認: 方式A=ハイブリッド・2台日常併用・課金影響ほぼ無し）→ 実装

## 1. 背景・目的

休憩履歴(records)が端末の `localStorage('taxi-timer-v1')` だけに保存され、サーバーバックアップが無い。PWA再インストール・iOSのWebストレージ削除・機種変更で**消えると復元不能**（実害=法定休憩の記録喪失）。

対策: **localStorageを正本に保ちつつ、ログイン済みユーザーのUIDでFirestoreにバックアップ同期**。機種変更/再インストールでも同じアカウントなら復元。タイマーは既に `enforceAccess('core')` でログイン必須なので追加ログイン負担なし。日報本体と同じper-user Firestoreパターンに合わせる。

**2台日常併用**（仕事用・予備機）を前提に、両端末の記録を落とさない堅牢なマージを行う。

## 2. 原則

- **localStorageが常に正本**: 既存のタイマー動作・速度・オフラインは不変。Firestoreは**ベストエフォートのバックアップ/復元層**（オフライン/未ログイン/失敗時もUIは止めない）。
- **Firestoreオフライン永続化は使わない**（このアプリは未有効）。同期はオンライン＋認証時のみ。
- **課金最小**: 1ユーザー1ドキュメント、onSnapshotは使わない、pushは節目でデバウンス。

## 3. データモデル

### 3.1 record スキーマ拡張（後方互換）
現状 `{ recordedAt, durationSec }` に同期用3項目を追加:
| 項目 | 説明 |
|---|---|
| `id` | 作成時の不変ID（マージのキー）。`crypto.randomUUID()`、無い環境は `recordedAt + '-' + 乱数`。**編集してもidは保持**（現状は編集でrecordedAtが変わるため要修正） |
| `updatedAt` | 作成/編集時刻(ms)。マージのLWW判定に使う |
| `deleted` | 論理削除フラグ（墓石）。true=削除済み。表示からは除外するが保存集合には残す |

- 既存record（id無し）は**移行時に決定的idを付与**: `legacy-<recordedAt>`（2端末で同じrecordedAtなら同じid→重複しない）。`updatedAt` は `recordedAt` 由来 or 0。

### 3.2 Firestore ドキュメント
`timerStates/{userId}`（既存 `drives/{userId}` `userConfigs/{userId}` と同じper-user）。1ユーザー1ドキュメント:
```
{
  records: [ { id, recordedAt, durationSec, updatedAt, deleted } , ... ],  // 墓石含む
  settings: { shiftStart, targetBreakMin, continuousDriveMin, breakCountMin,
              mode, countdownTargetMin, soundOn, wakeLockOn, alertDurationSec,
              moveDetectOn, moveThresholdM, countdownPresets },
  settingsUpdatedAt: <ms>,   // 設定LWW用
  syncedAt: <serverTimestamp>
}
```
- `runningStartedAt`/`shiftStartAt`/`lastResetSnapshot` は端末ローカルの実行状態なので**同期しない**（records と settings のみ）。

## 4. マージ（純粋関数・テスト対象）

`tools/js/timer-sync.js`:
- `ensureRecordIds(records, now)` — id/updatedAt が無いrecordに付与（移行）。純粋。
- `mergeRecords(localRecs, cloudRecs)` — id でグルーピングし、各idは `updatedAt` が新しい方を採用（同点はlocal優先）。墓石(deleted)もそのまま残す。返り値は全idの最新集合。純粋。
- `mergeState(localState, cloudState)` — records は `mergeRecords`、settings は `settingsUpdatedAt` が新しい方を採用（cloud無し or localが新しければlocal維持）。純粋。
- 表示時は `records.filter(r => !r.deleted)` を使う（既存の集計/履歴描画はこのフィルタ済みを参照）。

## 5. 同期フロー

### 5.1 読み込み時（restore/merge）
1. 既存どおり localStorage から即ロード→描画（オフラインでも動く）。
2. `waitForAuth` 後、オンライン＆認証ありなら `pullTimerState()`（`getDoc`）。
3. `mergeState(local, cloud)` → localStorage保存＋再描画＋`pushTimerState(merged)`（両端末を収束）。
4. ローカルが空（新端末/再インストール）→ cloud がそのまま復元される。

### 5.2 前面復帰時（visibilitychange→visible）
- 上の 2-3 を再実行（他端末の更新を取り込む）。デバウンス（直近数秒の重複pullを抑制）。

### 5.3 変更時（push）
- record追加/編集/削除・設定変更で localStorage 即保存（record操作は `updatedAt` 更新・削除は `deleted:true`、設定変更は `settingsUpdatedAt` 更新）。
- **デバウンス（例3-5秒）で `pushTimerState(state)`**（`setDoc` 全体上書き）。オンライン＆認証時のみ・fire-and-forget。失敗は握りつぶす（次の機会に再送）。
- tick（1秒毎の再描画）では push しない。

### 5.4 onSnapshot は使わない（課金/常時接続回避）。ライブ同時反映はv1範囲外（前面復帰pullで取り込む）。

## 6. Firestore セキュリティルール（必須）
`getUserId()` は認証UIDそのものではなく `users/{auth.uid}.userId` に対応する。既存ルールは
`isOwnerByUserId(userId)`（user docの userId フィールドで照合）で `drives`/`userConfigs` を守っている。
**timerStates も同じ helper を使う**（`request.auth.uid == userId` は誤り）。`firestore.rules` に追加（無いと書き込み拒否）:
```
match /timerStates/{userId} {
  allow read, write: if isOwnerByUserId(userId);
  allow read, write: if isAdmin();
}
```
- キーは `getUserId()`（日報の `drives/{userId}` と完全同方針）。デプロイは `firebase deploy --only firestore:rules`（dev=default → prod）。

## 7. 移行
- 初回ロードで `ensureRecordIds` により既存recordにid付与→localStorage保存→cloud初回push（バックアップ確立）。
- 既存ユーザーのデータ損失なし（id付与のみ、durationSec/recordedAtは不変）。

## 8. ファイル構成（責務分離）
- **新規 `tools/js/timer-sync.js`**: 純粋なマージ/移行ロジック（`ensureRecordIds`/`mergeRecords`/`mergeState`）。副作用なし・ユニットテスト対象。
- **新規 `tools/js/timer-cloud.js`**: Firestore I/O（`pullTimerState`/`pushTimerState`、`db`＋`getUserId`＋Firestore SDK使用）。薄いラッパ。
- **`tools/index.html`（インライン）**: 配線（ロードpull→merge、前面pull、デバウンスpush、record操作のid/updatedAt/deleted、編集でid保持、移行）。表示は deleted 除外。
- **`firestore.rules`**: ルール追加。
- **`sw.js`**: 新規2ファイルをprecacheに追加＋CACHE_NAME bump（deploy時のcache-bustが`?b=`を自動付与）。
- **`tests/timer-sync.test.js`**: 純粋関数のテスト。

## 9. テスト
- ユニット（`node --test`）:
  - `ensureRecordIds`: id/updatedAt無し→付与、legacy id決定的、既存idは不変
  - `mergeRecords`: union、同idはupdatedAt後勝ち、墓石保持、片側のみのidは採用
  - `mergeState`: settingsはsettingsUpdatedAt後勝ち、cloud空ならlocal維持、records委譲
- 実機スモーク（kimi-webbridge＋実アカウント）:
  - 端末A=localStorageに記録→cloud push確認→端末B相当（別localStorage空＋同アカウント）でロード→復元
  - A/B双方に別記録→マージで両方残る／一方で削除→墓石で復活しない／設定は後勝ち
  - オフライン/未ログインでUIが止まらない

## 10. スコープ外（YAGNI / 将来）
- onSnapshotによるライブ同時反映
- 古い墓石の定期掃除（records肥大化対策。当面ためる）
- 競合UIでのユーザー手動マージ
- runningStartedAt等の実行状態の同期
