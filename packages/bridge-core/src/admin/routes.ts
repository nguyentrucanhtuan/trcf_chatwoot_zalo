import { Hono } from "hono";
import type { ChannelConnector, ConnectSessions } from "../channels/types.js";
import type { Logger } from "../logger.js";
import { chatwootAdminAuth, type AdminUser } from "./auth.js";
import { renderAdminPage, type AdminUi } from "./page.js";

/**
 * Trang quản trị channel của service. Đăng nhập bằng phiên Chatwoot (Administrator), dùng trực tiếp,
 * nhúng làm Dashboard App, hoặc mở dạng popup (?connect) từ thẻ kênh ở trang Add Inbox.
 */
export function createAdminRoutes(deps: {
  connector: ChannelConnector;
  connectSessions: ConnectSessions;
  ui: AdminUi;
  log: Logger;
}) {
  const admin = new Hono<{ Variables: { adminUser: AdminUser } }>();
  admin.use(chatwootAdminAuth(deps.log));
  const page = renderAdminPage(deps.ui);

  admin.get("/", (c) => c.html(page));

  admin.get("/api/me", (c) => c.json(c.get("adminUser")));

  admin.get("/api/accounts", (c) => c.json(deps.connector.statuses()));

  admin.post("/api/accounts/:key/reconnect", async (c) => {
    const key = c.req.param("key");
    try {
      await deps.connector.connect(key);
      return c.json({ ok: true });
    } catch (err) {
      deps.log.warn({ err, channel: key }, "Kết nối lại thất bại");
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  admin.post("/api/connect-sessions", (c) => {
    deps.log.info({ by: c.get("adminUser") }, "Bắt đầu kết nối kênh Zalo");
    return c.json(deps.connectSessions.start());
  });

  admin.get("/api/connect-sessions/:id", (c) => {
    const view = deps.connectSessions.get(c.req.param("id"));
    return view ? c.json(view) : c.json({ error: "not found" }, 404);
  });

  admin.post("/api/connect-sessions/:id/cancel", (c) => {
    deps.connectSessions.cancel(c.req.param("id"));
    return c.json({ ok: true });
  });

  return admin;
}
