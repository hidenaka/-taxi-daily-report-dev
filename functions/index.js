// functions/index.js
// 営業明細OCR Cloud Function。
// アプリから画像を受け取り、ログインを検証し、ユーザー別1日上限を確認した上で、
// サーバー上でOCR（PP-OCRv5）を実行し、日報データ（trips/rests）を返す。
//
// プライバシー: 画像はメモリ上でのみ処理する。ディスクに保存せず、ログにも出さない。
//               リクエスト終了でメモリごと破棄される。第三者AIにも渡さない。
import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { ocrReport } from "./src/pipeline.js";
import { consumeQuota } from "./src/quota.js";

initializeApp();

export const ocrReportFn = onRequest(
  // メモリ4GiB: 表OCRに加えヘッダーOCRで2つ目のPP-OCRサービスを使うため、
  // 2GiBでは実測ピーク約2.08GiBで僅かに超過しOOMした。余裕を持たせる。
  { memory: "4GiB", timeoutSeconds: 300, cors: true },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ error: "POST のみ対応しています" });
        return;
      }

      // 認証: Authorization: Bearer <Firebase IDトークン>
      const m = String(req.headers.authorization || "").match(/^Bearer (.+)$/);
      if (!m) {
        res.status(401).json({ error: "ログインが必要です" });
        return;
      }
      let uid;
      try {
        uid = (await getAuth().verifyIdToken(m[1])).uid;
      } catch {
        res.status(401).json({ error: "ログイン情報が無効です。再ログインしてください" });
        return;
      }

      // 利用上限（ユーザー別・1日）
      if (!(await consumeQuota(uid))) {
        res.status(429).json({ error: "本日の取り込み回数の上限に達しました" });
        return;
      }

      // 画像: リクエストボディの生バイト列。メモリ上のみ・保存もログ出力もしない。
      const imageBuffer = req.rawBody;
      if (!imageBuffer || imageBuffer.length === 0) {
        res.status(400).json({ error: "画像データがありません" });
        return;
      }

      const { trips, rests, header } = await ocrReport(imageBuffer);
      res.json({ trips, rests, header });
    } catch (e) {
      // 画像の内容はログに残さない。エラーの種別のみ記録する。
      console.error("ocrReportFn error:", (e && e.message) || e);
      res.status(500).json({ error: "解析に失敗しました。撮り直して再度お試しください" });
    }
  }
);
