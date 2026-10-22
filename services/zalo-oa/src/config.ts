import { parseEnv } from "@trcf/bridge-core";
import { z } from "zod";

const OaEnv = z.object({
  // App trên developers.zalo.me đã được OA cấp quyền. Một app phục vụ được nhiều OA.
  ZALO_APP_ID: z.string().min(1),
  // "Khóa bí mật của ứng dụng" (App → Cài đặt), gửi trong header `secret_key` khi lấy token.
  ZALO_APP_SECRET: z.string().min(1),
  // "OA Secret Key" ở màn hình Webhook của app, dùng xác minh chữ ký X-ZEvent-Signature.
  ZALO_OA_SECRET_KEY: z.string().min(1),
  // URL HTTPS công khai của service (Zalo gọi webhook và redirect OAuth về đây). Dev: dùng tunnel.
  BRIDGE_EXTERNAL_URL: z.url(),
});

const env = parseEnv(OaEnv);

export const oaConfig = {
  appId: env.ZALO_APP_ID,
  appSecret: env.ZALO_APP_SECRET,
  oaSecretKey: env.ZALO_OA_SECRET_KEY,
  externalUrl: env.BRIDGE_EXTERNAL_URL.replace(/\/$/, ""),
  /** Phải khai báo đúng URL này ở mục Official Account → Callback URL của app. */
  get callbackUrl() {
    return `${this.externalUrl}/zalo-oa/callback`;
  },
  /** Khai báo URL này ở mục Webhook của app. */
  get webhookUrl() {
    return `${this.externalUrl}/zalo-oa/webhook`;
  },
};
