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

  return { trips, rests };
}
