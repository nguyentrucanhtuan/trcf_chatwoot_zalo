import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * X-ZEvent-Signature: "mac=" + hex(sha256(appId + rawBody + timestamp + OASecretKey)), là sha256 thường
 * (không phải HMAC); timestamp lấy từ field `timestamp` trong body
 * (developers.zalo.me/docs/official-account/webhook/tin-nhan/su-kien-nguoi-dung-gui-tin-nhan, MacUtils.java).
 */
export function verifyZaloSignature(
  appId: string,
  rawBody: string,
  timestamp: string,
  oaSecretKey: string,
  header: string | undefined,
): boolean {
  if (!header) return false;
  const received = Buffer.from(header.replace(/^mac=/, "").trim(), "hex");
  const expected = createHash("sha256").update(`${appId}${rawBody}${timestamp}${oaSecretKey}`).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

const Attachment = z.looseObject({
  type: z.string(),
  payload: z
    .looseObject({
      url: z.string().optional(),
      thumbnail: z.string().optional(),
      description: z.string().optional(),
      name: z.string().optional(),
      coordinates: z.looseObject({ latitude: z.coerce.string(), longitude: z.coerce.string() }).optional(),
    })
    .optional(),
});

export const OaEvent = z.looseObject({
  app_id: z.coerce.string(),
  event_name: z.string(),
  timestamp: z.coerce.string(),
  sender: z.looseObject({ id: z.coerce.string() }).optional(),
  recipient: z.looseObject({ id: z.coerce.string() }).optional(),
  message: z
    .looseObject({
      msg_id: z.string(),
      text: z.string().optional(),
      attachments: z.array(Attachment).optional(),
    })
    .optional(),
});
export type OaEvent = z.infer<typeof OaEvent>;

const ATTACHMENT_LABELS: Record<string, string> = {
  image: "Ảnh",
  gif: "GIF",
  sticker: "Sticker",
  audio: "Tin nhắn thoại",
  video: "Video",
  file: "File",
  link: "Link",
  location: "Vị trí",
  business_card: "Danh thiếp",
};

/** Nội dung hiển thị trên Chatwoot. Ảnh/file hiện dạng nhãn + link, xử lý đầy đủ ở bước "Ảnh, file và nhóm". */
export function renderOaMessage(message: NonNullable<OaEvent["message"]>): string {
  const parts: string[] = [];
  for (const attachment of message.attachments ?? []) {
    const payload = attachment.payload ?? {};
    const label = ATTACHMENT_LABELS[attachment.type] ?? attachment.type;
    const location = payload.coordinates
      ? `https://maps.google.com/?q=${payload.coordinates.latitude},${payload.coordinates.longitude}`
      : undefined;
    parts.push([`[${label}]`, payload.name ?? payload.description, payload.url ?? location].filter(Boolean).join(" "));
  }
  if (message.text) parts.push(message.text);
  return parts.join("\n") || "[Tin nhắn không hỗ trợ]";
}
