// build-ocr.mjs — OCR機能（前処理＋PP-OCR）を1ファイルにバンドルする。
// アプリ本体は素のscript読込のまま。OCR機能だけ esbuild で束ねる。
import { build } from "esbuild";

await build({
  entryPoints: ["js/ocr/src/index.js"],
  bundle: true,
  format: "esm",
  outfile: "js/ocr/ocr-bundle.js",
  platform: "browser",
  target: "es2020",
  // wasm（onnxruntime-web / OpenCV.js）はバンドルに含めず別ファイルとして出す。
  // 実際の挙動を見て loader/external/assetNames を調整する。
  loader: { ".wasm": "file" },
  assetNames: "vendor/[name]-[hash]",
  // @techstark/opencv-js（Emscripten）が参照する Node 組込みを空スタブへ。
  // ブラウザでは ENVIRONMENT_IS_NODE 経路は実行されないため安全。
  alias: {
    fs: "./js/ocr/src/node-builtin-stub.js",
    path: "./js/ocr/src/node-builtin-stub.js",
    crypto: "./js/ocr/src/node-builtin-stub.js",
    os: "./js/ocr/src/node-builtin-stub.js",
  },
  logLevel: "info",
});

console.log("built: js/ocr/ocr-bundle.js");
