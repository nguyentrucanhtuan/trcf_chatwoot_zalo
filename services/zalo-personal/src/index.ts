// Service Zalo cá nhân: đăng nhập bằng QR qua zca-js (không chính thức), mỗi tài khoản một API inbox.
import { logger, registerChannel, runBridge } from "@trcf/bridge-core";
import { AccountManager } from "./zalo/account-manager.js";
import { snapshotCredentials } from "./zalo/credentials.js";
import { QrLoginManager } from "./zalo/qr-login.js";

await runBridge({
  name: "zalo-personal",
  card: {
    id: "zalo-personal",
    title: "Zalo",
    description: "Kết nối tài khoản Zalo cá nhân bằng mã QR",
    iconText: "Zalo",
  },
  ui: {
    title: "Tài khoản Zalo cá nhân",
    subtitle: "Mỗi tài khoản Zalo là một inbox trên Chatwoot.",
    addLabel: "+ Thêm tài khoản Zalo",
    emptyText: "Chưa có tài khoản nào. Bấm “Thêm tài khoản Zalo” để quét QR.",
    dialogTitle: "Quét mã bằng app Zalo",
    dialogHint: "Mở Zalo trên điện thoại → biểu tượng quét QR → quét mã bên dưới.",
    retryLabel: "Tạo mã mới",
    relinkLabel: "Quét QR lại",
    statusLabels: {
      online: "Đang hoạt động",
      connecting: "Đang kết nối",
      offline: "Mất kết nối, đang thử lại",
      duplicate_connection: "Bị ngắt do mở Zalo Web nơi khác",
      needs_relogin: "Cần quét QR lại",
    },
    stateText: {
      starting: "Đang tạo mã QR...",
      waiting_scan: "Đang chờ quét mã. Mã hết hạn sau khoảng 100 giây.",
      waiting_confirm: "Đã quét. Bấm “Đăng nhập” trên điện thoại để xác nhận.",
      expired: "Mã QR đã hết hạn.",
      declined: "Đăng nhập bị từ chối trên điện thoại.",
      cancelled: "Đã hủy.",
    },
  },
  createConnector: ({ onInbound }) => new AccountManager(onInbound, logger),
  createConnectSessions: ({ chatwoot, connector }) =>
    new QrLoginManager(async ({ api, displayName }) => {
      const externalId = api.getOwnId();
      const { key, created, inboxId } = await registerChannel(chatwoot, {
        kind: "zalo_personal",
        externalId,
        displayName: displayName ?? externalId,
        credentials: snapshotCredentials(api),
      });
      // Kết nối ngay, không cần khởi động lại service.
      await connector.connect(key);
      logger.info({ channel: key, created }, created ? "Đã thêm tài khoản Zalo" : "Đã đăng nhập lại tài khoản Zalo");
      return { externalId, inboxId, created };
    }, logger),
});
