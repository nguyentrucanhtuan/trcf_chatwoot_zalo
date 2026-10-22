import { Hono } from "hono";
import { renderChannelCardScript, type ChannelCard } from "./admin/channel-card-script.js";
import type { AdminUi } from "./admin/page.js";
import { createAdminRoutes } from "./admin/routes.js";
import type { ChannelConnector, ConnectSessions } from "./channels/types.js";
import { MessageCreatedPayload, verifySignature } from "./chatwoot/webhook.js";
import type { Logger } from "./logger.js";
import { getChannel } from "./store/repo.js";
import type { Channel } from "./store/schema.js";

export function createHttpApp(deps: {
  connector: ChannelConnector;
  connectSessions: ConnectSessions;
  ui: AdminUi;
  card: ChannelCard;
  onOutgoing: (channel: Channel, payload: MessageCreatedPayload) => void;
  log: Logger;
}) {
  const app = new Hono();

  // Công khai nên chỉ trả số lượng, không lộ tên/ID tài khoản (chi tiết xem ở /admin).
  app.get("/health", (c) => {
    const statuses = deps.connector.statuses();
    return c.json({
      ok: true,
      kind: deps.connector.kind,
      channels: statuses.length,
      online: statuses.filter((s) => s.status === "online").length,
    });
  });

  app.route("/admin", createAdminRoutes(deps));

  // Nạp vào Chatwoot qua DASHBOARD_SCRIPTS. Công khai (chỉ là code giao diện, không chứa dữ liệu).
  const cardScript = renderChannelCardScript(deps.card);
  app.get("/chatwoot/channel-card.js", (c) =>
    c.body(cardScript, 200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache",
    }),
  );

  // Callback URL của API inbox: mỗi channel một URL, ký bằng secret của inbox đó.
  app.post("/webhooks/chatwoot/:key", async (c) => {
    const channel = await getChannel(c.req.param("key"));
    if (!channel) return c.text("unknown channel", 404);

    const rawBody = await c.req.text();
    const ok = verifySignature(
      channel.webhookSecret,
      c.req.header("x-chatwoot-timestamp"),
      c.req.header("x-chatwoot-signature"),
      rawBody,
    );
    if (!ok) {
      deps.log.warn({ channel: channel.key }, "Webhook Chatwoot sai chữ ký");
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
    if (parsed.data.inbox.id !== channel.chatwootInboxId) return c.text("inbox mismatch", 400);

    // Trả lời ngay (timeout webhook của Chatwoot là 5s), gửi Zalo chạy nền.
    deps.onOutgoing(channel, parsed.data);
    return c.body(null, 204);
  });

  return app;
}
