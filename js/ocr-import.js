// js/ocr-import.js
// 写真取り込み画面。営業明細の写真を選択 → Cloud Function でOCR →
// 結果（trips/rests）を sessionStorage 経由で日報入力ページ(input.html)へ渡す。
// 明細の確認・修正、日付の入力は input.html で行う（中間レビュー画面は廃止）。
//
// OCR本体は Firebase Cloud Function（サーバー）で実行。画像はサーバー上で
// メモリ処理のみ・非保存・非ログ。端末内OCRは廃止済み。
import { auth } from "./firebase-init.js";

// OCR関数のURL。auth と同じ Firebase プロジェクト（dev/prod）を自動で指す。
const FUNCTION_URL =
  "https://us-central1-" + auth.app.options.projectId + ".cloudfunctions.net/ocrReportFn";

const input = document.getElementById("imageInput");
const statusEl = document.getElementById("ocrStatus");

// 選択ファイルを JPEG Blob に変換する。
// iOSのHEIC等もブラウザでデコード→canvas→JPEG再エンコードで形式を統一する。
// 長辺は4000pxに制限（iOSのcanvas上限内。サーバーは内部で3200pxへ縮小する）。
async function fileToJpegBlob(file) {
  const bitmap = await createImageBitmap(file);
  const MAX = 4000;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("画像の変換に失敗しました"))),
      "image/jpeg",
      0.92
    );
  });
}

// ── 解析中の進捗バー ───────────────────────────────────────────
// サーバー処理の内部段階はクライアントから見えないため、経過時間ベースで
// 漸近的にバーを進める（完了するまで100%にはしない）。経過秒数は実数を表示。
let progressTimer = null;
let progressTrack = null;
let progressBar = null;
function showProgress() {
  if (!progressTrack) {
    progressTrack = document.createElement("div");
    progressTrack.className = "ocr-progress";
    progressBar = document.createElement("div");
    progressBar.className = "ocr-progress-bar";
    progressTrack.appendChild(progressBar);
    statusEl.insertAdjacentElement("afterend", progressTrack);
  }
  progressTrack.style.display = "";
  progressBar.style.width = "0%";
  const start = Date.now();
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    const sec = (Date.now() - start) / 1000;
    const pct = 92 * (1 - Math.exp(-sec / 16));
    progressBar.style.width = pct.toFixed(1) + "%";
    statusEl.textContent = `解析中… ${Math.floor(sec)}秒（初回は時間がかかります）`;
  }, 250);
}
function hideProgress() {
  clearInterval(progressTimer);
  progressTimer = null;
  if (progressBar) progressBar.style.width = "100%";
  if (progressTrack) progressTrack.style.display = "none";
}

input.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  try {
    statusEl.textContent = "ログインを確認中…";
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) {
      statusEl.textContent = "ログインが必要です。ログインしてから写真を選んでください。";
      return;
    }

    statusEl.textContent = "画像を準備中…";
    const blob = await fileToJpegBlob(file);
    const token = await user.getIdToken();

    statusEl.textContent = "解析中…";
    showProgress();
    let res;
    try {
      res = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "image/jpeg" },
        body: blob,
      });
    } finally {
      hideProgress();
    }

    if (!res.ok) {
      let msg = `サーバーエラー (${res.status})`;
      try { msg = (await res.json()).error || msg; } catch (_) {}
      statusEl.textContent = "エラー: " + msg;
      return;
    }

    const data = await res.json();
    const trips = data.trips || [];
    const rests = data.rests || [];
    if (trips.length === 0 && rests.length === 0) {
      statusEl.textContent = "明細を読み取れませんでした。明るい場所で、営業明細の全体が入るように撮り直してください。";
      return;
    }

    // 結果を input.html へ引き渡す。確認・修正・日付入力は input.html で行う。
    statusEl.textContent = `読み取り完了: 乗車 ${trips.length}件 ・ 休憩 ${rests.length}回。日報入力ページへ移動します…`;
    sessionStorage.setItem("ocrImport", JSON.stringify({ trips, rests, ts: Date.now() }));
    location.href = "input.html";
  } catch (err) {
    statusEl.textContent = "エラー: " + ((err && err.message) || err);
  }
});
