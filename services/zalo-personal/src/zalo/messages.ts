import type { Message, TMessage } from "zca-js";
import type { InboundMessage } from "@trcf/bridge-core";

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

export function toInboundMessage(message: Message): InboundMessage {
  return {
    threadId: message.threadId,
    threadType: message.type,
    contactName: message.data.dName || message.threadId,
    sourceId: message.data.msgId,
    content: renderContent(message.data),
  };
}
