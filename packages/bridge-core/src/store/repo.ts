import { and, eq, sql as rawSql } from "drizzle-orm";
import { encryptJson } from "./crypto.js";
import { db } from "./db.js";
import { channels, threads, type Channel, type ChannelKind, type ChannelStatus, type Thread } from "./schema.js";

// --- channels ---

export async function listChannels(kind?: ChannelKind): Promise<Channel[]> {
  return kind ? db.select().from(channels).where(eq(channels.kind, kind)) : db.select().from(channels);
}

export async function getChannel(key: string): Promise<Channel | undefined> {
  const [row] = await db.select().from(channels).where(eq(channels.key, key));
  return row;
}

export async function insertChannel(input: {
  key: string;
  kind: ChannelKind;
  externalId: string;
  displayName: string;
  chatwootInboxId: number;
  webhookSecret: string;
  credentials: unknown;
}): Promise<void> {
  await db.insert(channels).values({ ...input, credentials: encryptJson(input.credentials) });
}

export async function saveCredentials(key: string, credentials: unknown): Promise<void> {
  await db
    .update(channels)
    .set({ credentials: encryptJson(credentials), updatedAt: rawSql`now()` })
    .where(eq(channels.key, key));
}

/** Xóa channel cùng mapping threads (ON DELETE CASCADE). */
export async function deleteChannel(key: string): Promise<void> {
  await db.delete(channels).where(eq(channels.key, key));
}

export async function setChannelStatus(key: string, status: ChannelStatus): Promise<void> {
  await db.update(channels).set({ status, updatedAt: rawSql`now()` }).where(eq(channels.key, key));
}

// --- threads ---

export async function findThread(channelKey: string, threadId: string): Promise<Thread | undefined> {
  const [row] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.channelKey, channelKey), eq(threads.threadId, threadId)));
  return row;
}

export async function findThreadByConversation(conversationId: number): Promise<Thread | undefined> {
  const [row] = await db.select().from(threads).where(eq(threads.chatwootConversationId, conversationId));
  return row;
}

export async function upsertThread(input: Omit<Thread, "id" | "createdAt">): Promise<Thread> {
  const [row] = await db
    .insert(threads)
    .values(input)
    .onConflictDoUpdate({
      target: [threads.channelKey, threads.threadId],
      set: {
        chatwootContactId: input.chatwootContactId,
        chatwootSourceId: input.chatwootSourceId,
        chatwootConversationId: input.chatwootConversationId,
      },
    })
    .returning();
  return row!;
}
