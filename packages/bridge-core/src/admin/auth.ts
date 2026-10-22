import { createHash } from "node:crypto";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { config } from "../config.js";
import type { Logger } from "../logger.js";
import { loginRequiredPage } from "./page.js";

/**
 * Đăng nhập trang admin bằng phiên Chatwoot: dashboard Chatwoot lưu header devise_token_auth
 * (access-token, client, uid) trong cookie `cw_d_session_info`. Cookie gửi kèm được khi trang admin
 * cùng host với Chatwoot (dev: localhost; production: cùng domain qua reverse proxy), kể cả khi nhúng
 * làm Dashboard App. Chỉ user có role administrator trong account CHATWOOT_ACCOUNT_ID được vào.
 */

export type AdminUser = { id: number; name: string };
type AuthResult = { status: "ok"; user: AdminUser } | { status: "unauthenticated" } | { status: "forbidden" };

const SESSION_COOKIE = "cw_d_session_info";
const CACHE_TTL_MS = 60_000;
// Header tự đặt chỉ gửi được từ JS cùng origin (cross-origin cần CORS preflight) nên đủ chống CSRF cho POST.
const CSRF_HEADER = "x-requested-with";
const CSRF_VALUE = "zalo-admin";

const cache = new Map<string, { result: AuthResult; expires: number }>();

async function resolveSession(rawCookie: string, log: Logger): Promise<AuthResult> {
  let session: Record<string, unknown>;
  try {
    session = JSON.parse(rawCookie);
  } catch {
    return { status: "unauthenticated" };
  }
  const accessToken = session["access-token"];
  const client = session["client"];
  const uid = session["uid"];
  if (typeof accessToken !== "string" || typeof client !== "string" || typeof uid !== "string") {
    return { status: "unauthenticated" };
  }

  const key = createHash("sha256").update(`${accessToken}|${client}|${uid}`).digest("hex");
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;

  let result: AuthResult;
  try {
    const res = await fetch(`${config.CHATWOOT_BASE_URL}/api/v1/profile`, {
      headers: { "access-token": accessToken, client, uid },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) {
      result = { status: "unauthenticated" };
    } else if (!res.ok) {
      // Chatwoot lỗi tạm thời: không cache để lần sau thử lại.
      log.warn({ status: res.status }, "Không xác thực được phiên Chatwoot");
      return { status: "unauthenticated" };
    } else {
      const profile = (await res.json()) as { id: number; name: string; accounts?: { id: number; role: string }[] };
      const isAdmin = profile.accounts?.some((a) => a.id === config.CHATWOOT_ACCOUNT_ID && a.role === "administrator");
      result = isAdmin ? { status: "ok", user: { id: profile.id, name: profile.name } } : { status: "forbidden" };
    }
  } catch (err) {
    log.warn({ err }, "Không gọi được Chatwoot để xác thực");
    return { status: "unauthenticated" };
  }

  cache.set(key, { result, expires: Date.now() + CACHE_TTL_MS });
  return result;
}

export function chatwootAdminAuth(log: Logger) {
  return createMiddleware<{ Variables: { adminUser: AdminUser } }>(async (c, next) => {
    const rawCookie = getCookie(c, SESSION_COOKIE);
    const result = rawCookie ? await resolveSession(rawCookie, log) : ({ status: "unauthenticated" } as const);

    if (result.status !== "ok") {
      const isApi = c.req.path.includes("/api/");
      if (isApi) return c.json({ error: result.status }, result.status === "forbidden" ? 403 : 401);
      return c.html(loginRequiredPage(result.status), result.status === "forbidden" ? 403 : 401);
    }
    if (c.req.method !== "GET" && c.req.header(CSRF_HEADER) !== CSRF_VALUE) {
      return c.json({ error: "csrf" }, 403);
    }
    c.set("adminUser", result.user);
    await next();
  });
}
