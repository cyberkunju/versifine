ALTER TABLE "transaction_mutations" ADD COLUMN "token" varchar(8);--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_mutations_token_idx" ON "transaction_mutations" USING btree ("space_id","token");
