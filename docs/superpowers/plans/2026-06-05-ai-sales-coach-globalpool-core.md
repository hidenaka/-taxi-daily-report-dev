# AI営業相談コーチ — Plan 4a: 全体匿名プール 集計コア 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全ユーザーの乗務データを「車種(vehicleType)別」に匿名集計するコア純関数 `buildGlobalPool` を作る。ソロユーザーでも「同じ車種の人の傾向」を参照できる土台。

**Architecture:** サーバ(worker)側で生drivesを読む前提なので匿名化変換は不要。`drive.vehicleType` でセグメント分割し、各セグメントに既存 `buildGroupPool`（peerMedianHourlyDow + dropoffAreaAnalysis + memberCount≥2 ガード）を再利用。さらに heatmap セルを per-cell k≥2（days≥2）でフィルタして匿名性を強める。純関数のみ、node:test。

**Tech Stack:** 素のESM、`node:test`。worker・Firestore・ネットワークは含まない（Plan 4b）。

ロードマップ Plan 4a/4(分割)。Plan 1-3 完了・dev反映済。
- **Plan 4a（本書）**: 全体プール集計コア（純関数）
- Plan 4b（次）: worker `/global-pool-refresh` バッチ ＋ `globalPool/{vehicleType}/current` 書込 ＋ firestore.rules ＋ フロント `getGlobalPool` ＋ buildFactPack の pool 統合 ＋ 回答への peer 反映。**デプロイ・admin設定を伴う**。

---

## File Structure

| ファイル | 責務 | テスト |
|---|---|---|
| `js/coach/global-pool.js`（新規） | `buildGlobalPool(drives, opts)`: 車種別セグメント集計。既存 buildGroupPool を再利用。純関数 | あり |
| `tests/coach-global-pool.test.js`（新規） | buildGlobalPool の単体テスト | — |

既存 `js/group-pool-core.js`（`buildGroupPool`）・`js/group-anon.js`・`js/chart-helpers.js` は変更しない（再利用のみ）。

---

## Task 1: 全体プール集計 `global-pool.js`

**Files:**
- Create: `js/coach/global-pool.js`
- Test: `tests/coach-global-pool.test.js`

**前提（既存・再利用）:** `js/group-pool-core.js` は `export function buildGroupPool(drives, memberCount, opts={nowIso, months=6})` → `{ heatmap:[{dow,h,hourlyA,days,peerValues}], areas:[{area,dropoffs,...}], builtAt, memberCount }` を返す。memberCount<2 は `{heatmap:[],areas:[],...}`。peerMedianHourlyDow は drives の `_userId` でユーザーを区別する。

**型:**
```
GlobalPoolInputDrive = drive + { _userId:string, vehicleType?:string }  // 全ユーザー横断・worker由来
GlobalPool = {
  byVehicleType: { [vehicleType:string]: GroupPool },  // GroupPool = buildGroupPool 戻り値（heatmapはday≥2でフィルタ済み）
  builtAt: string
}
```

**ルール:**
- drives を `drive.vehicleType || 'japantaxi'` でセグメント分割。
- 各セグメント: 重複しない `_userId` 数を memberCount として `buildGroupPool(segDrives, memberCount, {nowIso, months})`。
- 追加の k 匿名: 各セグメントの `heatmap` を `days >= 2`（2人以上が乗務したセル）のみに絞る（per-cell k≥2）。
- セグメントの memberCount<2 は buildGroupPool が空を返すのでそのまま（空セグメントも byVehicleType に載せてよい）。
- `builtAt` は opts.nowIso（無ければ空文字）。

- [ ] **Step 1: 失敗するテストを書く**

