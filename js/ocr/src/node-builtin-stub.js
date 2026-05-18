// js/ocr/src/node-builtin-stub.js
// ブラウザ向けバンドル用の空スタブ。
// @techstark/opencv-js（Emscripten出力）は Node 組込みの fs/path 等を参照するが、
// それらは ENVIRONMENT_IS_NODE のコードパスでしか使われない。ブラウザでは実行されないため、
// esbuild の alias でこの空モジュールに差し替える。
export default {};
