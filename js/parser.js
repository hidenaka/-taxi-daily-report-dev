// 形式判別: 最初の非空行（ヘッダー）にカンマがあれば CSV (Gemini)、それ以外はタブ (Claude)
// 先頭に空行があっても誤判定しないよう、空でない最初の行で判定する
export function detectFormat(text) {
  const firstLine = text.split('\n').find(l => l.trim() !== '') || '';
  return firstLine.includes(',') ? 'gemini' : 'claude';
}

// 「合計」列のような "1,000" や "29,110" を数値化（カンマ除去）
function parseAmount(s) {
  if (!s || s.trim() === '') return 0;
  return parseInt(s.replace(/,/g, ''), 10) || 0;
}

function parseKm(s) {
  if (!s || s.trim() === '') return 0;
  return parseFloat(s) || 0;
}

// "1" → 1 / "貸1" → 1 / "キ" → null / "" → null
function parseNo(noStr) {
  if (!noStr) return null;
  const m = noStr.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parseClaudeRow(cells) {
  // [No, 乗車, 降車, 時間, 迎, 乗車地, 降車地, 営Km, 合計, 待機]
  const [no, board, alight, dur, pickup, bp, ap, km, amt, wait] = cells;
  if (no === '休') {
    return { type: 'rest', startTime: board, endTime: alight, place: bp };
  }
  // キャンセル判定: 行頭が「キ」、または amount=400 (無条件)、または km=0 で amount=500/1000
  // 乗降同所+0kmは待機料金で売上が立つこともあるため、金額が400/500/1000以外なら通常乗車扱い
  const amtNum = parseAmount(amt);
  const kmNum = parseKm(km);
  const isCancelMarker = no === 'キ';
  const isCharter = typeof no === 'string' && no.startsWith('貸');
  const isCancel = isCancelMarker || amtNum === 400 || (kmNum === 0 && (amtNum === 500 || amtNum === 1000));
  return {
    type: 'trip',
    no: isCancelMarker ? null : parseNo(no),
    pickupKind: pickup || '',
    boardTime: board,
    alightTime: alight,
    boardPlace: bp,
    alightPlace: ap,
    km: parseKm(km),
    amount: isCancel ? 0 : parseAmount(amt),
    isPickup: pickup === '迎',
    isCharter,
    isCancel,
    waitTime: wait || ''
  };
}

// CSV1行を引用符を考慮してセルに分解
function splitCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === ',' && !inQuotes) { cells.push(cur); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur);
  return cells;
}

function parseGeminiRow(cells) {
  // [No, 乗車, 降車, 時間, 迎, 乗車地, 降車地, 営Km, 男, 女, 合計]
  const [no, board, alight, dur, pickup, bp, ap, km, _m, _f, amt] = cells;
  if (no === '休') {
    return { type: 'rest', startTime: board, endTime: alight, place: bp };
  }
  // キャンセル判定: 行頭が「キ」、または amount=400 (無条件)、または km=0 で amount=500/1000
  // 乗降同所+0kmは待機料金で売上が立つこともあるため、金額が400/500/1000以外なら通常乗車扱い
  const amtNum = parseAmount(amt);
  const kmNum = parseKm(km);
  const isCancelMarker = no === 'キ';
  const isCharter = typeof no === 'string' && no.startsWith('貸');
  const isCancel = isCancelMarker || amtNum === 400 || (kmNum === 0 && (amtNum === 500 || amtNum === 1000));
  return {
    type: 'trip',
    no: isCancelMarker ? null : parseNo(no),
    pickupKind: pickup || '',
    boardTime: board,
    alightTime: alight,
    boardPlace: bp,
    alightPlace: ap,
    km: parseKm(km),
    amount: isCancel ? 0 : parseAmount(amt),
    isPickup: pickup === '迎',
    isCharter,
    isCancel,
    waitTime: ''
  };
}

export function parseReport(text) {
  const format = detectFormat(text);
  const lines = text.split('\n').filter(l => l.trim() !== '');
  const dataLines = lines.slice(1);

  const trips = [];
  const rests = [];

  for (const line of dataLines) {
    const cells = format === 'claude' ? line.split('\t') : splitCsvLine(line);
    if (cells.length === 0 || (cells.length === 1 && cells[0].trim() === '')) continue;

    const parsed = format === 'claude' ? parseClaudeRow(cells) : parseGeminiRow(cells);
    if (parsed.type === 'rest') {
      rests.push({ startTime: parsed.startTime, endTime: parsed.endTime, place: parsed.place });
    } else {
      delete parsed.type;
      trips.push(parsed);
    }
  }

  // 末尾の行が rests の最後の要素と一致するかで判定
  const allDataCells = dataLines.length > 0
    ? (format === 'claude' ? dataLines[dataLines.length - 1].split('\t') : splitCsvLine(dataLines[dataLines.length - 1]))
    : [];
  const lastNo = allDataCells[0];
  const returnTime = lastNo === '休' && rests.length > 0 ? rests[rests.length - 1].endTime : null;

  return { trips, rests, returnTime, format };
}

// 4行ヘッダー + 区切り線 + CSV/タブ表 のフォーマットをパース
// 区切り線は --- だけでなく、iOS/macOS の Smart Dashes による
// — (em-dash) / – (en-dash) や、katakana 長音 ー なども受け入れる
const SEP_REGEX = /^[-—–―−ー－]+$/;
const HEADER_KEYS = ['日付', '車種', '出庫', '帰庫'];

export function parseFormattedReport(text) {
  const lines = text.split('\n');
  const header = { 日付: '', 車種: '', 出庫: '', 帰庫: '' };
  let dataStart = -1;
  let lastHeaderIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (SEP_REGEX.test(line)) { dataStart = i + 1; break; }
    // : または ： (全角) を許容。先頭の # > * - 等のマークダウン装飾も許容
    const m = line.match(/^[#>*\s-]*(日付|車種|出庫|帰庫)\s*[:：]\s*(.*)$/);
    if (m) { header[m[1]] = m[2].trim(); lastHeaderIdx = i; }
  }
  // 区切り線が見つからなくても、ヘッダー4行が揃っていれば直後を data とみなす
  if (dataStart === -1) {
    if (HEADER_KEYS.every(k => header[k] !== undefined) && lastHeaderIdx >= 0) {
      dataStart = lastHeaderIdx + 1;
    } else {
      throw new Error('parseFormattedReport: ヘッダー(日付/車種/出庫/帰庫)が見つかりません');
    }
  }
  const dataText = lines.slice(dataStart).join('\n');
  const inner = parseReport(dataText);
  return {
    date: header.日付,
    vehicleType: header.車種,
    departureTime: header.出庫,
    returnTime: header.帰庫 || inner.returnTime,
    trips: inner.trips,
    rests: inner.rests,
    format: inner.format,
    rawText: text
  };
}
