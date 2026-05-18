// js/ocr-worker.js
// 使い捨てiframe（ocr-worker.html）の中身。
//
// 親ページ（ocr-import.js）から帯画像を1枚受け取り、OCRして box を返す。
// このiframeは1帯ごとに生成・破棄される。iframeを破棄すると realm ごと
// 解放されるため、onnxruntime のWASMメモリが帯をまたいで蓄積しない
// （iOS Safari が複数帯の連続処理でクラッシュする問題への対策）。
import { recognizeStrip } from "./ocr/ocr-bundle.js";

const ORIGIN = location.origin;

window.addEventListener("message", async (e) => {
  if (e.origin !== ORIGIN) return;
  const msg = e.data || {};
  if (msg.type !== "ocr-strip") return;
  try {
    const { boxes } = await recognizeStrip(msg.bitmap);
    parent.postMessage({ type: "ocr-result", index: msg.index, boxes }, ORIGIN);
  } catch (err) {
    parent.postMessage(
      { type: "ocr-error", index: msg.index, error: String((err && err.message) || err) },
      ORIGIN
    );
  }
});

// バンドル（recognizeStrip）の読み込みが済んだので親に準備完了を通知する。
// 静的importはモジュール本体の実行前に解決済みのため、ここで通知して安全。
parent.postMessage({ type: "ocr-ready" }, ORIGIN);
