import { CloseReason, ThreadType, Zalo, type API, type Credentials, type Message } from "zca-js";
import {
  decryptJson,
  deleteChannel,
  getChannel,
  listChannels,
  saveCredentials,
  setChannelStatus,
  type Channel,
  type ChannelConnector,
  type ChannelState,
  type ChannelStatus,
  type Logger,
  type OnInboundMessage,
  type Thread,
} from "@trcf/bridge-core";
import { snapshotCredentials } from "./credentials.js";
import { toInboundMessage } from "./messages.js";

const PERSIST_INTERVAL_MS = 30 * 60_000;
const MAX_RECONNECT_DELAY_MS = 5 * 60_000;

type Session = {
  channel: Channel;
  api?: API;
  status: ChannelStatus;
  attempt: number;
  stopping: boolean;
  timer?: NodeJS.Timeout;
};

/** Zalo cá nhân: giữ một phiên zca-js cho mỗi tài khoản. */
export class AccountManager implements ChannelConnector {
  readonly kind = "zalo_personal" as const;
  private readonly sessions = new Map<string, Session>();
  private persistTimer?: NodeJS.Timeout;

  constructor(
    private readonly onInbound: OnInboundMessage,
    private readonly log: Logger,
  ) {}

  async startAll(): Promise<void> {
    // Đăng nhập lần lượt, không ồ ạt cùng lúc.
    for (const channel of await listChannels(this.kind)) {
      await this.start(channel);
    }
    this.persistTimer = setInterval(() => void this.persistAll(), PERSIST_INTERVAL_MS);
  }

  async stopAll(): Promise<void> {
    clearInterval(this.persistTimer);
    for (const session of this.sessions.values()) this.stopSession(session);
    await this.persistAll();
  }

  async connect(key: string): Promise<void> {
    const old = this.sessions.get(key);
    if (old) {
      this.stopSession(old);
      this.sessions.delete(key);
    }
    const channel = await getChannel(key);
    if (!channel) throw new Error(`Không có tài khoản Zalo ${key}`);
    await this.start(channel);
  }

  async remove(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (session) {
      this.stopSession(session);
      this.sessions.delete(key);
    }
    await deleteChannel(key);
  }

  statuses(): ChannelState[] {
    return [...this.sessions.values()].map(({ channel, status }) => ({
      key: channel.key,
      kind: channel.kind,
      externalId: channel.externalId,
      displayName: channel.displayName,
      chatwootInboxId: channel.chatwootInboxId,
      status,
    }));
  }

  async sendText(channel: Channel, thread: Thread, text: string): Promise<void> {
    const session = this.sessions.get(channel.key);
    if (session?.status !== "online" || !session.api) throw new Error("Tài khoản Zalo đang offline");
    const threadType = thread.threadType === ThreadType.Group ? ThreadType.Group : ThreadType.User;
    await session.api.sendMessage(text, thread.threadId, threadType);
  }

  private stopSession(session: Session): void {
    session.stopping = true;
    clearTimeout(session.timer);
    session.api?.listener.stop();
  }

  private handleMessage(channel: Channel, message: Message): void {
    if (message.isSelf) return;
    if (message.type === ThreadType.Group) {
      this.log.debug({ channel: channel.key, threadId: message.threadId }, "Bỏ qua tin nhóm (chưa hỗ trợ)");
      return;
    }
    this.onInbound(channel, toInboundMessage(message));
  }

  private async start(channel: Channel): Promise<void> {
    const log = this.log.child({ channel: channel.key });
    const session: Session = this.sessions.get(channel.key) ?? {
      channel,
      status: "offline",
      attempt: 0,
      stopping: false,
    };
    session.channel = channel;
    this.sessions.set(channel.key, session);
    await this.setStatus(session, "connecting");

    let api: API;
    try {
      const zalo = new Zalo({ selfListen: false, checkUpdate: false, logging: false });
      api = await zalo.login(decryptJson<Credentials>(channel.credentials));
    } catch (err) {
      // Login bằng cookie thất bại thường là do phiên đã hết hạn/bị đăng xuất.
      log.error({ err }, "Đăng nhập Zalo thất bại, cần quét QR lại");
      await this.setStatus(session, "needs_relogin");
      return;
    }

    if (api.getOwnId() !== channel.externalId) {
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
    listener.on("message", (message) => this.handleMessage(session.channel, message));
    listener.on("error", (err) => log.warn({ err }, "Zalo listener lỗi"));
    listener.on("closed", (code, reason) => void this.handleClosed(session, code, reason));
    // zca-js tự retry với các mã lỗi tạm thời; "closed" chỉ phát khi nó bỏ cuộc.
    listener.start({ retryOnClose: true });

    await this.persist(session);
  }

  private async handleClosed(session: Session, code: CloseReason, reason: string): Promise<void> {
    if (session.stopping) return;
    const log = this.log.child({ channel: session.channel.key, code, reason });
    session.api = undefined;

    if (code === CloseReason.DuplicateConnection || code === CloseReason.KickConnection) {
      log.error('Zalo Web được mở ở nơi khác nên bridge bị ngắt. Đóng Zalo Web rồi bấm "Kết nối lại" trên trang /admin.');
      await this.setStatus(session, "duplicate_connection");
      return;
    }

    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 5_000 * 2 ** session.attempt);
    session.attempt += 1;
    log.warn({ delay }, "Zalo listener đã đóng, sẽ đăng nhập lại");
    await this.setStatus(session, "offline");
    session.timer = setTimeout(async () => {
      const channel = await getChannel(session.channel.key);
      if (channel && !session.stopping) await this.start(channel);
    }, delay);
  }

  private async setStatus(session: Session, status: ChannelStatus): Promise<void> {
    session.status = status;
    await setChannelStatus(session.channel.key, status).catch((err) =>
      this.log.warn({ err, channel: session.channel.key }, "Không lưu được trạng thái tài khoản"),
    );
  }

  private async persist(session: Session): Promise<void> {
    if (!session.api) return;
    try {
      await saveCredentials(session.channel.key, snapshotCredentials(session.api));
    } catch (err) {
      this.log.warn({ err, channel: session.channel.key }, "Không lưu được credentials");
    }
  }

  private async persistAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => this.persist(s)));
  }
}
