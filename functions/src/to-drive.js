// js/ocr/src/to-drive.js
// グリッド復元の結果（recognizeReport().rows）を、アプリの日報データ形式
// （js/parser.js の trip / rest オブジェクト）へ変換する。
//
// 純粋なJS処理でDOM非依存。trip/rest の形は js/parser.js に合わせる:
//   trip: { no, pickupKind, boardTime, alightTime, boardPlace, alightPlace,
//           km, amount, isPickup, isCharter, isCancel, waitTime }
//   rest: { startTime, endTime, place }
// 各 trip/rest には元行の低信頼セル情報を _ocrFlags として持たせる
// （ocr-import.html のレビュー表ハイライト用。保存前に input.html 側で剥がす）。

// "休" 相当の No 表記。OCR は "休" を "保" / "㈱" と誤認することがある。
const REST_NO = /[休保㈱]/;

// "1" → 1 / "貸1" → 1 / "" → null
function parseNoInt(noStr) {
  if (noStr == null) return null;
  const m = String(noStr).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// 金額文字列から数字以外を除き整数化（不可なら 0）
function parseAmount(s) {
  if (s == null) return 0;
  const digits = String(s).replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) || 0 : 0;
}

// 小数化（不可なら 0）
function parseKm(s) {
  if (s == null) return 0;
  const v = parseFloat(String(s));
  return Number.isFinite(v) ? v : 0;
}

/**
 * その trip 行が「営業（売上対象）トリップ」か判定する。
 * 回送・休憩の取りこぼし・OCRノイズの空行を営業回数に数えないためのフィルタ。
 *  - 番号付き(No)の行は本表の営業行。END列ズレ等で金額/降車地が空でも残す。
 *  - 金額/km/降車地のいずれかがあれば営業行として残す。
 *  - キャンセルは営業試行として残す（アプリ側で別途キャンセル件数に集計）。
 *  - 番号も内容も無い行（乗降同時刻・0円0km・降車地なしの回送や空行）だけ除外。
 *
 * 注: 時刻の有無では判定しない。斜め撮影で列がずれ降車時刻が空になっても本物の
 *     トリップを落とさないため。ETC明細表の行は reconstructRows の etcY カット
 *     （位置ベース・預り金/会社負担ラベル）で本表から除外済みなのでここには来ない。
 * @param {Object} t  rowsToDrive が組み立てた trip オブジェクト
 * @returns {boolean}
 */
export function isRevenueTrip(t) {
  if (!t) return false;
  if (t.isCancel) return true;
  const hasNo = Number.isFinite(t.no) && t.no > 0;
  const hasContent =
    (Number(t.amount) || 0) > 0 ||
    (Number(t.km) || 0) > 0 ||
    String(t.alightPlace || "").trim() !== "";
  return hasNo || hasContent;
}

/**
 * OCR の構造化行（recognizeReport().rows）をアプリの日報データへ変換する。
 * @param {Array<Object>} rows  各行 { No, 乗車, 降車, 時間, 迎, 乗車地, 降車地, 営Km, 男, 女, 合計, ..., _flags, _raw }
 * @returns {{trips:Array<Object>, rests:Array<Object>}}
 */
export function rowsToDrive(rows) {
  const trips = [];
  const rests = [];
  // trips と同じ並びの No 生テキスト。連番補完で「キ」行を除くのに使う。
  const noTexts = [];
  if (!Array.isArray(rows)) return { trips, rests };

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const flags = row._flags || {};
    const noText = String(row['No'] || '').trim();

    if (REST_NO.test(noText)) {
      rests.push({
        startTime: row['乗車'] || '',
        endTime: row['降車'] || '',
        place: row['乗車地'] || '',
        _ocrFlags: { ...flags },
      });
      continue;
    }

    const km = parseKm(row['営Km']);
    const amount = parseAmount(row['合計']);
    const pickupKind = row['迎'] === '迎' ? '迎' : '';
    // isCancel: アプリの判定（js/parser.js）に合わせる。
    // 行頭「キ」、または amount===400、または km===0 で amount が 500/1000。
    const isCancelMarker = /キ/.test(noText);
    const isCancel = isCancelMarker
      || amount === 400
      || (km === 0 && (amount === 500 || amount === 1000));

    trips.push({
      no: isCancelMarker ? null : parseNoInt(noText),
      pickupKind,
      boardTime: row['乗車'] || '',
      alightTime: row['降車'] || '',
      boardPlace: row['乗車地'] || '',
      alightPlace: row['降車地'] || '',
      km,
      amount: isCancel ? 0 : amount,
      isPickup: pickupKind === '迎',
      isCharter: noText.startsWith('貸'),
      isCancel,
      waitTime: '',
      _ocrFlags: { ...flags },
    });
    noTexts.push(noText);
  }

  // 非営業行（ETC明細・回送・空行）を営業回数から除外する。
  const keep = trips.map(isRevenueTrip);
  const revenueTrips = trips.filter((_, i) => keep[i]);
  const revenueNoTexts = noTexts.filter((_, i) => keep[i]);
  // No の単発誤読を連番補正する（営業明細の No は 1..N の連番）。
  correctTripNumbers(revenueTrips);
  // 読めなかった No（パンチ穴で潰れた等）を前後から補完する。
  fillMissingTripNumbers(revenueTrips, revenueNoTexts);
  return { trips: revenueTrips, rests };
}

