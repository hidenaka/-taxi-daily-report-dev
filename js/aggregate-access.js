// 営業サポート「全員データ統合」の閲覧レベル制御（C案＋E案・継続出番数連動）
// 純関数のみ。連続ON期間中の出番数で段階が上がる。
// E案: 「ONにして見た瞬間だけ提供」のフリーライダー抑止＋継続利用インセンティブ。

// 段階定義
// onboarding: 0-3出番 / light: 4-9 / standard: 10-19 / full: 20+
export const ACCESS_LEVELS = {
  onboarding: {
    minShifts: 0,
    label: 'スタート',
    recHistoryTop: 5,
    areaTop: 0,           // 0 = ロック
    highValueTop: 0,
  },
  light: {
    minShifts: 4,
    label: 'ライト',
    recHistoryTop: 15,
    areaTop: 10,
    highValueTop: 0,
  },
  standard: {
    minShifts: 10,
    label: 'スタンダード',
    recHistoryTop: 30,
    areaTop: 15,
    highValueTop: 10,
  },
  full: {
    minShifts: 20,
    label: 'フル',
    recHistoryTop: Infinity,
    areaTop: Infinity,
    highValueTop: Infinity,
  },
};

// 連続ON期間中の出番数 → 段階名
export function getAccessLevel(shiftsCount) {
  const n = Math.max(0, Number(shiftsCount) || 0);
  if (n >= ACCESS_LEVELS.full.minShifts) return 'full';
  if (n >= ACCESS_LEVELS.standard.minShifts) return 'standard';
  if (n >= ACCESS_LEVELS.light.minShifts) return 'light';
  return 'onboarding';
}

// 次の段階・残り出番数
export function getNextThreshold(shiftsCount) {
  const n = Math.max(0, Number(shiftsCount) || 0);
  if (n >= ACCESS_LEVELS.full.minShifts) return { nextLevel: null, shiftsRemaining: 0 };
  if (n >= ACCESS_LEVELS.standard.minShifts) {
    return { nextLevel: 'full', shiftsRemaining: ACCESS_LEVELS.full.minShifts - n };
  }
  if (n >= ACCESS_LEVELS.light.minShifts) {
    return { nextLevel: 'standard', shiftsRemaining: ACCESS_LEVELS.standard.minShifts - n };
  }
  return { nextLevel: 'light', shiftsRemaining: ACCESS_LEVELS.light.minShifts - n };
}

// 出番数 → 表示件数制限（{recHistoryTop, areaTop, highValueTop}）
export function getAccessLimits(shiftsCount) {
  const level = getAccessLevel(shiftsCount);
  const def = ACCESS_LEVELS[level];
  return {
    recHistoryTop: def.recHistoryTop,
    areaTop: def.areaTop,
    highValueTop: def.highValueTop,
  };
}
