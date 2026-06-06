// AI相談コーチを表示する環境か。dev(GitHub Pages の /-taxi-daily-report-dev)とlocalhostのみ有効＝本番は非表示。
export function coachEnabledFor(hostname, pathname) {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  return String(pathname || '').startsWith('/-taxi-daily-report-dev');
}
export function isCoachEnabled() {
  try { return coachEnabledFor(location.hostname, location.pathname); }
  catch { return false; }
}
