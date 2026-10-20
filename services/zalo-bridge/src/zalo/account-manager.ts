import { CloseReason, Zalo, type API, type Credentials, type Message } from "zca-js";
import type { Logger } from "../logger.js";
import { decryptJson } from "../store/crypto.js";
import { deleteAccount, getAccount, listAccounts, saveCredentials, setAccountStatus } from "../store/repo.js";
import type { AccountStatus, ZaloAccount } from "../store/schema.js";
import { snapshotCredentials } from "./credentials.js";

const PERSIST_INTERVAL_MS = 30 * 60_000;
const MAX_RECONNECT_DELAY_MS = 5 * 60_000;

type Session = {
  account: ZaloAccount;
  api?: API;
  status: AccountStatus;
  attempt: number;
  stopping: boolean;
  timer?: NodeJS.Timeout;
};

export type OnZaloMessage = (account: ZaloAccount, message: Message) => void;

/** Giữ một phiên zca-js cho mỗi tài khoản Zalo; lỗi của tài khoản này không ảnh hưởng tài khoản khác. */
export class AccountManager {
  private readonly sessions = new Map<string, Session>();
  private persistTimer?: NodeJS.Timeout;

  constructor(
    private readonly onMessage: OnZaloMessage,
    private readonly log: Logger,
  ) {}

  async startAll(): Promise<void> {
    // Đăng nhập lần lượt, không ồ ạt cùng lúc.
    for (const account of await listAccounts()) {
      await this.connect(account);
    }
    this.persistTimer = setInterval(() => void this.persistAll(), PERSIST_INTERVAL_MS);
  }

  async stopAll(): Promise<void> {
    clearInterval(this.persistTimer);
    for (const session of this.sessions.values()) {
      session.stopping = true;
      clearTimeout(session.timer);
      session.api?.listener.stop();
    }
    await this.persistAll();
  }

  /** Kết nối (lại) một tài khoản theo dữ liệu mới nhất trong DB, VD sau khi quét QR hoặc đã đóng Zalo Web. */
  async connectAccount(ownId: string): Promise<void> {
    const old = this.sessions.get(ownId);
    if (old) {
      old.stopping = true;
      clearTimeout(old.timer);
      old.api?.listener.stop();
      this.sessions.delete(ownId);
    }
    const account = await getAccount(ownId);
    if (!account) throw new Error(`Không có tài khoản Zalo ${ownId}`);
    await this.connect(account);
  }

  /** Ngắt kết nối và xóa tài khoản (credentials + mapping) khỏi bridge. */
  async removeAccount(ownId: string): Promise<void> {
    const session = this.sessions.get(ownId);
    if (session) {
      session.stopping = true;
      clearTimeout(session.timer);
      session.api?.listener.stop();
      this.sessions.delete(ownId);
    }
    await deleteAccount(ownId);
  }

  /** API của tài khoản nếu đang online. */
  getApi(ownId: string): API | undefined {
    const session = this.sessions.get(ownId);
    return session?.status === "online" ? session.api : undefined;
  }

  statuses(): { ownId: string; displayName: string; chatwootInboxId: number; status: AccountStatus }[] {
    return [...this.sessions.values()].map((s) => ({
      ownId: s.account.ownId,
      displayName: s.account.displayName,
      chatwootInboxId: s.account.chatwootInboxId,
      status: s.status,
    }));
  }

  private async connect(account: ZaloAccount): Promise<void> {
    const log = this.log.child({ ownId: account.ownId });
    const session: Session = this.sessions.get(account.ownId) ?? {
      account,
      status: "offline",
      attempt: 0,
      stopping: false,
    };
    session.account = account;
    this.sessions.set(account.ownId, session);
    await this.setStatus(session, "connecting");

    let api: API;
    try {
      const zalo = new Zalo({ selfListen: false, checkUpdate: false, logging: false });
      api = await zalo.login(decryptJson<Credentials>(account.credentials));
    } catch (err) {
      // Login bằng cookie thất bại thường là do phiên đã hết hạn/bị đăng xuất.
      log.error({ err }, "Đăng nhập Zalo thất bại, cần quét QR lại trên trang /admin");
      await this.setStatus(session, "needs_relogin");
      return;
    }

    if (api.getOwnId() !== account.ownId) {
      log.error({ actualOwnId: api.getOwnId() }, "Credentials thuộc tài khoản khác, bỏ qua");
      await this.setStatus(session, "needs_relogin");
      return;
    }

    session.api = api;
    const { listener } = api;
    listener.on("connected", () => {
      session.attempt = 0;
      log.info("Zalo listener đã kết nối");
      void this.setStatus(session, "online");
    });
    listener.on("message", (message) => this.onMessage(session.account, message));
    listener.on("error", (err) => log.warn({ err }, "Zalo listener lỗi"));
    listener.on("closed", (code, reason) => void this.handleClosed(session, code, reason));
    // zca-js tự retry với các mã lỗi tạm thời; "closed" chỉ phát khi nó bỏ cuộc.
    listener.start({ retryOnClose: true });

    await this.persist(session);
  }

  private async handleClosed(session: Session, code: CloseReason, reason: string): Promise<void> {
    if (session.stopping) return;
    const log = this.log.child({ ownId: session.account.ownId, code, reason });
    session.api = undefined;

    if (code === CloseReason.DuplicateConnection || code === CloseReason.KickConnection) {
      log.error("Zalo Web được mở ở nơi khác nên bridge bị ngắt. Đóng Zalo Web rồi bấm \"Kết nối lại\" trên trang /admin.");
      await this.setStatus(session, "duplicate_connection");
      return;
    }

    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 5_000 * 2 ** session.attempt);
    session.attempt += 1;
    log.warn({ delay }, "Zalo listener đã đóng, sẽ đăng nhập lại");
    await this.setStatus(session, "offline");
    session.timer = setTimeout(async () => {
      const account = await getAccount(session.account.ownId);
      if (account && !session.stopping) await this.connect(account);
    }, delay);
  }

  private async setStatus(session: Session, status: AccountStatus): Promise<void> {
    session.status = status;
    await setAccountStatus(session.account.ownId, status).catch((err) =>
      this.log.warn({ err, ownId: session.account.ownId }, "Không lưu được trạng thái tài khoản"),
    );
  }

  private async persist(session: Session): Promise<void> {
    if (!session.api) return;
    try {
      await saveCredentials(session.account.ownId, snapshotCredentials(session.api));
    } catch (err) {
      this.log.warn({ err, ownId: session.account.ownId }, "Không lưu được credentials");
    }
  }

  private async persistAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => this.persist(s)));
  }
}
