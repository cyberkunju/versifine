CREATE TABLE "transaction_mutations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"action" varchar(16) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"source" varchar(32),
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transaction_mutations" ADD CONSTRAINT "transaction_mutations_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_mutations" ADD CONSTRAINT "transaction_mutations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_mutations" ADD CONSTRAINT "transaction_mutations_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_mutations_space_user_idx" ON "transaction_mutations" USING btree ("space_id","user_id","created_at");
