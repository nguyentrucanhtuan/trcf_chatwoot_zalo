import {
  channelKey,
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
import { getUserDisplayName, OaApiError, refreshTokens, sendTextMessage, type OaTokens } from "./api.js";
import { renderOaMessage, type OaEvent } from "./webhook.js";

// Làm mới trước khi access token (25 giờ) hết hạn; refresh token sống 3 tháng và chỉ dùng được một lần.
const REFRESH_BEFORE_MS = 60 * 60_000;
const RETRY_DELAY_MS = 5 * 60_000;
const SEEN_MSG_LIMIT = 2000;

type OaSession = {
  channel: Channel;
  tokens: OaTokens;
  status: ChannelStatus;
  timer?: NodeJS.Timeout;
  /** Một lần làm mới tại một thời điểm, vì refresh token cũ mất hiệu lực ngay khi dùng. */
  refreshing?: Promise<OaTokens>;
};

/** Zalo OA: mỗi OA một channel, giữ access token còn hạn và nhận tin qua webhook. */
export class OaManager implements ChannelConnector {
  readonly kind = "zalo_oa" as const;
  private readonly sessions = new Map<string, OaSession>();
  // Chống trùng khi Zalo gửi lại webhook (retry khi không mở được kết nối).
  private readonly seenMsgIds = new Set<string>();

  constructor(
    private readonly onInbound: OnInboundMessage,
    private readonly log: Logger,
  ) {}

  async startAll(): Promise<void> {
    for (const channel of await listChannels(this.kind)) await this.start(channel);
  }

  async stopAll(): Promise<void> {
    for (const session of this.sessions.values()) clearTimeout(session.timer);
  }

  /** Nạp lại từ DB (VD sau khi cấp quyền lại) và làm mới token ngay. */
  async connect(key: string): Promise<void> {
    const old = this.sessions.get(key);
    if (old) clearTimeout(old.timer);
    this.sessions.delete(key);
    const channel = await getChannel(key);
    if (!channel) throw new Error(`Không có OA ${key}`);
    await this.start(channel);
  }

  async remove(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (session) clearTimeout(session.timer);
    this.sessions.delete(key);
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
    if (!session) throw new Error("OA chưa được kết nối");
    try {
      await sendTextMessage(await this.accessToken(session), thread.threadId, text);
    } catch (err) {
      // Token bị thu hồi/hết hạn sớm: làm mới một lần rồi gửi lại.
      if (!(err instanceof OaApiError && err.isTokenError)) throw err;
      await sendTextMessage((await this.refresh(session)).accessToken, thread.threadId, text);
    }
  }

  /** Xử lý một sự kiện webhook đã xác minh chữ ký. */
  handleEvent(event: OaEvent): void {
    // Chỉ chuyển tin người dùng gửi; oa_send_* là tin OA gửi (từ bridge hoặc trang quản lý OA) nên bỏ qua
    // để tránh vòng lặp. follow/unfollow... chưa dùng.
    if (!event.event_name.startsWith("user_send_") || !event.message || !event.sender || !event.recipient) return;

    const key = channelKey("zalo_oa", event.recipient.id);
    const session = this.sessions.get(key);
    if (!session) {
      this.log.debug({ oaId: event.recipient.id }, "Bỏ qua sự kiện của OA chưa kết nối");
      return;
    }

    const { msg_id: msgId } = event.message;
    if (this.seenMsgIds.has(msgId)) return;
    this.seenMsgIds.add(msgId);
    if (this.seenMsgIds.size > SEEN_MSG_LIMIT) this.seenMsgIds.delete(this.seenMsgIds.values().next().value!);

    const userId = event.sender.id;
    this.onInbound(session.channel, {
      threadId: userId,
      threadType: 0,
      contactName: `Zalo ${userId}`,
      resolveContactName: async () => getUserDisplayName(await this.accessToken(session), userId),
      sourceId: msgId,
      content: renderOaMessage(event.message),
    });
  }

  private async start(channel: Channel): Promise<void> {
    const session: OaSession = {
      channel,
      tokens: decryptJson<OaTokens>(channel.credentials),
      status: "connecting",
    };
    this.sessions.set(channel.key, session);
    try {
      await this.accessToken(session);
      await this.setStatus(session, "online");
    } catch {
      // refresh() đã ghi log và đặt trạng thái.
    }
    this.schedule(session);
  }

  /** Access token còn hạn, làm mới nếu sắp hết. */
  private async accessToken(session: OaSession): Promise<string> {
    if (session.tokens.accessTokenExpiresAt - Date.now() > REFRESH_BEFORE_MS) return session.tokens.accessToken;
    return (await this.refresh(session)).accessToken;
  }

  private refresh(session: OaSession): Promise<OaTokens> {
    session.refreshing ??= (async () => {
      const log = this.log.child({ channel: session.channel.key });
      try {
        const tokens = await refreshTokens(session.tokens.refreshToken);
        // Lưu ngay: refresh token cũ đã mất hiệu lực, mất cặp mới này là phải cấp quyền lại.
        await saveCredentials(session.channel.key, tokens);
        session.tokens = tokens;
        await this.setStatus(session, "online");
        log.info("Đã làm mới access token Zalo OA");
        return tokens;
      } catch (err) {
        const stillValid = session.tokens.accessTokenExpiresAt > Date.now();
        // Access token cũ còn hạn thì vẫn dùng được, chỉ cảnh báo; hết hạn thì cần cấp quyền lại.
        await this.setStatus(session, stillValid ? "online" : "needs_relogin");
        log.error({ err }, stillValid ? "Làm mới token Zalo OA thất bại, sẽ thử lại" : "Token Zalo OA hết hạn, cần cấp quyền lại");
        throw err;
      } finally {
        session.refreshing = undefined;
        this.schedule(session);
      }
    })();
    return session.refreshing;
  }

  private schedule(session: OaSession): void {
    clearTimeout(session.timer);
    if (this.sessions.get(session.channel.key) !== session) return;
    const dueIn = session.tokens.accessTokenExpiresAt - REFRESH_BEFORE_MS - Date.now();
    const delay = session.status === "online" ? Math.max(dueIn, 60_000) : RETRY_DELAY_MS;
    session.timer = setTimeout(() => {
      this.refresh(session).catch(() => {});
    }, delay);
  }

  private async setStatus(session: OaSession, status: ChannelStatus): Promise<void> {
    session.status = status;
    await setChannelStatus(session.channel.key, status).catch((err) =>
      this.log.warn({ err, channel: session.channel.key }, "Không lưu được trạng thái OA"),
    );
  }
}
