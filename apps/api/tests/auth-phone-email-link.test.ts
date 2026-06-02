import { afterEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { eq, inArray, or } from 'drizzle-orm';
import { db } from '../src/db/client.ts';
import { spaceMembers, spaces } from '../src/db/schema/spaces.ts';
import { users } from '../src/db/schema/users.ts';
import { wallets } from '../src/db/schema/wallets.ts';
import { errorMiddleware, onError } from '../src/middleware/error.ts';
import { requestId } from '../src/middleware/requestId.ts';
import { authRoutes } from '../src/routes/auth.ts';
import { ensureUserByPhone } from '../src/services/auth/provision.ts';
import { AppError } from '../src/utils/errors.ts';

const RUN = `phone-email-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const touchedEmails = new Set<string>();
const touchedPhones = new Set<string>();

function email(local: string) {
  const value = `${RUN}-${local}@example.com`;
  touchedEmails.add(value);
  return value;
}

function phone(suffix: string) {
  const value = `91988${suffix.padStart(7, '0')}`.slice(0, 12);
  touchedPhones.add(value);
  return value;
}

function authApp() {
  const app = new Hono();
  app.onError(onError);
  app.use('*', requestId);
  app.use('*', errorMiddleware);
  app.route('/auth', authRoutes);
  return app;
}

async function createWebUser(emailValue: string, phoneValue?: string) {
  touchedEmails.add(emailValue);
  if (phoneValue) touchedPhones.add(phoneValue);

  const [space] = await db
    .insert(spaces)
    .values({ name: 'Personal', type: 'personal', baseCurrency: 'INR' })
    .returning({ id: spaces.id });
  if (!space) throw new Error('space creation failed');

  const [user] = await db
    .insert(users)
    .values({
      email: emailValue,
      passwordHash: 'test-hash',
      displayName: null,
      primaryLanguage: 'en',
      baseCurrency: 'INR',
      activeSpaceId: space.id,
      whatsappPhone: phoneValue ?? null,
      whatsappPhoneVerifiedAt: phoneValue ? new Date() : null,
    })
    .returning({ id: users.id, activeSpaceId: users.activeSpaceId });
  if (!user) throw new Error('user creation failed');

  await db.update(spaces).set({ createdBy: user.id }).where(eq(spaces.id, space.id));
  await db.insert(spaceMembers).values({ spaceId: space.id, userId: user.id, role: 'owner' });
  await db.insert(wallets).values({ spaceId: space.id, name: 'Cash', type: 'cash', currency: 'INR' });

  return user;
}

async function fetchUser(id: string) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      whatsappPhone: users.whatsappPhone,
      activeSpaceId: users.activeSpaceId,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row;
}

afterEach(async () => {
  const emailList = [...touchedEmails];
  const phoneList = [...touchedPhones];
  for (const p of phoneList) emailList.push(`wa-${p}@wa.versifine.local`);
  if (!emailList.length && !phoneList.length) return;

  const predicates = [];
  if (emailList.length) predicates.push(inArray(users.email, emailList));
  if (phoneList.length) {
    predicates.push(inArray(users.whatsappPhone, phoneList));
  }

  const rows = await db
    .select({ id: users.id, activeSpaceId: users.activeSpaceId })
    .from(users)
    .where(or(...predicates));
  const userIds = rows.map((r) => r.id);
  const spaceIds = rows.map((r) => r.activeSpaceId).filter((id): id is string => Boolean(id));

  if (userIds.length) {
    await db.update(users).set({ activeSpaceId: null }).where(inArray(users.id, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  }
  if (spaceIds.length) {
    await db.delete(spaces).where(inArray(spaces.id, spaceIds));
  }
});

describe('WhatsApp email linking', () => {
  test('a WhatsApp-provided free email is adopted by later web registration', async () => {
    const e = email('future-web');
    const p = phone('1001');

    const wa = await ensureUserByPhone(p, 'en', e);
    expect(wa.email).toBe(e);
    expect(wa.linkedExisting).toBe(false);

    const res = await authApp().request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: e,
        password: 'StrongPass123!',
        displayName: 'Future Web',
        primaryLanguage: 'en',
      }),
    });
    expect(res.status).toBe(201);
    const payload = (await res.json()) as { data: { user: { id: string; whatsappPhone: string | null } } };
    expect(payload.data.user.id).toBe(wa.userId);
    expect(payload.data.user.whatsappPhone).toBe(p);

    const row = await fetchUser(wa.userId);
    expect(row?.passwordHash).toBeTruthy();
  });

  test('a new WhatsApp phone attaches to an existing unlinked web account by email', async () => {
    const e = email('existing-web');
    const p = phone('1002');
    const web = await createWebUser(e);

    const linked = await ensureUserByPhone(p, 'ml', e);
    expect(linked.userId).toBe(web.id);
    expect(linked.spaceId).toBe(web.activeSpaceId);
    expect(linked.linkedExisting).toBe(true);

    const row = await fetchUser(web.id);
    expect(row?.whatsappPhone).toBe(p);
  });

  test('does not fake-link an email already attached to another WhatsApp phone', async () => {
    const e = email('taken-web');
    const originalPhone = phone('1003');
    const newPhone = phone('1004');
    await createWebUser(e, originalPhone);

    let err: unknown;
    try {
      await ensureUserByPhone(newPhone, 'en', e);
    } catch (caught) {
      err = caught;
    }

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('CONFLICT');

    const [createdForNewPhone] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.whatsappPhone, newPhone))
      .limit(1);
    expect(createdForNewPhone).toBeUndefined();
  });
});
