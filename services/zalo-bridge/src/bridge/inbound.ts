import { ThreadType, type Message, type TMessage } from "zca-js";
import { ChatwootError, type ChatwootClient } from "../chatwoot/client.js";
import type { Logger } from "../logger.js";
import { findThread, upsertThread } from "../store/repo.js";
import type { Thread, ZaloAccount } from "../store/schema.js";
import { KeyedQueue } from "./keyed-queue.js";

// Nhãn cho tin không phải văn bản. Ảnh/file/nhóm sẽ xử lý đầy đủ ở bước "Ảnh, file và nhóm".
const MSG_TYPE_LABELS: Record<string, string> = {
  "chat.photo": "Ảnh",
  "chat.sticker": "Sticker",
  "chat.voice": "Tin nhắn thoại",
  "chat.video.msg": "Video",
  "share.file": "File",
  "chat.recommended": "Link",
  "chat.location.new": "Vị trí",
};

function renderContent(data: TMessage): string {
  if (typeof data.content === "string") return data.content;
  const label = MSG_TYPE_LABELS[data.msgType] ?? data.msgType;
  const { title, href } = data.content as { title?: unknown; href?: unknown };
  return [`[${label}]`, typeof title === "string" ? title : "", typeof href === "string" ? href : ""]
    .filter(Boolean)
    .join(" ");
}

/** Zalo → Chatwoot: mỗi tin nhắn Zalo thành một tin `incoming` trong conversation tương ứng. */
export function createInboundHandler(chatwoot: ChatwootClient, log: Logger) {
  const queue = new KeyedQueue();

  async function createThread(account: ZaloAccount, message: Message): Promise<Thread> {
    const identifier = `zalo:${account.ownId}:${message.threadId}`;
    const name = message.data.dName || message.threadId;

    let contactId: number;
    let sourceId: string;
    try {
      ({ contactId, sourceId } = await chatwoot.createContact({
        inboxId: account.chatwootInboxId,
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
        contact.contact_inboxes?.find((ci) => ci.inbox.id === account.chatwootInboxId)?.source_id ??
        (await chatwoot.createContactInbox(contact.id, account.chatwootInboxId));
    }

    const conversationId = await chatwoot.createConversation({
      inboxId: account.chatwootInboxId,
      contactId,
      sourceId,
    });
    return upsertThread({
      ownId: account.ownId,
      threadId: message.threadId,
      threadType: message.type,
      chatwootContactId: contactId,
      chatwootSourceId: sourceId,
      chatwootConversationId: conversationId,
    });
  }

  async function forward(account: ZaloAccount, message: Message): Promise<void> {
    const content = renderContent(message.data);
    const thread = (await findThread(account.ownId, message.threadId)) ?? (await createThread(account, message));
    try {
      await chatwoot.createIncomingMessage(thread.chatwootConversationId, { content, sourceId: message.data.msgId });
    } catch (err) {
      // Conversation bị xóa trên Chatwoot: tạo mới rồi gửi lại một lần.
      if (!(err instanceof ChatwootError && err.status === 404)) throw err;
      const fresh = await createThread(account, message);
      await chatwoot.createIncomingMessage(fresh.chatwootConversationId, { content, sourceId: message.data.msgId });
    }
  }

  return (account: ZaloAccount, message: Message): void => {
    if (message.isSelf) return;
    const ctx = { ownId: account.ownId, threadId: message.threadId, msgId: message.data.msgId };
    if (message.type === ThreadType.Group) {
      log.debug(ctx, "Bỏ qua tin nhóm (chưa hỗ trợ)");
      return;
    }
    queue
      .run(`${account.ownId}:${message.threadId}`, () => forward(account, message))
      .catch((err) => log.error({ err, ...ctx }, "Không chuyển được tin Zalo sang Chatwoot"));
  };
}
