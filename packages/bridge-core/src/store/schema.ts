import { integer, pgTable, serial, smallint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const CHANNEL_KINDS = [
  // Zalo cá nhân qua zca-js (không chính thức).
  "zalo_personal",
  // Zalo Official Account qua Open API chính thức.
  "zalo_oa",
] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export const CHANNEL_STATUSES = [
  "offline",
  "connecting",
  "online",
  // Zalo cá nhân: Zalo Web được mở ở nơi khác nên Zalo đóng kết nối của bridge. Không tự reconnect để tránh giành phiên qua lại.
  "duplicate_connection",
  // Cá nhân: cookie hết hạn/bị đăng xuất. OA: refresh token hết hạn/bị thu hồi. Cần kết nối lại.
  "needs_relogin",
] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

/** Mỗi channel = một tài khoản Zalo cá nhân hoặc một OA, ứng với một API inbox trên Chatwoot. */
export const channels = pgTable("channels", {
  // "zalo:<ownId>" hoặc "oa:<oaId>" (xem channelKey()).
  key: text("key").primaryKey(),
  kind: text("kind").$type<ChannelKind>().notNull(),
  externalId: text("external_id").notNull(),
  displayName: text("display_name").notNull(),
  chatwootInboxId: integer("chatwoot_inbox_id").notNull().unique(),
  webhookSecret: text("webhook_secret").notNull(),
  proxyUrl: text("proxy_url"),
  // JSON mã hóa AES-256-GCM (crypto.ts): Credentials của zca-js hoặc OaTokens.
  credentials: text("credentials").notNull(),
  status: text("status").$type<ChannelStatus>().notNull().default("offline"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const threads = pgTable(
  "threads",
  {
    id: serial("id").primaryKey(),
    channelKey: text("channel_key")
      .notNull()
      .references(() => channels.key, { onDelete: "cascade" }),
    // Cá nhân: threadId của zca-js. OA: user_id của người dùng với OA.
    threadId: text("thread_id").notNull(),
    // 0 = 1-1, 1 = nhóm (trùng giá trị ThreadType của zca-js).
    threadType: smallint("thread_type").notNull(),
    chatwootContactId: integer("chatwoot_contact_id").notNull(),
    chatwootSourceId: text("chatwoot_source_id").notNull(),
    chatwootConversationId: integer("chatwoot_conversation_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("threads_channel_key_thread_id_idx").on(t.channelKey, t.threadId)],
);

export type Channel = typeof channels.$inferSelect;
export type Thread = typeof threads.$inferSelect;

export function channelKey(kind: ChannelKind, externalId: string): string {
  return `${kind === "zalo_oa" ? "oa" : "zalo"}:${externalId}`;
}
