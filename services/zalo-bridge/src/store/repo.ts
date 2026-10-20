import { and, eq, sql as rawSql } from "drizzle-orm";
import type { Credentials } from "zca-js";
import { encryptJson } from "./crypto.js";
import { db } from "./db.js";
import { threads, zaloAccounts, type AccountStatus, type Thread, type ZaloAccount } from "./schema.js";

// --- zalo_accounts ---

export async function listAccounts(): Promise<ZaloAccount[]> {
  return db.select().from(zaloAccounts);
}

export async function getAccount(ownId: string): Promise<ZaloAccount | undefined> {
  const [row] = await db.select().from(zaloAccounts).where(eq(zaloAccounts.ownId, ownId));
  return row;
}

export async function insertAccount(input: {
  ownId: string;
  displayName: string;
  chatwootInboxId: number;
  webhookSecret: string;
  credentials: Credentials;
}): Promise<void> {
  await db.insert(zaloAccounts).values({ ...input, credentials: encryptJson(input.credentials) });
}

export async function saveCredentials(ownId: string, credentials: Credentials): Promise<void> {
  await db
    .update(zaloAccounts)
    .set({ credentials: encryptJson(credentials), updatedAt: rawSql`now()` })
    .where(eq(zaloAccounts.ownId, ownId));
}

/** Xóa tài khoản cùng mapping threads (ON DELETE CASCADE). */
export async function deleteAccount(ownId: string): Promise<void> {
  await db.delete(zaloAccounts).where(eq(zaloAccounts.ownId, ownId));
}

export async function setAccountStatus(ownId: string, status: AccountStatus): Promise<void> {
  await db.update(zaloAccounts).set({ status, updatedAt: rawSql`now()` }).where(eq(zaloAccounts.ownId, ownId));
}

// --- threads ---

export async function findThread(ownId: string, threadId: string): Promise<Thread | undefined> {
  const [row] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.ownId, ownId), eq(threads.threadId, threadId)));
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
      target: [threads.ownId, threads.threadId],
      set: {
        chatwootContactId: input.chatwootContactId,
        chatwootSourceId: input.chatwootSourceId,
        chatwootConversationId: input.chatwootConversationId,
      },
    })
    .returning();
  return row!;
}
