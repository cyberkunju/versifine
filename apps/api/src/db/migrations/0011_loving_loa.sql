CREATE TABLE "processed_messages" (
	"message_id" varchar(128) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "processed_messages_created_idx" ON "processed_messages" USING btree ("created_at");