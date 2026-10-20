import type { Credentials } from "zca-js";
import type { ChatwootClient } from "../chatwoot/client.js";
import { config } from "../config.js";
import { getAccount, insertAccount, saveCredentials } from "../store/repo.js";

/**
 * Lưu tài khoản vừa đăng nhập QR. Tài khoản đã có thì chỉ cập nhật credentials;
 * tài khoản mới thì tạo API inbox "Zalo - <tên>" với callback URL trỏ về bridge.
 */
export async function registerZaloAccount(
  chatwoot: ChatwootClient,
  input: { ownId: string; displayName: string; credentials: Credentials },
): Promise<{ created: boolean; inboxId: number }> {
  const existing = await getAccount(input.ownId);
  if (existing) {
    await saveCredentials(input.ownId, input.credentials);
    return { created: false, inboxId: existing.chatwootInboxId };
  }

  const inbox = await chatwoot.createApiInbox(
    `Zalo - ${input.displayName}`,
    `${config.BRIDGE_PUBLIC_URL}/webhooks/chatwoot/${input.ownId}`,
  );
  if (!inbox.secret) {
    throw new Error(
      `Đã tạo inbox #${inbox.id} nhưng không đọc được webhook secret: CHATWOOT_API_TOKEN phải thuộc user Administrator.`,
    );
  }
  await insertAccount({ ...input, chatwootInboxId: inbox.id, webhookSecret: inbox.secret });
  return { created: true, inboxId: inbox.id };
}
