import { randomUUID } from "node:crypto";
import { LoginQRCallbackEventType, Zalo, type API } from "zca-js";
import type { ConnectSessions, ConnectSessionView, Logger } from "@trcf/bridge-core";

export type QrLoginState =
  | "starting"
  | "waiting_scan"
  | "waiting_confirm"
  | "success"
  | "expired"
  | "declined"
  | "cancelled"
  | "error";

type Session = ConnectSessionView & { state: QrLoginState; abort?: () => unknown; finishedAt?: number };

export type OnQrLoggedIn = (input: {
  api: API;
  displayName?: string;
}) => Promise<{ externalId: string; inboxId: number; created: boolean }>;

const FINAL_STATES: QrLoginState[] = ["success", "expired", "declined", "cancelled", "error"];
const SESSION_TTL_MS = 10 * 60_000;

/** Đăng nhập Zalo bằng QR từ trang admin. Chỉ một phiên QR chạy tại một thời điểm. */
export class QrLoginManager implements ConnectSessions {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly onLoggedIn: OnQrLoggedIn,
    private readonly log: Logger,
  ) {}

  start(): ConnectSessionView {
    this.cleanup();
    for (const s of this.sessions.values()) {
      if (!FINAL_STATES.includes(s.state)) this.cancel(s.id);
    }
    const session: Session = { id: randomUUID(), state: "starting" };
    this.sessions.set(session.id, session);
    void this.run(session);
    return toView(session);
  }

  get(id: string): ConnectSessionView | undefined {
    const session = this.sessions.get(id);
    return session && toView(session);
  }

  cancel(id: string): void {
    const session = this.sessions.get(id);
    if (!session || FINAL_STATES.includes(session.state)) return;
    session.state = "cancelled";
    session.abort?.();
  }

  private async run(session: Session): Promise<void> {
    const zalo = new Zalo({ selfListen: false, checkUpdate: false, logging: false });
    try {
      // Có callback thì zca-js không tự ghi file QR. Khi hết hạn/bị từ chối phải tự gọi abort/retry,
      // nếu không promise của loginQR sẽ treo.
      const api = await zalo.loginQR({}, (event) => {
        if (session.state === "cancelled") return event.actions?.abort();
        switch (event.type) {
          case LoginQRCallbackEventType.QRCodeGenerated:
            session.state = "waiting_scan";
            session.qrImage = `data:image/png;base64,${event.data.image}`;
            session.abort = event.actions.abort;
            break;
          case LoginQRCallbackEventType.QRCodeExpired:
            session.state = "expired";
            event.actions.abort();
            break;
          case LoginQRCallbackEventType.QRCodeScanned:
            session.state = "waiting_confirm";
            session.displayName = event.data.display_name;
            session.abort = event.actions.abort;
            break;
          case LoginQRCallbackEventType.QRCodeDeclined:
            session.state = "declined";
            event.actions.abort();
            break;
          case LoginQRCallbackEventType.GotLoginInfo:
            break;
        }
      });
      const result = await this.onLoggedIn({ api, displayName: session.displayName });
      Object.assign(session, { state: "success", ...result });
    } catch (err) {
      // abort() ở trên làm loginQR reject; các trạng thái đó không phải lỗi.
      if (!FINAL_STATES.includes(session.state)) {
        session.state = "error";
        session.error = err instanceof Error ? err.message : String(err);
        this.log.error({ err }, "Đăng nhập Zalo bằng QR thất bại");
      }
    } finally {
      session.qrImage = undefined;
      session.abort = undefined;
      session.finishedAt = Date.now();
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (s.finishedAt && now - s.finishedAt > SESSION_TTL_MS) this.sessions.delete(id);
    }
  }
}

function toView({ abort: _abort, finishedAt: _finishedAt, ...view }: Session): ConnectSessionView {
  return view;
}
