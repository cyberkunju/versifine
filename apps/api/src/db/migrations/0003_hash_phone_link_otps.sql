-- Phone-link OTPs are no longer stored in cleartext. We persist an
-- HMAC-SHA256 of the 6-digit code (hex, 64 chars), so the column must widen
-- from varchar(6). Any pre-existing rows hold cleartext codes that can no
-- longer be matched against the new hashed lookup; they are short-lived
-- (10-minute TTL) and safe to expire immediately.
ALTER TABLE "phone_link_otps" ALTER COLUMN "code" TYPE varchar(64);
--> statement-breakpoint
UPDATE "phone_link_otps"
  SET "consumed_at" = coalesce("consumed_at", now())
  WHERE "consumed_at" IS NULL;
