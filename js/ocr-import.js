// js/ocr-import.js
// 写真取り込み画面のUIグルー。営業明細の写真を選択 → Cloud Function に送信 →
// サーバー側でOCR → 返ってきた日報データ（trips/rests）を編集レビュー表に表示 →
// 「日報に取り込む」で input.html へ引き渡す。
//
// OCR本体は Firebase Cloud Function（サーバー）で実行する。画像はサーバー上で
// メモリ処理のみ・ディスク非保存・ログ非出力。端末内OCRは廃止済み。
import { auth } from "./firebase-init.js";

// OCR関数のURL。auth と同じ Firebase プロジェクト（dev/prod）を自動で指す。
const FUNCTION_URL =
  "https://us-central1-" + auth.app.options.projectId + ".cloudfunctions.net/ocrReportFn";

const input = document.getElementById("imageInput");
const statusEl = document.getElementById("ocrStatus");
const reviewEl = document.getElementById("ocrReview");
const importBtn = document.getElementById("importBtn");

// 現在レビュー中のデータ（編集はこのオブジェクトに即時反映される）。
let reviewData = null;

// サマリ表示要素（renderReview で生成）。
let summaryEl = null;

// "H:MM"/"HH:MM" → 分。空/不正は -1。
function timeToMin(s) {
  const m = String(s || "").match(/(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : -1;
}

// reviewData を集計してサマリ要素を更新する。セル編集時にも呼ぶ。
// 表示はテキスト貼付時（input.html のプレビュー）と同じ書式。
function updateSummary() {
  if (!summaryEl || !reviewData) return;
  const trips = reviewData.trips || [];
  const rests = reviewData.rests || [];
  const cancelCount = trips.filter((t) => t.isCancel).length;
  const validCount = trips.length - cancelCount;
  const totalSales = trips
    .filter((t) => !t.isCancel)
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  summaryEl.innerHTML =
    `<strong>${validCount}件</strong> ・ キャンセル ${cancelCount}件 ・ ` +
    `休憩 ${rests.length}回 ・ 売上 ¥${totalSales.toLocaleString()}（税込）`;
}

// ── 解析中の進捗バー ───────────────────────────────────────────
// サーバー処理の内部段階はクライアントから見えないため、経過時間ベースで
// 漸近的にバーを進める（完了するまで100%にはしない＝誤って先に満了しない）。
// 経過秒数は実数を表示する。
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
    // 速く立ち上がり徐々に緩む。上限92%（応答到着で実質完了）。
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

// trip / rest の編集可能セル（td）を作る。
// _ocrFlags にフラグが立つセルは low-confidence クラスでハイライト。
function cell(obj, key, opts) {
  const td = document.createElement("td");
  const flags = obj._ocrFlags || {};
  // OCR列名（flagKey）とアプリ列名（key）が異なる場合に opts.flagKey で対応。
  const flagKey = (opts && opts.flagKey) || key;
  if (flags[flagKey]) td.classList.add("low-confidence");
  const inp = document.createElement("input");
  if (opts && opts.type) inp.type = opts.type;
  if (opts && opts.step) inp.step = opts.step;
  inp.value = obj[key] == null ? "" : obj[key];
  inp.addEventListener("change", () => {
    if (opts && opts.type === "number") {
      const v = parseFloat(inp.value);
      obj[key] = Number.isFinite(v) ? v : 0;
    } else {
      obj[key] = inp.value;
    }
    updateSummary(); // 金額等の修正をサマリへ即反映
  });
  td.appendChild(inp);
  return td;
}

// trips/rests を編集可能なレビュー表として描画する。
// 1行 = 1 trip。休憩行も時系列に混ぜ、種別が分かるように表示する。
function renderReview(trips, rests) {
  reviewEl.innerHTML = "";

  // サマリ（件数・売上）。読み取りが妥当か一目で確認するため表の上に出す。
  summaryEl = document.createElement("div");
  summaryEl.className = "review-summary";
  summaryEl.style.cssText =
    "background:#e8f0fe;border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:14px;";
  reviewEl.appendChild(summaryEl);

  const hint = document.createElement("p");
  hint.className = "review-hint";
  hint.textContent =
    "黄色のセルは読み取りの確度が低い箇所です。各セルはタップで修正できます。" +
    "表は横スクロールで全項目を確認できます。確認・修正してから取り込んでください。";
  reviewEl.appendChild(hint);

  const wrap = document.createElement("div");
  wrap.className = "review-wrap";
  const tbl = document.createElement("table");
  tbl.className = "review-table";
  tbl.innerHTML =
    "<tr><th>No</th><th>乗車</th><th>降車</th><th>迎</th>" +
    "<th>乗車地</th><th>降車地</th><th>km</th><th>金額</th></tr>";

  // trips と rests を時刻順に混ぜて表示する。
  const all = [
    ...trips.map((t) => ({ kind: "trip", obj: t })),
    ...rests.map((r) => ({ kind: "rest", obj: r })),
  ];
  // 時系列に並べる。1勤務は24h未満の連続帯なので、勤務開始（文書先頭の行）
  // より前の時刻は翌日とみなし +24h する（日跨ぎ勤務でも正しく並ぶ）。
  // 文字列比較だと "7:37" が "10:00" より後ろに来てしまうため数値で比較する。
  const anchorCands = [];
  if (trips[0]) anchorCands.push(timeToMin(trips[0].boardTime));
  if (rests[0]) anchorCands.push(timeToMin(rests[0].startTime));
  const validAnchors = anchorCands.filter((v) => v >= 0);
  const anchor = validAnchors.length ? Math.min(...validAnchors) : 0;
  const effMin = (s) => {
    const m = timeToMin(s);
    if (m < 0) return 1e9; // 時刻なしは末尾へ
    return m < anchor ? m + 1440 : m;
  };
  all.sort(
    (a, b) =>
      effMin(a.obj.boardTime || a.obj.startTime) -
      effMin(b.obj.boardTime || b.obj.startTime)
  );

  for (const item of all) {
    const tr = document.createElement("tr");
    if (item.kind === "rest") {
      tr.className = "rest";
      const r = item.obj;
      const noTd = document.createElement("td");
      noTd.textContent = "休";
      tr.appendChild(noTd);
      tr.appendChild(cell(r, "startTime"));
      tr.appendChild(cell(r, "endTime"));
      tr.appendChild(document.createElement("td")); // 迎（休憩は無し）
      tr.appendChild(cell(r, "place", { flagKey: "乗車地" }));
      tr.appendChild(document.createElement("td")); // 降車地
      tr.appendChild(document.createElement("td")); // km
      tr.appendChild(document.createElement("td")); // 金額
    } else {
      const t = item.obj;
      if (t.isCancel) tr.className = "cancel";
      const noTd = document.createElement("td");
      const flags = t._ocrFlags || {};
      if (flags["No"]) noTd.classList.add("low-confidence");
      noTd.textContent = t.isCharter && t.no != null
        ? "貸" + t.no
        : t.no == null
          ? t.isCancel ? "キ" : ""
          : t.no;
      tr.appendChild(noTd);
      tr.appendChild(cell(t, "boardTime", { flagKey: "乗車" }));
      tr.appendChild(cell(t, "alightTime", { flagKey: "降車" }));
      tr.appendChild(cell(t, "pickupKind", { flagKey: "迎" }));
      tr.appendChild(cell(t, "boardPlace", { flagKey: "乗車地" }));
      tr.appendChild(cell(t, "alightPlace", { flagKey: "降車地" }));
      tr.appendChild(cell(t, "km", { type: "number", step: "0.1", flagKey: "営Km" }));
      tr.appendChild(cell(t, "amount", { type: "number", flagKey: "合計" }));
    }
    tbl.appendChild(tr);
  }

  wrap.appendChild(tbl);
  reviewEl.appendChild(wrap);
  updateSummary();
  importBtn.style.display = "";
}

// レビュー結果を sessionStorage に置いて input.html へ引き渡す。
// _ocrFlags はレビュー表専用のメタ情報なので保存前に剥がす。
importBtn.addEventListener("click", () => {
  if (!reviewData) return;
  const strip = (o) => {
    const c = { ...o };
    delete c._ocrFlags;
    return c;
  };
  const payload = {
    trips: reviewData.trips.map(strip),
    rests: reviewData.rests.map(strip),
    ts: Date.now(),
  };
  sessionStorage.setItem("ocrImport", JSON.stringify(payload));
  location.href = "input.html";
});

input.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  reviewEl.innerHTML = "";
  importBtn.style.display = "none";
  reviewData = null;

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
      // OCRは走ったが明細行を1つも復元できなかった → 空の表を出さず撮り直しを促す
      statusEl.textContent = "明細を読み取れませんでした。明るい場所で、営業明細の全体が入るように撮り直してください。";
      return;
    }
    reviewData = { trips, rests };
    statusEl.textContent = `読み取り完了: 乗車 ${trips.length}件 ・ 休憩 ${rests.length}回`;
    renderReview(trips, rests);
  } catch (err) {
    statusEl.textContent = "エラー: " + ((err && err.message) || err);
  }
});
