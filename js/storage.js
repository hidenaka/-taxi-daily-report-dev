// storage.js - Firebase-only (GitHub deprecated)
// GitHub版は完全に廃止。常にFirebase版を使用。

const USE_FIREBASE = true;

// Active provider module (loaded dynamically)
let provider;

// Firebase: 認証の初期化はバックグラウンドで開始するだけにし、描画クリティカルパスを
// ブロックしない（コールドスタート対策・案1）。
//
// 以前はここで `await initAuth()` していたため、storage を import する全画面（特にホーム）の
// 描画スクリプトが、Firebase 認証の復元＋Firestore 往復が終わるまで1行も動けなかった。
// その結果コールドスタートでホームが数秒ブランクになっていた。
//
// 撤廃して安全な理由: ネットワークに触れる provider 関数はすべて内部で `await waitForAuth()`
// してから通信する。一方 getConfig / getDrivesForMonth は waitForAuth の前に localStorage の
// TTLキャッシュを即返しするため、キャッシュがあれば認証を待たずホームを即描画できる。
// initAuth() は promise を返し、waitForAuth() が同じ promise を再利用する（多重実行されない）。
const { initAuth } = await import('./firebase-auth.js');
initAuth(); // fire-and-forget: 起動はするが await しない
provider = await import('./firebase-storage.js');

// Re-export all storage functions from the active provider
export const getMyUserId = provider.getMyUserId;
export const setMyUserId = provider.setMyUserId;
export const getRepo = provider.getRepo;
export const getFile = provider.getFile;
export const listFiles = provider.listFiles;
export const getFileCached = provider.getFileCached;
export const getListCached = provider.getListCached;
export const listFilesFresh = provider.listFilesFresh;
export const getConfig = provider.getConfig;
export const getDrive = provider.getDrive;
export const getDrivesForMonth = provider.getDrivesForMonth;
export const getDrivesForMonthCached = provider.getDrivesForMonthCached;
export const putFile = provider.putFile;
export const saveDrive = provider.saveDrive;
export const deleteDrive = provider.deleteDrive;
export const saveConfig = provider.saveConfig;
export const saveDriveSafe = provider.saveDriveSafe;
export const flushPendingQueue = provider.flushPendingQueue;
export const listActiveUserIds = provider.listActiveUserIds;
export const getUserDisplayMap = provider.getUserDisplayMap;
export const getUserRoleMap = provider.getUserRoleMap;
export const getAllUsersDrivesForMonth = provider.getAllUsersDrivesForMonth;
export const listAggregateAnalysisUserIds = provider.listAggregateAnalysisUserIds;
export const getMyAggregateAnalysisFlag = provider.getMyAggregateAnalysisFlag;
export const setMyAggregateAnalysisFlag = provider.setMyAggregateAnalysisFlag;
export const getMyAggregateOnSince = provider.getMyAggregateOnSince;
export const getMyConsecutiveShiftsCount = provider.getMyConsecutiveShiftsCount;
export const getAllUsersDrivesForMonthCached = provider.getAllUsersDrivesForMonthCached;
export const getUserDisplayMapCached = provider.getUserDisplayMapCached;
export const getUserRoleMapCached = provider.getUserRoleMapCached;
export const listActiveUserIdsCached = provider.listActiveUserIdsCached;
export const getConfigCached = provider.getConfigCached;
export const getMyCompanyId = provider.getMyCompanyId;
