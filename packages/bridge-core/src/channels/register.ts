import type { ChatwootClient } from "../chatwoot/client.js";
import { config } from "../config.js";
import { getChannel, insertChannel, saveCredentials } from "../store/repo.js";
import { channelKey, type ChannelKind } from "../store/schema.js";

const INBOX_PREFIX: Record<ChannelKind, string> = {
  zalo_personal: "Zalo",
  zalo_oa: "Zalo OA",
};

/**
 * Lưu channel vừa kết nối (quét QR / cấp quyền OA). Đã có thì chỉ cập nhật credentials;
 * mới thì tạo API inbox "<Zalo|Zalo OA> - <tên>" với callback URL trỏ về bridge.
 */
export async function registerChannel(
  chatwoot: ChatwootClient,
  input: { kind: ChannelKind; externalId: string; displayName: string; credentials: unknown },
): Promise<{ key: string; created: boolean; inboxId: number }> {
  const key = channelKey(input.kind, input.externalId);
  const existing = await getChannel(key);
  if (existing) {
    await saveCredentials(key, input.credentials);
    return { key, created: false, inboxId: existing.chatwootInboxId };
  }

  const inbox = await chatwoot.createApiInbox(
    `${INBOX_PREFIX[input.kind]} - ${input.displayName}`,
    `${config.BRIDGE_PUBLIC_URL}/webhooks/chatwoot/${encodeURIComponent(key)}`,
  );
  if (!inbox.secret) {
    throw new Error(
      `Đã tạo inbox #${inbox.id} nhưng không đọc được webhook secret: CHATWOOT_API_TOKEN phải thuộc user Administrator.`,
    );
  }
  await insertChannel({ ...input, key, chatwootInboxId: inbox.id, webhookSecret: inbox.secret });
  return { key, created: true, inboxId: inbox.id };
}
