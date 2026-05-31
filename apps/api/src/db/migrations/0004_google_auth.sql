ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_sub" varchar(64);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_picture_url" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_email_verified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_unique" ON "users" USING btree ("google_sub") WHERE "users"."google_sub" IS NOT NULL;
