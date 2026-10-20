import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const MAX_CLOCK_SKEW_SECONDS = 300;

/**
 * Chatwoot ký webhook bằng `X-Chatwoot-Signature: sha256=HMAC_SHA256(secret, "<timestamp>.<raw body>")`
 * kèm `X-Chatwoot-Timestamp` (xem lib/webhooks/trigger.rb trong source Chatwoot).
 */
export function verifySignature(
  secret: string,
  timestamp: string | undefined,
  signature: string | undefined,
  rawBody: string,
): boolean {
  if (!timestamp || !signature?.startsWith("sha256=")) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_CLOCK_SKEW_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  const received = Buffer.from(signature.slice("sha256=".length), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

// Payload `message_created` của API inbox (Message#webhook_data). Chỉ khai báo field bridge dùng.
export const MessageCreatedPayload = z.looseObject({
  event: z.literal("message_created"),
  id: z.number(),
  content: z.string().nullish(),
  message_type: z.string(),
  private: z.boolean().default(false),
  inbox: z.looseObject({ id: z.number() }),
  conversation: z.looseObject({ id: z.number() }),
  attachments: z.array(z.looseObject({ data_url: z.string().optional(), file_type: z.string().optional() })).optional(),
});

export type MessageCreatedPayload = z.infer<typeof MessageCreatedPayload>;