`tests/coach-global-pool.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildGlobalPool } from '../js/coach/global-pool.js';

// 2ユーザー×premium、金曜19時台に乗務。簡易fixture。
function trip(amount, bt, at, bp, ap) {
  return { amount, boardTime: bt, alightTime: at, boardPlace: bp, alightPlace: ap, isCancel: false };
}
const drivesPremium = [
  { _userId: 'uA', date: '2026-05-01', vehicleType: 'premium', departureTime: '07:00', returnTime: '22:00',
    trips: [ trip(2000, '19:10', '19:25', '港区六本木6', '渋谷区恵比寿1'), trip(2600, '19:40', '19:55', '港区西麻布2', '目黒区中目黒1') ] },
  { _userId: 'uB', date: '2026-05-08', vehicleType: 'premium', departureTime: '07:00', returnTime: '22:00',
    trips: [ trip(2400, '19:15', '19:30', '港区六本木6', '渋谷区渋谷2') ] },
];
const drivesJpn = [
  { _userId: 'uC', date: '2026-05-02', vehicleType: 'japantaxi', departureTime: '07:00', returnTime: '22:00',
    trips: [ trip(1500, '19:20', '19:35', '新宿区西新宿1', '中野区中野2') ] },
];

describe('buildGlobalPool', () => {
  it('車種別にセグメントして byVehicleType を返す', () => {
    const gp = buildGlobalPool([...drivesPremium, ...drivesJpn], { nowIso: '2026-05-10T00:00:00.000Z' });
    assert.ok(gp.byVehicleType.premium);
    assert.ok(gp.byVehicleType.japantaxi);
    assert.strictEqual(gp.builtAt, '2026-05-10T00:00:00.000Z');
  });

  it('2ユーザーのpremiumセグメントは memberCount=2', () => {
    const gp = buildGlobalPool(drivesPremium, { nowIso: '2026-05-10T00:00:00.000Z' });
    assert.strictEqual(gp.byVehicleType.premium.memberCount, 2);
  });

  it('1ユーザーのみの japantaxi セグメントは memberCount<2 で空集計', () => {
    const gp = buildGlobalPool(drivesJpn, { nowIso: '2026-05-10T00:00:00.000Z' });
    assert.strictEqual(gp.byVehicleType.japantaxi.memberCount, 1);
    assert.deepStrictEqual(gp.byVehicleType.japantaxi.heatmap, []);
    assert.deepStrictEqual(gp.byVehicleType.japantaxi.areas, []);
  });

  it('heatmapは per-cell k≥2（days>=2）のみ残す', () => {
    const gp = buildGlobalPool(drivesPremium, { nowIso: '2026-05-10T00:00:00.000Z' });
    for (const cell of gp.byVehicleType.premium.heatmap) {
      assert.ok(cell.days >= 2, `cell dow${cell.dow} h${cell.h} days=${cell.days} <2`);
    }
  });

  it('vehicleType未指定のdriveは japantaxi 扱い', () => {
    const noType = [{ _userId: 'uX', date: '2026-05-01', departureTime: '07:00', returnTime: '22:00', trips: [trip(1000,'19:10','19:20','A','B')] }];
    const gp = buildGlobalPool(noType, { nowIso: '2026-05-10T00:00:00.000Z' });
    assert.ok(gp.byVehicleType.japantaxi);
  });

  it('空入力は byVehicleType 空', () => {
    const gp = buildGlobalPool([], { nowIso: '2026-05-10T00:00:00.000Z' });
    assert.deepStrictEqual(gp.byVehicleType, {});
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- tests/coach-global-pool.test.js`
Expected: FAIL（モジュール未存在）

- [ ] **Step 3: 実装**

`js/coach/global-pool.js`:

```javascript
import { buildGroupPool } from '../group-pool-core.js';

// 全ユーザー横断 drives（各 drive に _userId と vehicleType）を車種別に匿名集計。
// 各セグメントは既存 buildGroupPool を再利用（memberCount<2 は空）。
// heatmap はさらに per-cell k≥2（days>=2）で絞る。
export function buildGlobalPool(drives, opts = {}) {
  const { nowIso = '', months = 6 } = opts;
  const list = Array.isArray(drives) ? drives : [];

  // 車種でセグメント分割
  const segments = {};
  for (const d of list) {
    const vt = (d && d.vehicleType) || 'japantaxi';
    (segments[vt] || (segments[vt] = [])).push(d);
  }

  const byVehicleType = {};
  for (const [vt, segDrives] of Object.entries(segments)) {
    const users = new Set();
    for (const d of segDrives) { if (d && d._userId) users.add(d._userId); }
    const pool = buildGroupPool(segDrives, users.size, { nowIso, months });
    // per-cell k匿名（2人以上が乗務したセルのみ）
    pool.heatmap = (pool.heatmap || []).filter((c) => c.days >= 2);
    byVehicleType[vt] = pool;
  }

  return { byVehicleType, builtAt: nowIso };
}
```

- [ ] **Step 4: 合格を確認**

Run: `npm test -- tests/coach-global-pool.test.js`
Expected: PASS

※ `buildGroupPool` のimportが node で失敗する（DOM/他依存）場合は、`js/group-pool-core.js` の依存を確認。既に group-pool 系テストが node:test で動いている前提（tests/group-pool-encode.test.js 等）なので import 可能なはず。落ちたら実依存を確認して報告（推測で先回りしない）。

- [ ] **Step 5: 全テスト回帰**

Run: `npm test`
Expected: 既存含め全 PASS

- [ ] **Step 6: コミット**

```bash
git add js/coach/global-pool.js tests/coach-global-pool.test.js
git commit -m "feat(coach): 全体匿名プール集計コア(buildGlobalPool・車種別)"
```

---

## 完了の定義（Plan 4a）

- `buildGlobalPool` が純関数で実装され `npm test` 全緑。
- 車種別セグメント・memberCount≥2・per-cell k≥2 の匿名性が担保される。
- worker・Firestore・フロントは含まない（Plan 4b）。

## 後続（Plan 4b — デプロイ/admin設定を伴う・別途詳細化）

- **worker `/global-pool-refresh`**: 全ユーザー列挙→生drives読込→`buildGlobalPool`→`globalPool/{vehicleType}/current` へ書込（既存 makeFirestoreDeps / encodeValue / verifyFirebaseIdToken + admin(ADMIN_UIDS)ゲート）。日次は wrangler cron 検討。
- **firestore.rules**: `globalPool/**` を read 全許可・write はサービスアカウントのみ。
- **フロント**: `js/storage.js` に `getGlobalPool(vehicleType)`（`globalPool/{vehicleType}/current` 読込）。`buildFactPack` input に `pool` 追加→ FactPack に `peer`（同車種のこの曜日時間 hourlyA中央値／このエリアの次乗車傾向／sampleSize）を k≥2 ガード付きで追加。`composeAnswer`/`formatAnswer` に peer 行（「同じ車種の人はこの時間◯◯で平均…」）。`coach-ui.js` で `getGlobalPool(vehicleType)` を読んで runCoach へ。
- これらは dev/本番デプロイと Firestore ルール反映を伴うため、ユーザー承認・実機検証とセットで進める。
