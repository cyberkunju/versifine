CREATE TABLE "learned_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"template" text NOT NULL,
	"regex" text NOT NULL,
	"fields" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "category_overrides_space_merchant_idx";--> statement-breakpoint
ALTER TABLE "phone_link_otps" ALTER COLUMN "code" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "category_overrides" ALTER COLUMN "occurrences" SET DATA TYPE numeric(6,0);--> statement-breakpoint
ALTER TABLE "goals" ALTER COLUMN "current_amount" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_sub" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_picture_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "learned_patterns" ADD CONSTRAINT "learned_patterns_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "learned_patterns_space_regex_unique" ON "learned_patterns" USING btree ("space_id","regex");--> statement-breakpoint
CREATE INDEX "learned_patterns_space_idx" ON "learned_patterns" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_unique" ON "users" USING btree ("google_sub") WHERE "users"."google_sub" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "category_overrides_space_merchant_unique" ON "category_overrides" USING btree ("space_id","merchant_normalized");