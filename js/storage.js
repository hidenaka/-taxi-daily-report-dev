// storage.js - Firebase-only (GitHub deprecated)
// GitHub版は完全に廃止。常にFirebase版を使用。

const USE_FIREBASE = true;

// Active provider module (loaded dynamically)
let provider;

// Firebase: initialize auth before loading storage
const { initAuth } = await import('./firebase-auth.js');
await initAuth();
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
export const getAllUsersDrivesForMonthCached = provider.getAllUsersDrivesForMonthCached;
export const getUserDisplayMapCached = provider.getUserDisplayMapCached;
export const getUserRoleMapCached = provider.getUserRoleMapCached;
export const listActiveUserIdsCached = provider.listActiveUserIdsCached;
export const getConfigCached = provider.getConfigCached;
