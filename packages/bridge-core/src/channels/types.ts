import type { Channel, ChannelKind, ChannelStatus, Thread } from "../store/schema.js";

export type ChannelState = Pick<Channel, "key" | "kind" | "externalId" | "displayName" | "chatwootInboxId"> & {
  status: ChannelStatus;
};

/** Tin nhắn từ Zalo (cá nhân hoặc OA) đã chuẩn hóa để đẩy vào Chatwoot. */
export type InboundMessage = {
  threadId: string;
  /** 0 = 1-1, 1 = nhóm. */
  threadType: 0 | 1;
  /** Tên dùng khi tạo contact mới (và là tên dự phòng nếu resolveContactName lỗi). */
  contactName: string;
  /** Lấy tên thật khi cần tạo contact mới (VD gọi API hồ sơ người dùng của Zalo OA), tránh gọi ở mọi tin. */
  resolveContactName?: () => Promise<string>;
  /** ID tin phía Zalo, lưu vào `source_id` của message trên Chatwoot. */
  sourceId: string;
  content: string;
};

export type OnInboundMessage = (channel: Channel, message: InboundMessage) => void;

/** Một service quản lý một loại kênh. Lỗi của channel này không được ảnh hưởng channel khác. */
export interface ChannelConnector {
  readonly kind: ChannelKind;
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
  statuses(): ChannelState[];
  /** Kết nối (lại) theo dữ liệu mới nhất trong DB. */
  connect(key: string): Promise<void>;
  /** Ngắt kết nối và xóa channel (credentials + mapping) khỏi service. */
  remove(key: string): Promise<void>;
  /** Gửi văn bản tới thread; ném lỗi kèm lý do để đánh dấu `failed` trên Chatwoot. */
  sendText(channel: Channel, thread: Thread, text: string): Promise<void>;
}

/** Phiên thêm/kết nối lại channel từ trang admin (quét QR hoặc cấp quyền OAuth). */
export type ConnectSessionView = {
  id: string;
  /** Trạng thái riêng của service; kết thúc ở success | expired | declined | cancelled | error. */
  state: string;
  /** data URL ảnh QR (Zalo cá nhân). */
  qrImage?: string;
  /** URL trang cấp quyền (Zalo OA), mở bằng popup. */
  authUrl?: string;
  displayName?: string;
  externalId?: string;
  inboxId?: number;
  created?: boolean;
  error?: string;
};

export interface ConnectSessions {
  start(): ConnectSessionView;
  get(id: string): ConnectSessionView | undefined;
  cancel(id: string): void;
}
