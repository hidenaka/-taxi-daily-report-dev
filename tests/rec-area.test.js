import { test, assert } from './run.js';
import { chooseInitialRecArea, filterRecAreaCandidates } from '../js/rec-area.js';

// ====== chooseInitialRecArea ======
// 優先順位: 1.gpsArea → 2.lastArea → 3.companyDefault → 4.fallback → 5.availableAreas[0]
// ただし availableAreas に含まれていない値は無視する

test('chooseInitialRecArea: gpsArea を最優先（availableAreasに含まれる時）', () => {
  const result = chooseInitialRecArea({
    gpsArea: '千代田区丸の内',
    lastArea: '港区六本木',
    companyDefault: '大田区平和島',
    fallback: '千代田区丸の内',
    availableAreas: ['千代田区丸の内', '港区六本木', '大田区平和島'],
  });
  assert.equal(result, '千代田区丸の内');
});

test('chooseInitialRecArea: gpsArea が availableAreas にない時は次の優先順位（lastArea）', () => {
  const result = chooseInitialRecArea({
    gpsArea: '北海道札幌市',
    lastArea: '港区六本木',
    companyDefault: '大田区平和島',
    fallback: '千代田区丸の内',
    availableAreas: ['千代田区丸の内', '港区六本木', '大田区平和島'],
  });
  assert.equal(result, '港区六本木');
});

test('chooseInitialRecArea: gpsもlastも無い時は companyDefault', () => {
  const result = chooseInitialRecArea({
    gpsArea: null,
    lastArea: null,
    companyDefault: '大田区平和島',
    fallback: '千代田区丸の内',
    availableAreas: ['千代田区丸の内', '港区六本木', '大田区平和島'],
  });
  assert.equal(result, '大田区平和島');
});

test('chooseInitialRecArea: gps/last/companyDefault 全て無効なら fallback（丸の内）', () => {
  const result = chooseInitialRecArea({
    gpsArea: null,
    lastArea: null,
    companyDefault: null,
    fallback: '千代田区丸の内',
    availableAreas: ['千代田区丸の内', '港区六本木', '大田区平和島'],
  });
  assert.equal(result, '千代田区丸の内');
});

test('chooseInitialRecArea: fallback も availableAreas に無ければ availableAreas[0]', () => {
  const result = chooseInitialRecArea({
    gpsArea: null,
    lastArea: null,
    companyDefault: null,
    fallback: '千代田区丸の内',
    availableAreas: ['港区六本木', '渋谷区渋谷'],
  });
  assert.equal(result, '港区六本木');
});

test('chooseInitialRecArea: availableAreas が空なら空文字を返す', () => {
  const result = chooseInitialRecArea({
    gpsArea: '千代田区丸の内',
    lastArea: null,
    companyDefault: null,
    fallback: '千代田区丸の内',
    availableAreas: [],
  });
  assert.equal(result, '');
});

test('chooseInitialRecArea: lastArea が空文字なら無視して次の優先順位', () => {
  const result = chooseInitialRecArea({
    gpsArea: null,
    lastArea: '',
    companyDefault: '大田区平和島',
    fallback: '千代田区丸の内',
    availableAreas: ['千代田区丸の内', '大田区平和島'],
  });
  assert.equal(result, '大田区平和島');
});

test('chooseInitialRecArea: 全引数undefinedでも安全（フォールバックなしでも空文字）', () => {
  const result = chooseInitialRecArea({ availableAreas: ['A'] });
  assert.equal(result, 'A'); // 何もなければavailableAreas[0]
});

// ====== filterRecAreaCandidates ======
// dropoffAreaAnalysis の返却から OFFICE_AREA を除外し、件数降順でソートして返す
// minDropoffs (default=5) 未満も除外する

test('filterRecAreaCandidates: OFFICE_AREA を除外', () => {
  const input = [
    { area: '大田区北馬込', dropoffs: 100 },
    { area: '千代田区丸の内', dropoffs: 50 },
    { area: '港区六本木', dropoffs: 30 },
  ];
  const result = filterRecAreaCandidates(input, '大田区北馬込');
  assert.deepEqual(
    result.map(r => r.area),
    ['千代田区丸の内', '港区六本木']
  );
});

test('filterRecAreaCandidates: 件数降順でソート', () => {
  const input = [
    { area: '港区六本木', dropoffs: 30 },
    { area: '千代田区丸の内', dropoffs: 50 },
    { area: '渋谷区渋谷', dropoffs: 80 },
  ];
  const result = filterRecAreaCandidates(input, '大田区北馬込');
  assert.deepEqual(
    result.map(r => r.area),
    ['渋谷区渋谷', '千代田区丸の内', '港区六本木']
  );
});

test('filterRecAreaCandidates: minDropoffs 未満を除外（デフォルト5）', () => {
  const input = [
    { area: '千代田区丸の内', dropoffs: 50 },
    { area: '少件エリア', dropoffs: 3 },
    { area: '港区六本木', dropoffs: 30 },
  ];
  const result = filterRecAreaCandidates(input, '大田区北馬込');
  assert.deepEqual(
    result.map(r => r.area),
    ['千代田区丸の内', '港区六本木']
  );
});

test('filterRecAreaCandidates: minDropoffs を明示指定', () => {
  const input = [
    { area: '千代田区丸の内', dropoffs: 50 },
    { area: '少件エリア', dropoffs: 3 },
  ];
  const result = filterRecAreaCandidates(input, '大田区北馬込', 1);
  assert.deepEqual(
    result.map(r => r.area),
    ['千代田区丸の内', '少件エリア']
  );
});

test('filterRecAreaCandidates: officeArea が null/undefined でも動く（除外なし）', () => {
  const input = [
    { area: '大田区北馬込', dropoffs: 100 },
    { area: '千代田区丸の内', dropoffs: 50 },
  ];
  const result = filterRecAreaCandidates(input, null);
  assert.deepEqual(
    result.map(r => r.area),
    ['大田区北馬込', '千代田区丸の内']
  );
});

test('filterRecAreaCandidates: 入力が空配列なら空配列を返す', () => {
  const result = filterRecAreaCandidates([], '大田区北馬込');
  assert.deepEqual(result, []);
});
