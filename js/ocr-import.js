// js/ocr-import.js
// 写真取り込み画面のUIグルー。画像選択 → ブレ判定 → 前処理＋PP-OCR →
// 編集レビュー表表示 →「日報に取り込む」で input.html へ引き渡し。
// 認識ロジックは js/ocr/ocr-bundle.js（Phase 1B-1）に委譲する。
//
// バンドル（OCRエンジン）はサイズが大きいため、ページ表示時には読み込まない。
// 静的importにするとページを開いた瞬間にバンドル全体がロード・初期化され、
// iOS Safari がメモリ不足でクラッシュする。画像が選ばれた時に初めて
// 動的import()で読み込み、結果はモジュールキャッシュで使い回す。
let ocrModulePromise = null;
function loadOcr() {
  if (!ocrModulePromise) {
    ocrModulePromise = import("./ocr/ocr-bundle.js");
  }
  return ocrModulePromise;
}

const input = document.getElementById("imageInput");
const statusEl = document.getElementById("ocrStatus");
const reviewEl = document.getElementById("ocrReview");
const importBtn = document.getElementById("importBtn");

// 現在レビュー中のデータ（編集はこのオブジェクトに即時反映される）。
let reviewData = null;

// ── 解析の進捗ダイアグ ───────────────────────────────────────────
// iOS Safari はメモリ不足だとタブごとクラッシュし JS エラーを捕捉できない。
// そこで各処理段階を localStorage に逐次保存し、リロード後に「どこまで
// 進んで落ちたか」を確認できるようにする（クラッシュ箇所の特定用）。
const DIAG_KEY = "ocrDiag";
const STAGE_LABEL = {
  bundle: "解析エンジンを読み込み中…",
  blur: "画像を確認中…",
  preprocess: "画像を前処理中…",
  "model-load": "OCRモデルを読み込み中…（初回はダウンロードに時間がかかります）",
  recognize: "文字を検出・認識中…",
  reconstruct: "表を組み立て中…",
};
function diag(stage, extra) {
  try {
    localStorage.setItem(
      DIAG_KEY,
      JSON.stringify({ stage, extra: extra || null, at: Date.now() })
    );
  } catch (_) {}
  if (STAGE_LABEL[stage]) statusEl.textContent = STAGE_LABEL[stage];
}

// 前回の解析が完了しなかった（＝クラッシュした可能性）場合、停止段階を表示する。
(function showPriorDiag() {
  try {
    const raw = localStorage.getItem(DIAG_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (!d || d.stage === "done") return;
    const msg =
      d.stage === "error"
        ? "前回はエラーで停止しました：" + (d.extra || "")
        : "前回の解析は「" + (STAGE_LABEL[d.stage] || d.stage) + "」の段階で中断しました。";
    statusEl.innerHTML =
      '<div style="background:#fff3e0;border:1px solid #ffb74d;padding:8px 10px;' +
      'border-radius:6px;font-size:12px;line-height:1.5;">' +
      msg +
      "<br>もう一度「画像を選ぶ」から試してください。</div>";
  } catch (_) {}
})();

// 選択ファイルを canvas に描画する。
async function fileToCanvas(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  return canvas;
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
  });
  td.appendChild(inp);
  return td;
}

// rowsToDrive の結果（trips/rests）を編集可能なレビュー表として描画する。
// 1行 = 1 trip。休憩行も時系列に混ぜ、種別が分かるように表示する。
function renderReview(trips, rests) {
  reviewEl.innerHTML = "";

  const hint = document.createElement("p");
  hint.className = "review-hint";
  hint.textContent =
    "黄色のセルは読み取りの確度が低い箇所です。確認・修正してから取り込んでください。";
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
  all.sort((a, b) => {
    const ta = a.obj.boardTime || a.obj.startTime || "";
    const tb = b.obj.boardTime || b.obj.startTime || "";
    return String(ta).localeCompare(String(tb));
  });

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
  window.__ocrImportResult = null;
  window.__ocrImportError = null;
  window.__ocrImportDone = false;

  try {
    diag("bundle");
    const { recognizeReport, checkBlur, rowsToDrive } = await loadOcr();

    diag("blur");
    const canvas = await fileToCanvas(file);

    const blur = await checkBlur(canvas);
    if (blur.blurry) {
      diag("done");
      statusEl.textContent = "写真が不鮮明です。明るい場所で、営業明細の全体が入るように撮り直してください。";
      return;
    }

    // recognizeReport が各段階（preprocess/model-load/recognize/reconstruct）を
    // diag に通知する。クラッシュしてもどこまで進んだかが localStorage に残る。
    const result = await recognizeReport(canvas, diag);
    diag("done");
    window.__ocrImportResult = result;

    const { trips, rests } = rowsToDrive(result.rows);
    if (trips.length === 0 && rests.length === 0) {
      // OCRは走ったが明細行を1つも復元できなかった → 空の表を出さず撮り直しを促す
      statusEl.textContent = "明細を読み取れませんでした。明るい場所で、営業明細の全体が入るように撮り直してください。";
      return;
    }
    reviewData = { trips, rests };
    statusEl.textContent = `読み取り完了: 乗車 ${trips.length}件 ・ 休憩 ${rests.length}回`;
    renderReview(trips, rests);
  } catch (err) {
    window.__ocrImportError = String((err && err.stack) || err);
    diag("error", (err && err.message) || String(err));
    statusEl.textContent = "エラー: " + ((err && err.message) || err);
  } finally {
    window.__ocrImportDone = true;
  }
});
