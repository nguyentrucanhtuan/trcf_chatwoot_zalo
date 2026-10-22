// Service Zalo OA: Open API chính thức (OAuth v4 + webhook), mỗi OA một API inbox.
import { logger, registerChannel, runBridge } from "@trcf/bridge-core";
import { oaConfig } from "./config.js";
import { OaManager } from "./oa/oa-manager.js";
import { OaConnectSessions } from "./oa/oauth.js";
import { createOaRoutes } from "./oa/routes.js";

await runBridge({
  name: "zalo-oa",
  card: {
    id: "zalo-oa",
    title: "Zalo OA",
    description: "Kết nối Zalo Official Account qua API chính thức",
    iconText: "OA",
  },
  ui: {
    title: "Zalo Official Account",
    subtitle: "Mỗi OA là một inbox trên Chatwoot.",
    addLabel: "+ Kết nối Zalo OA",
    emptyText: "Chưa có OA nào. Bấm “Kết nối Zalo OA” để cấp quyền.",
    dialogTitle: "Cấp quyền Zalo OA",
    dialogHint: "Đăng nhập Zalo bằng tài khoản quản trị OA, chọn OA rồi bấm “Cho phép”.",
    retryLabel: "Thử lại",
    relinkLabel: "Cấp quyền lại",
    statusLabels: {
      online: "Đang hoạt động",
      connecting: "Đang kết nối",
      offline: "Mất kết nối",
      duplicate_connection: "Bị ngắt kết nối",
      needs_relogin: "Token hết hạn, cần cấp quyền lại",
    },
    stateText: {
      starting: "Đang chuẩn bị...",
      waiting_authorize: "Bấm nút trên để mở trang cấp quyền của Zalo. Cửa sổ này sẽ tự cập nhật khi xong.",
      connecting: "Đang kết nối OA...",
      expired: "Phiên cấp quyền đã hết hạn (10 phút).",
      cancelled: "Đã hủy.",
    },
  },
  createConnector: ({ onInbound }) => new OaManager(onInbound, logger),
  createConnectSessions: ({ chatwoot, connector }) =>
    new OaConnectSessions(async ({ oaId, name, tokens }) => {
      const { key, created, inboxId } = await registerChannel(chatwoot, {
        kind: "zalo_oa",
        externalId: oaId,
        displayName: name,
        credentials: tokens,
      });
      await connector.connect(key);
      logger.info({ channel: key, created }, created ? "Đã thêm Zalo OA" : "Đã cấp quyền lại Zalo OA");
      return { inboxId, created };
    }, logger),
  extendApp: (app, { connector, connectSessions }) => {
    app.route("/zalo-oa", createOaRoutes({ oa: connector, connectSessions, log: logger }));
    logger.info(
      { callbackUrl: oaConfig.callbackUrl, webhookUrl: oaConfig.webhookUrl },
      "Khai báo Callback URL và Webhook URL này trong app trên developers.zalo.me",
    );
  },
});
