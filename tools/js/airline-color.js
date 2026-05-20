// 航空会社コード（ODPT odpt:airline の末尾、例: 'JAL'/'ANA'/'JJP'/'SKY'/'ADO'/'SNA'/'SFJ'）から
// 色キー名を返す純関数と、色キー → hex 色のマップ。
//
// 色は各社のコーポレートカラーに寄せている。SFJ は黒だと背景に紛れるためグレー寄せ。

export const AIRLINE_COLORS = {
  jal:   '#e60012', // JAL 赤
  ana:   '#013193', // ANA 青
  jjp:   '#ff5e1f', // Jetstar 橙
  sky:   '#00b6f0', // Skymark 水
  ado:   '#4ea83a', // Air Do 緑
  sna:   '#f4cd00', // Solaseed 黄
  sfj:   '#4a4a4a', // StarFlyer 黒→グレー
  other: '#777777', // その他 灰
};

const KNOWN = new Set(['JAL', 'ANA', 'JJP', 'SKY', 'ADO', 'SNA', 'SFJ']);

export function airlineToColorKey(airline) {
  if (!airline || typeof airline !== 'string') return 'other';
  return KNOWN.has(airline) ? airline.toLowerCase() : 'other';
}
