CREATE TABLE "phone_link_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code" varchar(6) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" varchar(80),
	"primary_language" varchar(4) DEFAULT 'en' NOT NULL,
	"base_currency" char(3) DEFAULT 'INR' NOT NULL,
	"active_space_id" uuid,
	"whatsapp_phone" varchar(20),
	"whatsapp_phone_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "space_members" (
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(20) DEFAULT 'owner' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_members_space_id_user_id_pk" PRIMARY KEY("space_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"type" varchar(20) DEFAULT 'personal' NOT NULL,
	"base_currency" char(3) DEFAULT 'INR' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"type" varchar(20) NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"from_category" varchar(40),
	"to_category" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"merchant_normalized" varchar(200) NOT NULL,
	"category" varchar(40) NOT NULL,
	"occurrences" numeric(6, 0) DEFAULT '1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"amount" numeric(14,2) NOT NULL,
	"currency" char(3) NOT NULL,
	"base_amount" numeric(14,2) NOT NULL,
	"fx_rate" numeric(18,8),
	"description" text NOT NULL,
	"category" varchar(40),
	"category_confidence" numeric(3,2),
	"categorized_by" varchar(16),
	"date" date NOT NULL,
	"notes" text,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"source" varchar(24) NOT NULL,
	"transfer_id" uuid,
	"needs_fx_resolution" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transaction_embeddings" (
	"transaction_id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"recurrence" varchar(16) NOT NULL,
	"period_start" date,
	"period_end" date,
	"allocations" jsonb NOT NULL,
	"warn_threshold" smallint DEFAULT 80 NOT NULL,
	"exceed_threshold" smallint DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"target_amount" numeric(14,2) NOT NULL,
	"current_amount" numeric(14,2) DEFAULT 0 NOT NULL,
	"deadline" date,
	"linked_category" varchar(40),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"direction" varchar(16) NOT NULL,
	"counterparty_name" varchar(120) NOT NULL,
	"amount" numeric(14,2) NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"base_amount" numeric(14,2) NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"outstanding" numeric(14,2) NOT NULL,
	"date" date NOT NULL,
	"note" text,
	"linked_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"amount" numeric(14,2) NOT NULL,
	"date" date NOT NULL,
	"linked_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"merchant_normalized" varchar(200) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"average_amount" numeric(14,2) NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"frequency_days" integer NOT NULL,
	"next_expected_date" date,
	"occurrences" integer NOT NULL,
	"confidence" numeric(3,2) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"base" char(3) NOT NULL,
	"quote" char(3) NOT NULL,
	"rate" numeric(18,8) NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fx_rates_base_quote_pk" PRIMARY KEY("base","quote")
);
--> statement-breakpoint
ALTER TABLE "phone_link_otps" ADD CONSTRAINT "phone_link_otps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_corrections" ADD CONSTRAINT "category_corrections_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_corrections" ADD CONSTRAINT "category_corrections_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_overrides" ADD CONSTRAINT "category_overrides_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_embeddings" ADD CONSTRAINT "transaction_embeddings_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_embeddings" ADD CONSTRAINT "transaction_embeddings_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_linked_transaction_id_transactions_id_fk" FOREIGN KEY ("linked_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_settlements" ADD CONSTRAINT "ledger_settlements_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_settlements" ADD CONSTRAINT "ledger_settlements_linked_transaction_id_transactions_id_fk" FOREIGN KEY ("linked_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_items" ADD CONSTRAINT "recurring_items_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "phone_link_otps_user_id_idx" ON "phone_link_otps" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "phone_link_otps_code_idx" ON "phone_link_otps" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_token_hash_unique" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_whatsapp_phone_unique" ON "users" USING btree ("whatsapp_phone") WHERE "users"."whatsapp_phone" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "wallets_space_id_idx" ON "wallets" USING btree ("space_id","archived_at");--> statement-breakpoint
CREATE INDEX "category_corrections_space_idx" ON "category_corrections" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "category_overrides_space_merchant_idx" ON "category_overrides" USING btree ("space_id","merchant_normalized");--> statement-breakpoint
CREATE INDEX "transactions_space_date_idx" ON "transactions" USING btree ("space_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_space_category_idx" ON "transactions" USING btree ("space_id","category");--> statement-breakpoint
CREATE INDEX "transactions_space_wallet_idx" ON "transactions" USING btree ("space_id","wallet_id");--> statement-breakpoint
CREATE INDEX "transactions_space_type_idx" ON "transactions" USING btree ("space_id","type");--> statement-breakpoint
CREATE INDEX "transactions_transfer_idx" ON "transactions" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "transactions_description_trgm_idx" ON "transactions" USING gin (description gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "transaction_embeddings_vector_idx" ON "transaction_embeddings" USING ivfflat (embedding vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "transaction_embeddings_space_idx" ON "transaction_embeddings" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "budgets_space_idx" ON "budgets" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "goals_space_status_idx" ON "goals" USING btree ("space_id","status");--> statement-breakpoint
CREATE INDEX "goals_space_category_idx" ON "goals" USING btree ("space_id","linked_category");--> statement-breakpoint
CREATE INDEX "ledger_entries_space_status_idx" ON "ledger_entries" USING btree ("space_id","status");--> statement-breakpoint
CREATE INDEX "ledger_entries_counterparty_idx" ON "ledger_entries" USING btree ("space_id","counterparty_name");--> statement-breakpoint
CREATE INDEX "ledger_settlements_entry_idx" ON "ledger_settlements" USING btree ("ledger_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_items_space_merchant_unique" ON "recurring_items" USING btree ("space_id","merchant_normalized");--> statement-breakpoint
CREATE INDEX "recurring_items_space_status_idx" ON "recurring_items" USING btree ("space_id","status");