import { randomBytes, randomUUID } from "node:crypto";
import type { ConnectSessions, ConnectSessionView, Logger } from "@trcf/bridge-core";
import { buildAuthorizationUrl, createPkce, exchangeCode, getOaInfo, type OaTokens } from "./api.js";

type State = "waiting_authorize" | "connecting" | "success" | "cancelled" | "expired" | "error";
type Session = ConnectSessionView & {
  state: State;
  oauthState: string;
  codeVerifier: string;
  createdAt: number;
  finishedAt?: number;
};

export type OnOaAuthorized = (input: {
  oaId: string;
  name: string;
  tokens: OaTokens;
}) => Promise<{ inboxId: number; created: boolean }>;

const FINAL: State[] = ["success", "cancelled", "expired", "error"];
// Mã code của Zalo chỉ sống 10 phút.
const SESSION_TTL_MS = 10 * 60_000;

/**
 * Cấp quyền OA từ trang admin: tạo URL cấp quyền (PKCE + state), Zalo redirect về /zalo-oa/callback,
 * callback đổi code lấy token rồi đăng ký channel. `state` ngẫu nhiên là bằng chứng phiên do admin tạo,
 * vì callback chạy trên domain công khai nên không có cookie Chatwoot.
 */
export class OaConnectSessions implements ConnectSessions {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly onAuthorized: OnOaAuthorized,
    private readonly log: Logger,
  ) {}

  start(): ConnectSessionView {
    this.cleanup();
    const { codeVerifier, codeChallenge } = createPkce();
    const oauthState = randomBytes(24).toString("base64url");
    const session: Session = {
      id: randomUUID(),
      state: "waiting_authorize",
      authUrl: buildAuthorizationUrl(codeChallenge, oauthState),
      oauthState,
      codeVerifier,
      createdAt: Date.now(),
    };
    this.sessions.set(session.id, session);
    return toView(session);
  }

  get(id: string): ConnectSessionView | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (session.state === "waiting_authorize" && Date.now() - session.createdAt > SESSION_TTL_MS) {
      this.finish(session, "expired");
    }
    return toView(session);
  }

  cancel(id: string): void {
    const session = this.sessions.get(id);
    if (session && !FINAL.includes(session.state)) this.finish(session, "cancelled");
  }

  /** Xử lý redirect từ Zalo. Trả về thông điệp hiển thị cho người dùng trong cửa sổ cấp quyền. */
  async handleCallback(params: { state?: string; code?: string; oaId?: string }): Promise<{ ok: boolean; message: string }> {
    const session = [...this.sessions.values()].find((s) => s.oauthState === params.state);
    if (!session || session.state !== "waiting_authorize") {
      return { ok: false, message: "Phiên cấp quyền không tồn tại hoặc đã hết hạn. Hãy bấm kết nối lại từ Chatwoot." };
    }
    if (!params.code) {
      this.finish(session, "cancelled");
      return { ok: false, message: "Bạn chưa cấp quyền cho ứng dụng." };
    }

    session.state = "connecting";
    try {
      const tokens = await exchangeCode(params.code, session.codeVerifier);
      const info = await getOaInfo(tokens.accessToken);
      if (params.oaId && params.oaId !== info.oaId) throw new Error("oa_id trong callback không khớp với token");
      const { inboxId, created } = await this.onAuthorized({ oaId: info.oaId, name: info.name, tokens });
      Object.assign(session, { inboxId, created, displayName: info.name, externalId: info.oaId });
      this.finish(session, "success");
      return { ok: true, message: `Đã kết nối Zalo OA “${info.name}”. Bạn có thể đóng cửa sổ này.` };
    } catch (err) {
      session.error = err instanceof Error ? err.message : String(err);
      this.finish(session, "error");
      this.log.error({ err }, "Kết nối Zalo OA thất bại");
      return { ok: false, message: `Kết nối thất bại: ${session.error}` };
    }
  }

  private finish(session: Session, state: State): void {
    session.state = state;
    session.authUrl = undefined;
    session.finishedAt = Date.now();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.createdAt > 2 * SESSION_TTL_MS) this.sessions.delete(id);
    }
  }
}

function toView({ oauthState: _s, codeVerifier: _v, createdAt: _c, finishedAt: _f, ...view }: Session): ConnectSessionView {
  return view;
}
