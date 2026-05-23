// scripts/convert-stands-pdfs.mjs — 京北の乗り場PDF(道順図)を施設idごとのJPEGに変換
// 使い方: node scripts/convert-stands-pdfs.mjs [srcDir]
//   srcDir 既定: ~/Downloads/attachments
// 出力: tools/data/stands-ref/<id>-1.jpg, <id>-2.jpg ...
// 各施設の画像ファイル名一覧を JSON で stdout に出す（seed JSON への取り込み用）。
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync, existsSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const srcDir = process.argv[2] || path.join(homedir(), 'Downloads', 'attachments');
const outDir = 'tools/data/stands-ref';

// PDFファイル名 → 施設id（名前で対応付け）。manualに無い2件(アメリカンクラブ/パークハイアット)は新規id。
const MAP = {
  '1六本木ヒルズ.pdf': 'roppongi_hills',
  '2泉ガーデン.pdf': 'izumi_garden',
  '3愛宕グリーンヒルズ.pdf': 'atago_green_hills',
  '4汐留住友ビル.pdf': 'shiodome_sumitomo',
  '5品川インターシティ.pdf': 'shinagawa_intercity',
  '6グランドハイアット東京.pdf': 'grand_hyatt_tokyo',
  '7アークヒルズ仙石山森タワー.pdf': 'arkhills_sengokuyama',
  '8東京汐留ビル.pdf': 'tokyo_shiodome_bldg',
  '10セルリアンタワー東急ホテル.pdf': 'cerulean_tower',
  '11ホテルインターコンチネンタル東京ベイ.pdf': 'intercontinental_tokyobay',
  '12東京ミッドタウン.pdf': 'tokyo_midtown_tower',
  '13汐留ビルディング.pdf': 'shiodome_bldg',
  '14紀尾井町ビル.pdf': 'kioicho_bldg',
  '15慶應義塾大学病院.pdf': 'keio_hospital',
  '16ザ・キャピトルホテル東急.pdf': 'capitol_hotel_tokyu',
  '17虎ノ門病院新棟地図.pdf': 'toranomon_hospital',
  '18東京アメリカンクラブ.pdf': 'tokyo_american_club',
  '19国際医療福祉大学付属三田病院_.pdf': 'iuhw_mita_hospital',
  '20代官山T-サイト.pdf': 'daikanyama_tsite',
  '21トレードピアお台場.pdf': 'tradepia_odaiba',
  '22東京女子医科大学病院.pdf': 'twmu_hospital',
  '23東京都済生会中央病院.pdf': 'saiseikai_central',
  '24順天堂医院.pdf': 'juntendo_hospital',
  '25シャングリ・ラホテル東京.pdf': 'shangrila_tokyo',
  '26昭和大学江東豊洲病院.pdf': 'showa_koto_toyosu',
  '27虎ノ門ヒルズ.pdf': 'toranomon_hills',
  '28大手門タワー・JXビル.pdf': 'otemon_tower_jx',
  '29東京日本橋タワー.pdf': 'tokyo_nihonbashi_tower',
  '30大手町グランキューブ.pdf': 'otemon_financial_grancube',
  '31新宿三井ビル.pdf': 'shinjuku_mitsui',
  '32六本木グランドタワー.pdf': 'roppongi_grand_tower',
  '33霞が関ビル.pdf': 'kasumigaseki_bldg',
  '34新宿住友ビル.pdf': 'shinjuku_sumitomo',
  '35東大病院.pdf': 'todai_hospital',
  '36大手町パークビル.pdf': 'otemachi_park_bldg',
  '37東京ガーデンテラス.pdf': 'tokyo_garden_terrace_kioicho',
  '38日医大乗り場案内図.pdf': 'nms_hospital',
  '39東京ミッドタウン日比谷.pdf': 'tokyo_midtown_hibiya',
  '40慈恵医大.pdf': 'jikei_hospital',
  '41虎ノ門ヒルズビジネスタワー乗り場.pdf': 'toranomon_hills_business',
  '42otemach_oneタワー.pdf': 'otemachi_one_tower',
  '43パークハイアット東京.pdf': 'park_hyatt_tokyo',
};

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const result = {}; // id -> ["id-1.jpg", ...]
for (const [file, id] of Object.entries(MAP)) {
  const inPath = path.join(srcDir, file);
  if (!existsSync(inPath)) { console.error('MISSING PDF:', file); continue; }
  const prefix = path.join(outDir, id);
  // 既存の同id画像を掃除
  for (const f of readdirSync(outDir)) {
    if (f.startsWith(id + '-') && f.endsWith('.jpg')) rmSync(path.join(outDir, f));
  }
  // pdftoppm: <prefix>-1.jpg, <prefix>-2.jpg ...
  execFileSync('pdftoppm', ['-jpeg', '-r', '130', '-jpegopt', 'quality=78', inPath, prefix]);
  // pdftoppm は -1/-01 等ゼロ詰めする場合があるので走査して正規化
  const made = readdirSync(outDir).filter((f) => f.startsWith(id + '-') && f.endsWith('.jpg')).sort();
  const norm = [];
  made.forEach((f, i) => {
    const target = `${id}-${i + 1}.jpg`;
    if (f !== target) renameSync(path.join(outDir, f), path.join(outDir, target));
    norm.push(target);
  });
  result[id] = norm;
  console.error(`OK ${id}: ${norm.length}p`);
}
console.log(JSON.stringify(result, null, 0));
