import { test } from 'node:test';
import assert from 'node:assert';
import {
  ensureRecordIds, mergeRecords, mergeSyncDocs, pickSettings, SETTINGS_KEYS,
} from '../tools/js/timer-sync.js';

test('ensureRecordIds: id無しはlegacy決定的id付与・updatedAtはrecordedAt由来・deleted既定false', () => {
  const out = ensureRecordIds([{ recordedAt: '2026-06-07T01:00:00.000Z', durationSec: 600 }]);
  assert.equal(out[0].id, 'legacy-2026-06-07T01:00:00.000Z');
  assert.equal(out[0].durationSec, 600);
  assert.equal(out[0].deleted, false);
  assert.equal(out[0].updatedAt, Date.parse('2026-06-07T01:00:00.000Z'));
});

test('ensureRecordIds: 既存id/updatedAt/deletedは保持', () => {
  const out = ensureRecordIds([{ id: 'x1', recordedAt: 'r', durationSec: 60, updatedAt: 999, deleted: true }]);
  assert.deepEqual(out[0], { id: 'x1', recordedAt: 'r', durationSec: 60, updatedAt: 999, deleted: true });
});

test('ensureRecordIds: 非配列は空配列', () => {
  assert.deepEqual(ensureRecordIds(null), []);
});

test('mergeRecords: union（片側だけのidも残る）', () => {
  const a = [{ id: 'a', recordedAt: 'ra', durationSec: 1, updatedAt: 1, deleted: false }];
  const b = [{ id: 'b', recordedAt: 'rb', durationSec: 2, updatedAt: 1, deleted: false }];
  const m = mergeRecords(a, b);
  assert.deepEqual(m.map(r => r.id).sort(), ['a', 'b']);
});

test('mergeRecords: 同idはupdatedAt新しい方（cloudが新しければcloud採用）', () => {
  const local = [{ id: 'x', recordedAt: 'old', durationSec: 1, updatedAt: 10, deleted: false }];
  const cloud = [{ id: 'x', recordedAt: 'new', durationSec: 2, updatedAt: 20, deleted: false }];
  const m = mergeRecords(local, cloud);
  assert.equal(m.length, 1);
  assert.equal(m[0].recordedAt, 'new');
});

test('mergeRecords: updatedAt同点はlocal優先', () => {
  const local = [{ id: 'x', recordedAt: 'L', durationSec: 1, updatedAt: 5, deleted: false }];
  const cloud = [{ id: 'x', recordedAt: 'C', durationSec: 2, updatedAt: 5, deleted: false }];
  assert.equal(mergeRecords(local, cloud)[0].recordedAt, 'L');
});

test('mergeRecords: 墓石は残る（削除がより新しければdeleted=trueを採用）', () => {
  const local = [{ id: 'x', recordedAt: 'r', durationSec: 1, updatedAt: 10, deleted: false }];
  const cloud = [{ id: 'x', recordedAt: 'r', durationSec: 1, updatedAt: 20, deleted: true }];
  const m = mergeRecords(local, cloud);
  assert.equal(m[0].deleted, true);
});

test('pickSettings: SETTINGS_KEYSだけ抽出', () => {
  const st = { mode: 'down', soundOn: false, records: [1], stopwatch: {}, foo: 1 };
  const s = pickSettings(st);
  assert.equal(s.mode, 'down');
  assert.equal(s.soundOn, false);
  assert.ok(!('records' in s) && !('stopwatch' in s) && !('foo' in s));
  assert.ok(SETTINGS_KEYS.includes('countdownPresets'));
});

test('mergeSyncDocs: recordsはmerge、settingsはsettingsUpdatedAt後勝ち', () => {
  const local = { records: [{ id: 'a', recordedAt: 'ra', durationSec: 1, updatedAt: 1, deleted: false }], settings: { mode: 'up' }, settingsUpdatedAt: 100 };
  const cloud = { records: [{ id: 'b', recordedAt: 'rb', durationSec: 2, updatedAt: 1, deleted: false }], settings: { mode: 'down' }, settingsUpdatedAt: 200 };
  const m = mergeSyncDocs(local, cloud);
  assert.deepEqual(m.records.map(r => r.id).sort(), ['a', 'b']);
  assert.equal(m.settings.mode, 'down');
  assert.equal(m.settingsUpdatedAt, 200);
});

test('mergeSyncDocs: cloudがnullならlocalそのまま', () => {
  const local = { records: [], settings: { mode: 'up' }, settingsUpdatedAt: 100 };
  assert.deepEqual(mergeSyncDocs(local, null), local);
});
