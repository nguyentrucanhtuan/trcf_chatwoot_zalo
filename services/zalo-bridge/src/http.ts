import { Hono } from "hono";
import { chatwootDashboardScript } from "./admin/chatwoot-script.js";
import { createAdminRoutes } from "./admin/routes.js";
import { MessageCreatedPayload, verifySignature } from "./chatwoot/webhook.js";
import type { Logger } from "./logger.js";
import { getAccount } from "./store/repo.js";
import type { ZaloAccount } from "./store/schema.js";
import type { AccountManager } from "./zalo/account-manager.js";
import type { QrLoginManager } from "./zalo/qr-login.js";

export function createHttpApp(deps: {
  accounts: AccountManager;
  qrLogins: QrLoginManager;
  onOutgoing: (account: ZaloAccount, payload: MessageCreatedPayload) => void;
  log: Logger;
}) {
  const app = new Hono();

  // Công khai nên chỉ trả số lượng, không lộ tên/ID tài khoản (chi tiết xem ở /admin).
  app.get("/health", (c) => {
    const statuses = deps.accounts.statuses();
    return c.json({
      ok: true,
      accounts: statuses.length,
      online: statuses.filter((s) => s.status === "online").length,
    });
  });

  app.route("/admin", createAdminRoutes(deps));

  // Nạp vào Chatwoot qua DASHBOARD_SCRIPTS. Công khai (chỉ là code giao diện, không chứa dữ liệu).
  app.get("/chatwoot/zalo-channel.js", (c) =>
    c.body(chatwootDashboardScript, 200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache",
    }),
  );

  // Callback URL của API inbox: mỗi tài khoản Zalo một URL, ký bằng secret của inbox đó.
  app.post("/webhooks/chatwoot/:ownId", async (c) => {
    const account = await getAccount(c.req.param("ownId"));
    if (!account) return c.text("unknown account", 404);

    const rawBody = await c.req.text();
    const ok = verifySignature(
      account.webhookSecret,
      c.req.header("x-chatwoot-timestamp"),
      c.req.header("x-chatwoot-signature"),
      rawBody,
    );
    if (!ok) {
      deps.log.warn({ ownId: account.ownId }, "Webhook sai chữ ký");
      return c.text("invalid signature", 401);
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return c.text("invalid json", 400);
    }
    // Các event khác (conversation_updated, message_updated...) chưa dùng.
    const parsed = MessageCreatedPayload.safeParse(json);
    if (!parsed.success) return c.body(null, 204);
    if (parsed.data.inbox.id !== account.chatwootInboxId) return c.text("inbox mismatch", 400);

    // Trả lời ngay (timeout webhook của Chatwoot là 5s), gửi Zalo chạy nền.
    deps.onOutgoing(account, parsed.data);
    return c.body(null, 204);
  });

  return app;
}
