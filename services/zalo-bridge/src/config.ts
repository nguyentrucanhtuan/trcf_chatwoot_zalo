import { z } from "zod";

const Env = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3200),
  BRIDGE_PUBLIC_URL: z.url(),
  CHATWOOT_BASE_URL: z.url(),
  // URL Chatwoot mà trình duyệt dùng (link đăng nhập trên trang admin). Mặc định = CHATWOOT_BASE_URL.
  CHATWOOT_PUBLIC_URL: z.url().optional(),
  CHATWOOT_ACCOUNT_ID: z.coerce.number().int().positive(),
  CHATWOOT_API_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  CREDENTIALS_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "cần 32 byte dạng hex (openssl rand -hex 32)"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error("Cấu hình .env không hợp lệ:\n" + z.prettifyError(parsed.error));
  process.exit(1);
}

export const config = parsed.data;
