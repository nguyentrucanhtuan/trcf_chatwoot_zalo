import type { ChannelConnector } from "../channels/types.js";
import type { ChatwootClient } from "../chatwoot/client.js";
import type { MessageCreatedPayload } from "../chatwoot/webhook.js";
import type { Logger } from "../logger.js";
import { findThreadByConversation } from "../store/repo.js";
import type { Channel } from "../store/schema.js";
import { KeyedQueue } from "./keyed-queue.js";

/**
 * Chatwoot → Zalo: gửi tin `outgoing` (của nhân viên hoặc bot) qua connector của channel, rồi cập nhật
 * trạng thái tin trên Chatwoot. Chatwoot không gửi lại webhook lỗi nên mọi lỗi phải được đánh dấu `failed`.
 */
export function createOutboundHandler(chatwoot: ChatwootClient, connector: ChannelConnector, log: Logger) {
  const queue = new KeyedQueue();

  async function deliver(channel: Channel, payload: MessageCreatedPayload): Promise<void> {
    const conversationId = payload.conversation.id;
    const fail = (reason: string) => chatwoot.updateMessageStatus(conversationId, payload.id, "failed", reason);

    const thread = await findThreadByConversation(conversationId);
    if (!thread || thread.channelKey !== channel.key) return fail("Không tìm thấy cuộc chat Zalo tương ứng");

    if (payload.attachments?.length) return fail("Bridge chưa hỗ trợ gửi file/ảnh sang Zalo");

    const content = payload.content?.trim();
    if (!content) return;

    try {
      await connector.sendText(channel, thread, content);
    } catch (err) {
      log.warn({ err, channel: channel.key, conversationId }, "Gửi tin sang Zalo thất bại");
      return fail(err instanceof Error ? err.message : String(err));
    }
    await chatwoot.updateMessageStatus(conversationId, payload.id, "delivered");
  }

  return (channel: Channel, payload: MessageCreatedPayload): void => {
    if (payload.message_type !== "outgoing" || payload.private) return;
    queue
      .run(`conv:${payload.conversation.id}`, () => deliver(channel, payload))
      .catch((err) =>
        log.error(
          { err, channel: channel.key, conversationId: payload.conversation.id, messageId: payload.id },
          "Không xử lý được tin outgoing",
        ),
      );
  };
}
