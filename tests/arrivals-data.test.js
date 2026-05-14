import { test, assert } from './run.js';
import { normalizeArrivals } from '../tools/js/arrivals-data.js';

test('normalizeArrivals: "to be determined" estimatedTime を null にする', () => {
  const data = {
    flights: [
      { flightNumber: 'NH852', estimatedTime: 'to be determined', scheduledTime: '17:45' }
    ]
  };
  normalizeArrivals(data);
  assert.equal(data.flights[0].estimatedTime, null);
  assert.equal(data.flights[0].scheduledTime, '17:45');
});

test('normalizeArrivals: scheduledTime と actualTime も同様に正規化', () => {
  const data = {
    flights: [
      { scheduledTime: 'to be determined', estimatedTime: '20:00', actualTime: 'to be determined' }
    ]
  };
  normalizeArrivals(data);
  assert.equal(data.flights[0].scheduledTime, null);
  assert.equal(data.flights[0].estimatedTime, '20:00');
  assert.equal(data.flights[0].actualTime, null);
});

test('normalizeArrivals: 正常な時刻はそのまま', () => {
  const data = {
    flights: [
      { flightNumber: 'NH3852', estimatedTime: '20:45', scheduledTime: '20:45' }
    ]
  };
  normalizeArrivals(data);
  assert.equal(data.flights[0].estimatedTime, '20:45');
  assert.equal(data.flights[0].scheduledTime, '20:45');
});

test('normalizeArrivals: flights が空 / undefined でも落ちない', () => {
  assert.equal(normalizeArrivals({ flights: [] }).flights.length, 0);
  assert.equal(normalizeArrivals({}).flights, undefined);
  assert.equal(normalizeArrivals(null), null);
});

test('normalizeArrivals 後に "estimatedTime ?? scheduledTime" が機能する', () => {
  const data = {
    flights: [
      { flightNumber: 'NH852', estimatedTime: 'to be determined', scheduledTime: '17:45' }
    ]
  };
  normalizeArrivals(data);
  const f = data.flights[0];
  const displayTime = f.estimatedTime ?? f.scheduledTime ?? '--:--';
  assert.equal(displayTime, '17:45');
});

test('normalizeArrivals: status="不明" + actualTime なし → "飛行中"', () => {
  const data = {
    flights: [
      { flightNumber: 'JL044', status: '不明', actualTime: null, estimatedTime: '18:44' }
    ]
  };
  normalizeArrivals(data);
  assert.equal(data.flights[0].status, '飛行中');
});

test('normalizeArrivals: status="不明" + actualTime あり → "到着"', () => {
  const data = {
    flights: [
      { flightNumber: 'JL999', status: '不明', actualTime: '14:30', estimatedTime: '14:25' }
    ]
  };
  normalizeArrivals(data);
  assert.equal(data.flights[0].status, '到着');
});

test('normalizeArrivals: status="到着"/"欠航"/"遅延" はそのまま維持', () => {
  const data = {
    flights: [
      { status: '到着' },
      { status: '欠航' },
      { status: '遅延' }
    ]
  };
  normalizeArrivals(data);
  assert.equal(data.flights[0].status, '到着');
  assert.equal(data.flights[1].status, '欠航');
  assert.equal(data.flights[2].status, '遅延');
});
