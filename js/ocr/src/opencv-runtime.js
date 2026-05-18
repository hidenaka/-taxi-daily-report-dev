// js/ocr/src/opencv-runtime.js
// ppu-ocv の web ビルドは OpenCV を自前ロードしない（Node ビルドのみ自動連携）。
// そのため @techstark/opencv-js を読み込み、cv-provider が参照する globalThis.cv に登録する。
// ImageProcessor.initRuntime() はこの cv の onRuntimeInitialized を待つだけ。
import _cv from "@techstark/opencv-js";

if (typeof globalThis !== "undefined" && !globalThis.cv) {
  globalThis.cv = _cv;
}
