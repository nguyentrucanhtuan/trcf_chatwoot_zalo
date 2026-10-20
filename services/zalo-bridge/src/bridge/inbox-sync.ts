import type { ChatwootClient } from "../chatwoot/client.js";
import type { Logger } from "../logger.js";
import { listAccounts } from "../store/repo.js";
import type { AccountManager } from "../zalo/account-manager.js";

const SYNC_INTERVAL_MS = 60_000;

/**
 * Xóa inbox Zalo trên Chatwoot = gỡ tài khoản khỏi bridge (giống ngắt kết nối kênh Facebook).
 * Chatwoot không có webhook `inbox_deleted` nên đối chiếu định kỳ với danh sách inbox.
 */
export async function syncDeletedInboxes(chatwoot: ChatwootClient, accounts: AccountManager, log: Logger) {
  // Đọc tài khoản TRƯỚC khi lấy danh sách inbox: tài khoản vừa thêm bằng QR luôn được tạo inbox trước
  // khi ghi DB, nên sẽ không bị coi nhầm là mất inbox.
  const known = await listAccounts();
  if (known.length === 0) return;

  let inboxIds: Set<number>;
  try {
    inboxIds = new Set(await chatwoot.listInboxIds());
  } catch (err) {
    // Không chắc inbox còn hay mất thì không xóa gì.
    log.warn({ err }, "Không lấy được danh sách inbox Chatwoot, bỏ qua lần đối chiếu này");
    return;
  }

  for (const account of known) {
    if (inboxIds.has(account.chatwootInboxId)) continue;
    log.warn(
      { ownId: account.ownId, inboxId: account.chatwootInboxId },
      `Inbox #${account.chatwootInboxId} đã bị xóa trên Chatwoot, gỡ tài khoản Zalo "${account.displayName}" khỏi bridge`,
    );
    await accounts.removeAccount(account.ownId);
  }
}

export function startInboxSync(chatwoot: ChatwootClient, accounts: AccountManager, log: Logger): () => void {
  const timer = setInterval(() => {
    syncDeletedInboxes(chatwoot, accounts, log).catch((err) => log.error({ err }, "Đối chiếu inbox thất bại"));
  }, SYNC_INTERVAL_MS);
  return () => clearInterval(timer);
}
