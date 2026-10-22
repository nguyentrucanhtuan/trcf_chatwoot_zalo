import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import type { ChannelCard } from "./admin/channel-card-script.js";
import type { AdminUi } from "./admin/page.js";
import { createInboundHandler } from "./bridge/inbound.js";
import { startInboxSync, syncDeletedInboxes } from "./bridge/inbox-sync.js";
import { createOutboundHandler } from "./bridge/outbound.js";
import type { ChannelConnector, ConnectSessions, OnInboundMessage } from "./channels/types.js";
import { ChatwootClient } from "./chatwoot/client.js";
import { config } from "./config.js";
import { createHttpApp } from "./http.js";
import { logger } from "./logger.js";
import { migrateDb, sql } from "./store/db.js";

export type BridgeContext = {
  chatwoot: ChatwootClient;
  onInbound: OnInboundMessage;
};

/** Khởi động một service bridge: migrate DB, HTTP server, kết nối channel, đối chiếu inbox, tắt gọn gàng. */
export async function runBridge<C extends ChannelConnector, S extends ConnectSessions>(service: {
  name: string;
  ui: AdminUi;
  card: ChannelCard;
  createConnector(ctx: BridgeContext): C;
  createConnectSessions(ctx: BridgeContext & { connector: C }): S;
  /** Route riêng của service (VD webhook/OAuth của Zalo OA). */
  extendApp?(app: Hono, ctx: BridgeContext & { connector: C; connectSessions: S }): void;
}): Promise<void> {
  await migrateDb();

  const chatwoot = new ChatwootClient(config.CHATWOOT_BASE_URL, config.CHATWOOT_ACCOUNT_ID, config.CHATWOOT_API_TOKEN);
  const ctx: BridgeContext = { chatwoot, onInbound: createInboundHandler(chatwoot, logger) };
  const connector = service.createConnector(ctx);
  const connectSessions = service.createConnectSessions({ ...ctx, connector });

  const app = createHttpApp({
    connector,
    connectSessions,
    ui: service.ui,
    card: service.card,
    onOutgoing: createOutboundHandler(chatwoot, connector, logger),
    log: logger,
  });
  service.extendApp?.(app, { ...ctx, connector, connectSessions });

  const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) =>
    logger.info(`${service.name} lắng nghe tại http://${info.address}:${info.port} (quản trị: /admin)`),
  );

  // Gỡ các channel có inbox đã bị xóa trên Chatwoot trước khi kết nối.
  await syncDeletedInboxes(chatwoot, connector, logger).catch((err) => logger.error({ err }, "Đối chiếu inbox thất bại"));
  await connector.startAll();
  const stopInboxSync = startInboxSync(chatwoot, connector, logger);
  if (connector.statuses().length === 0) {
    logger.warn(`Chưa có kênh nào. Thêm trong Chatwoot: Settings → Inboxes → Add Inbox → "${service.card.title}".`);
  }

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, `Đang tắt ${service.name}`);
    stopInboxSync();
    await connector.stopAll();
    server.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  }
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
