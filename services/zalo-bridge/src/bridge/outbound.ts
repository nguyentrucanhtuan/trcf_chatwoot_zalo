import { ThreadType } from "zca-js";
import type { ChatwootClient } from "../chatwoot/client.js";
import type { MessageCreatedPayload } from "../chatwoot/webhook.js";
import type { Logger } from "../logger.js";
import { findThreadByConversation } from "../store/repo.js";
import type { ZaloAccount } from "../store/schema.js";
import type { AccountManager } from "../zalo/account-manager.js";
import { KeyedQueue } from "./keyed-queue.js";

/**
 * Chatwoot → Zalo: gửi tin `outgoing` (của nhân viên hoặc bot) sang Zalo, rồi cập nhật trạng thái
 * tin trên Chatwoot. Chatwoot không gửi lại webhook lỗi nên mọi lỗi phải được đánh dấu `failed`.
 */
export function createOutboundHandler(chatwoot: ChatwootClient, accounts: AccountManager, log: Logger) {
  const queue = new KeyedQueue();

  async function deliver(account: ZaloAccount, payload: MessageCreatedPayload): Promise<void> {
    const conversationId = payload.conversation.id;
    const fail = (reason: string) => chatwoot.updateMessageStatus(conversationId, payload.id, "failed", reason);

    const thread = await findThreadByConversation(conversationId);
    if (!thread || thread.ownId !== account.ownId) return fail("Không tìm thấy cuộc chat Zalo tương ứng");

    const api = accounts.getApi(account.ownId);
    if (!api) return fail("Tài khoản Zalo đang offline");

    if (payload.attachments?.length) return fail("Bridge chưa hỗ trợ gửi file/ảnh sang Zalo");

    const content = payload.content?.trim();
    if (!content) return;

    const threadType = thread.threadType === ThreadType.Group ? ThreadType.Group : ThreadType.User;
    try {
      await api.sendMessage(content, thread.threadId, threadType);
    } catch (err) {
      log.warn({ err, ownId: account.ownId, conversationId }, "Gửi tin sang Zalo thất bại");
      return fail(`Zalo từ chối: ${err instanceof Error ? err.message : String(err)}`);
    }
    await chatwoot.updateMessageStatus(conversationId, payload.id, "delivered");
  }

  return (account: ZaloAccount, payload: MessageCreatedPayload): void => {
    if (payload.message_type !== "outgoing" || payload.private) return;
    queue
      .run(`conv:${payload.conversation.id}`, () => deliver(account, payload))
      .catch((err) =>
        log.error(
          { err, ownId: account.ownId, conversationId: payload.conversation.id, messageId: payload.id },
          "Không xử lý được tin outgoing",
        ),
      );
  };
}
