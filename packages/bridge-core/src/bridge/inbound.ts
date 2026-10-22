import type { InboundMessage } from "../channels/types.js";
import { ChatwootError, type ChatwootClient } from "../chatwoot/client.js";
import type { Logger } from "../logger.js";
import { findThread, upsertThread } from "../store/repo.js";
import type { Channel, Thread } from "../store/schema.js";
import { KeyedQueue } from "./keyed-queue.js";

/** Zalo (cá nhân hoặc OA) → Chatwoot: mỗi tin thành một tin `incoming` trong conversation tương ứng. */
export function createInboundHandler(chatwoot: ChatwootClient, log: Logger) {
  const queue = new KeyedQueue();

  async function createThread(channel: Channel, message: InboundMessage): Promise<Thread> {
    const identifier = `${channel.key}:${message.threadId}`;
    const name = message.resolveContactName
      ? await message.resolveContactName().catch((err) => {
          log.warn({ err, channel: channel.key, threadId: message.threadId }, "Không lấy được tên người dùng Zalo");
          return message.contactName;
        })
      : message.contactName;

    let contactId: number;
    let sourceId: string;
    try {
      ({ contactId, sourceId } = await chatwoot.createContact({
        inboxId: channel.chatwootInboxId,
        name,
        identifier,
      }));
    } catch (err) {
      // 422 = identifier đã tồn tại (VD DB của bridge bị reset): dùng lại contact cũ.
      if (!(err instanceof ChatwootError && err.status === 422)) throw err;
      const contact = await chatwoot.findContactByIdentifier(identifier);
      if (!contact) throw err;
      contactId = contact.id;
      sourceId =
        contact.contact_inboxes?.find((ci) => ci.inbox.id === channel.chatwootInboxId)?.source_id ??
        (await chatwoot.createContactInbox(contact.id, channel.chatwootInboxId));
    }

    const conversationId = await chatwoot.createConversation({
      inboxId: channel.chatwootInboxId,
      contactId,
      sourceId,
    });
    return upsertThread({
      channelKey: channel.key,
      threadId: message.threadId,
      threadType: message.threadType,
      chatwootContactId: contactId,
      chatwootSourceId: sourceId,
      chatwootConversationId: conversationId,
    });
  }

  async function forward(channel: Channel, message: InboundMessage): Promise<void> {
    const thread = (await findThread(channel.key, message.threadId)) ?? (await createThread(channel, message));
    const input = { content: message.content, sourceId: message.sourceId };
    try {
      await chatwoot.createIncomingMessage(thread.chatwootConversationId, input);
    } catch (err) {
      // Conversation bị xóa trên Chatwoot: tạo mới rồi gửi lại một lần.
      if (!(err instanceof ChatwootError && err.status === 404)) throw err;
      const fresh = await createThread(channel, message);
      await chatwoot.createIncomingMessage(fresh.chatwootConversationId, input);
    }
  }

  return (channel: Channel, message: InboundMessage): void => {
    queue
      .run(`${channel.key}:${message.threadId}`, () => forward(channel, message))
      .catch((err) =>
        log.error(
          { err, channel: channel.key, threadId: message.threadId, sourceId: message.sourceId },
          "Không chuyển được tin Zalo sang Chatwoot",
        ),
      );
  };
}
