import { z } from "zod";

/** Biến môi trường dùng chung cho mọi service bridge. Service tự khai báo thêm biến riêng của nó. */
const CoreEnv = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive(),
  // URL mà Chatwoot (trong Docker) dùng để gọi webhook về service này.
  BRIDGE_PUBLIC_URL: z.url(),
  CHATWOOT_BASE_URL: z.url(),
  // URL Chatwoot mà trình duyệt dùng (link đăng nhập, origin postMessage). Mặc định = CHATWOOT_BASE_URL.
  CHATWOOT_PUBLIC_URL: z.url().optional(),
  CHATWOOT_ACCOUNT_ID: z.coerce.number().int().positive(),
  CHATWOOT_API_TOKEN: z.string().min(1),
  // Mỗi service một database riêng (zalo_personal, zalo_oa).
  DATABASE_URL: z.string().min(1),
  CREDENTIALS_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "cần 32 byte dạng hex (openssl rand -hex 32)"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

/** Parse env theo schema; sai thì in lỗi dễ đọc rồi thoát. */
export function parseEnv<T extends z.ZodType>(schema: T): z.infer<T> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Cấu hình .env không hợp lệ:\n" + z.prettifyError(parsed.error));
    process.exit(1);
  }
  return parsed.data;
}

export const config = parseEnv(CoreEnv);

export const chatwootPublicUrl = (config.CHATWOOT_PUBLIC_URL ?? config.CHATWOOT_BASE_URL).replace(/\/$/, "");
