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

const HHMM = /^\d{1,2}:\d{2}$/;

/**
 * その trip 行が「営業（売上対象）トリップ」か判定する。
 * 非営業行（ETC明細の行・回送・休憩の取りこぼし・OCRノイズの空行）を
 * 営業回数に数えないためのフィルタ。判定は誤読に強い構造的特徴で行う:
 *  - 営業明細の本表トリップは乗車・降車の両時刻を必ず持つ。
 *    ETC明細表は時刻列が1つ（降車時刻なし）なので両時刻条件で落ちる。
 *  - 番号付き(No)の行は本表の営業行。END列ズレ等で金額/降車地が空に見えても残す。
 *  - キャンセルは営業試行として残す（アプリ側で別途キャンセル件数に集計）。
 *  - 上記に当たらず、番号も内容（金額/km/降車地）も無い行は回送/空行として除外。
 * @param {Object} t  rowsToDrive が組み立てた trip オブジェクト
 * @returns {boolean}
 */
export function isRevenueTrip(t) {
  if (!t) return false;
  const hasBoard = HHMM.test(String(t.boardTime || "").trim());
  const hasAlight = HHMM.test(String(t.alightTime || "").trim());
  if (!hasBoard || !hasAlight) return false;
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
  }

  // 非営業行（ETC明細・回送・空行）を営業回数から除外する。
  return { trips: trips.filter(isRevenueTrip), rests };
}
