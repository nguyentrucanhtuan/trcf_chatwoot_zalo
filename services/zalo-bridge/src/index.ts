import { serve } from "@hono/node-server";
import { createInboundHandler } from "./bridge/inbound.js";
import { startInboxSync, syncDeletedInboxes } from "./bridge/inbox-sync.js";
import { createOutboundHandler } from "./bridge/outbound.js";
import { ChatwootClient } from "./chatwoot/client.js";
import { config } from "./config.js";
import { createHttpApp } from "./http.js";
import { logger } from "./logger.js";
import { migrateDb, sql } from "./store/db.js";
import { AccountManager } from "./zalo/account-manager.js";
import { snapshotCredentials } from "./zalo/credentials.js";
import { QrLoginManager } from "./zalo/qr-login.js";
import { registerZaloAccount } from "./zalo/register.js";

await migrateDb();

const chatwoot = new ChatwootClient(config.CHATWOOT_BASE_URL, config.CHATWOOT_ACCOUNT_ID, config.CHATWOOT_API_TOKEN);
const accounts = new AccountManager(createInboundHandler(chatwoot, logger), logger);
const qrLogins = new QrLoginManager(async ({ api, displayName }) => {
  const ownId = api.getOwnId();
  const { created, inboxId } = await registerZaloAccount(chatwoot, {
    ownId,
    displayName: displayName ?? ownId,
    credentials: snapshotCredentials(api),
  });
  // Kết nối ngay, không cần khởi động lại bridge.
  await accounts.connectAccount(ownId);
  logger.info({ ownId, created }, created ? "Đã thêm tài khoản Zalo" : "Đã đăng nhập lại tài khoản Zalo");
  return { ownId, inboxId, created };
}, logger);
const app = createHttpApp({
  accounts,
  qrLogins,
  onOutgoing: createOutboundHandler(chatwoot, accounts, logger),
  log: logger,
});

const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) =>
  logger.info(`zalo-bridge lắng nghe tại http://${info.address}:${info.port} (quản trị: /admin)`),
);

// Gỡ các tài khoản có inbox đã bị xóa trên Chatwoot trước khi kết nối.
await syncDeletedInboxes(chatwoot, accounts, logger).catch((err) => logger.error({ err }, "Đối chiếu inbox thất bại"));
await accounts.startAll();
const stopInboxSync = startInboxSync(chatwoot, accounts, logger);
if (accounts.statuses().length === 0) logger.warn("Chưa có tài khoản Zalo nào. Mở /admin để quét QR thêm tài khoản.");

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Đang tắt zalo-bridge");
  stopInboxSync();
  await accounts.stopAll();
  server.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
