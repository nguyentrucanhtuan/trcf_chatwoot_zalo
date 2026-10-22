import type { ChannelConnector } from "../channels/types.js";
import type { ChatwootClient } from "../chatwoot/client.js";
import type { Logger } from "../logger.js";
import { listChannels } from "../store/repo.js";

const SYNC_INTERVAL_MS = 60_000;

/**
 * Xóa inbox Zalo trên Chatwoot = gỡ channel khỏi bridge (giống ngắt kết nối kênh Facebook).
 * Chatwoot không có webhook `inbox_deleted` nên đối chiếu định kỳ với danh sách inbox.
 * Contact trên Chatwoot được giữ nguyên (dữ liệu khách hàng dùng chung).
 */
export async function syncDeletedInboxes(chatwoot: ChatwootClient, connector: ChannelConnector, log: Logger) {
  // Mỗi service có database riêng nên chỉ thấy channel của chính nó.
  // Đọc channel TRƯỚC khi lấy danh sách inbox: channel mới luôn được tạo inbox trước khi ghi DB,
  // nên sẽ không bị coi nhầm là mất inbox.
  const known = await listChannels();
  if (known.length === 0) return;

  let inboxIds: Set<number>;
  try {
    inboxIds = new Set(await chatwoot.listInboxIds());
  } catch (err) {
    // Không chắc inbox còn hay mất thì không xóa gì.
    log.warn({ err }, "Không lấy được danh sách inbox Chatwoot, bỏ qua lần đối chiếu này");
    return;
  }

  for (const channel of known) {
    if (inboxIds.has(channel.chatwootInboxId)) continue;
    log.warn(
      { channel: channel.key, inboxId: channel.chatwootInboxId },
      `Inbox #${channel.chatwootInboxId} đã bị xóa trên Chatwoot, gỡ "${channel.displayName}" khỏi bridge`,
    );
    await connector.remove(channel.key);
  }
}

export function startInboxSync(chatwoot: ChatwootClient, connector: ChannelConnector, log: Logger): () => void {
  const timer = setInterval(() => {
    syncDeletedInboxes(chatwoot, connector, log).catch((err) => log.error({ err }, "Đối chiếu inbox thất bại"));
  }, SYNC_INTERVAL_MS);
  return () => clearInterval(timer);
}
