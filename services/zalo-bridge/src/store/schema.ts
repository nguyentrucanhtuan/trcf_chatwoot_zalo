import { integer, pgTable, serial, smallint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const ACCOUNT_STATUSES = [
  "offline",
  "connecting",
  "online",
  // Zalo Web được mở ở nơi khác nên Zalo đóng kết nối của bridge. Không tự reconnect để tránh giành phiên qua lại.
  "duplicate_connection",
  // Cookie hết hạn hoặc bị đăng xuất, cần quét QR lại.
  "needs_relogin",
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const zaloAccounts = pgTable("zalo_accounts", {
  ownId: text("own_id").primaryKey(),
  displayName: text("display_name").notNull(),
  chatwootInboxId: integer("chatwoot_inbox_id").notNull().unique(),
  webhookSecret: text("webhook_secret").notNull(),
  proxyUrl: text("proxy_url"),
  // JSON Credentials của zca-js, mã hóa AES-256-GCM (xem crypto.ts).
  credentials: text("credentials").notNull(),
  status: text("status").$type<AccountStatus>().notNull().default("offline"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const threads = pgTable(
  "threads",
  {
    id: serial("id").primaryKey(),
    ownId: text("own_id")
      .notNull()
      .references(() => zaloAccounts.ownId, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    // Giá trị của ThreadType trong zca-js: 0 = User, 1 = Group.
    threadType: smallint("thread_type").notNull(),
    chatwootContactId: integer("chatwoot_contact_id").notNull(),
    chatwootSourceId: text("chatwoot_source_id").notNull(),
    chatwootConversationId: integer("chatwoot_conversation_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("threads_own_id_thread_id_idx").on(t.ownId, t.threadId)],
);

export type ZaloAccount = typeof zaloAccounts.$inferSelect;
export type Thread = typeof threads.$inferSelect;
