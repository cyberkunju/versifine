import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { botSessions, type BotSession } from '../db/schema/botSessions.ts';

export async function getBotSession(phone: string): Promise<BotSession | null> {
  const [row] = await db
    .select()
    .from(botSessions)
    .where(eq(botSessions.phone, phone))
    .limit(1);
  return row || null;
}

export async function saveBotSession(phone: string, data: Partial<Omit<BotSession, 'phone' | 'createdAt' | 'updatedAt'>>): Promise<BotSession> {
  const now = new Date();
  const insertData = {
    phone,
    ...data,
    updatedAt: now,
  };

  const [row] = await db
    .insert(botSessions)
    .values(insertData)
    .onConflictDoUpdate({
      target: botSessions.phone,
      set: {
        ...data,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) {
    throw new Error('Failed to save bot session');
  }

  return row;
}

export async function deleteBotSession(phone: string): Promise<void> {
  await db.delete(botSessions).where(eq(botSessions.phone, phone));
}
