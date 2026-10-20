import { Hono } from "hono";
import type { Logger } from "../logger.js";
import type { AccountManager } from "../zalo/account-manager.js";
import type { QrLoginManager } from "../zalo/qr-login.js";
import { chatwootAdminAuth, type AdminUser } from "./auth.js";
import { adminPage } from "./page.js";

/**
 * Trang quản trị tài khoản Zalo. Đăng nhập bằng phiên Chatwoot (Administrator), dùng trực tiếp
 * hoặc nhúng vào Chatwoot làm Dashboard App.
 */
export function createAdminRoutes(deps: { accounts: AccountManager; qrLogins: QrLoginManager; log: Logger }) {
  const admin = new Hono<{ Variables: { adminUser: AdminUser } }>();
  admin.use(chatwootAdminAuth(deps.log));

  admin.get("/", (c) => c.html(adminPage));

  admin.get("/api/me", (c) => c.json(c.get("adminUser")));

  admin.get("/api/accounts", (c) => c.json(deps.accounts.statuses()));

  admin.post("/api/accounts/:ownId/reconnect", async (c) => {
    const ownId = c.req.param("ownId");
    try {
      await deps.accounts.connectAccount(ownId);
      return c.json({ ok: true });
    } catch (err) {
      deps.log.warn({ err, ownId }, "Kết nối lại tài khoản thất bại");
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  admin.post("/api/qr-logins", (c) => {
    deps.log.info({ by: c.get("adminUser") }, "Bắt đầu đăng nhập Zalo bằng QR");
    return c.json(deps.qrLogins.start());
  });

  admin.get("/api/qr-logins/:id", (c) => {
    const view = deps.qrLogins.get(c.req.param("id"));
    return view ? c.json(view) : c.json({ error: "not found" }, 404);
  });

  admin.post("/api/qr-logins/:id/cancel", (c) => {
    deps.qrLogins.cancel(c.req.param("id"));
    return c.json({ ok: true });
  });

  return admin;
}