/**
 * 読めなかった No を前後の連番から補完する（破壊的・配列を直接書き換える）。
 *
 * 明細用紙にパンチ穴が開いていると No セルが物理的に潰れて読めない
 * （2026/06/18 の明細では穴が No.11/12 を消した）。営業明細の No は 1..N の連番
 * なので、前後の番号と欠落行数が矛盾しないときだけ埋める。行そのものを取りこぼして
 * いる場合（番号差と行数が合わない）は誤った番号を作らないよう触らない。
 *
 * キャンセル行（No 欄が「キ」）はそもそも番号を持たないため対象外。
 *
 * @param {Array<{no:number|null}>} trips 順序通りの営業トリップ配列
 * @param {Array<string>} noTexts trips と同じ並びの No 生テキスト
 * @returns {Array} 同じ配列（補完済み）
 */
export function fillMissingTripNumbers(trips, noTexts) {
  if (!Array.isArray(trips)) return trips;
  const texts = Array.isArray(noTexts) ? noTexts : [];
  // 補完対象か（番号が無く、かつ「キ」行でない）
  const fillable = (i) =>
    !Number.isFinite(trips[i] && trips[i].no) && !/キ/.test(String(texts[i] || ''));

  let i = 0;
  while (i < trips.length) {
    if (!fillable(i)) { i++; continue; }
    // 欠落の連続区間 [i, j) を取る
    let j = i;
    while (j < trips.length && fillable(j)) j++;
    const len = j - i;
    const prev = i > 0 && Number.isFinite(trips[i - 1].no) ? trips[i - 1].no : null;
    const next = j < trips.length && Number.isFinite(trips[j].no) ? trips[j].no : null;

    if (prev != null && next != null) {
      // 前後で挟めるとき: 番号差と欠落行数が一致するときだけ埋める
      if (next - prev - 1 === len) {
        for (let k = 0; k < len; k++) trips[i + k].no = prev + 1 + k;
      }
    } else if (prev != null) {
      // 末尾の欠落: 直前からの連番
      for (let k = 0; k < len; k++) trips[i + k].no = prev + 1 + k;
    } else if (next != null) {
      // 先頭の欠落: 直後から逆算（1 未満になるなら諦める）
      if (next - len >= 1) {
        for (let k = 0; k < len; k++) trips[i + k].no = next - len + k;
      }
    }
    i = j;
  }
  return trips;
}

/**
 * 営業トリップの No 列の単発誤読を連番補正する（破壊的・配列を直接書き換える）。
 * 営業明細の No は順に 1,2,3,…N の連番。前後が連番(no[i-1] と no[i+1]=no[i-1]+2)
 * なのに no[i] がそれに合わない外れ値（例: "2"→"21", "7"→"1" の誤読）を no[i-1]+1 に直す。
 * 前後で挟めるものだけ直すので、正当なギャップ(行欠落)や null(キャンセル等)は触らない。
 * @param {Array<{no:number|null}>} trips 順序通りの営業トリップ配列
 * @returns {Array} 同じ配列（補正済み）
 */
export function correctTripNumbers(trips) {
  if (!Array.isArray(trips)) return trips;
  for (let i = 1; i < trips.length - 1; i++) {
    const prev = trips[i - 1] && trips[i - 1].no;
    const cur = trips[i] && trips[i].no;
    const next = trips[i + 1] && trips[i + 1].no;
    if (
      Number.isFinite(prev) && Number.isFinite(cur) && Number.isFinite(next) &&
      next === prev + 2 && cur !== prev + 1
    ) {
      trips[i].no = prev + 1;
    }
  }
  return trips;
}
