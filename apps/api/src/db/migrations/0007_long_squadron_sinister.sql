CREATE TABLE "bot_sessions" (
	"phone" varchar(20) PRIMARY KEY NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"state" varchar(40) DEFAULT 'GREETING' NOT NULL,
	"linked" boolean DEFAULT false NOT NULL,
	"user_id" uuid,
	"space_id" uuid,
	"last_draft_id" uuid,
	"last_transaction_id" uuid,
	"reply_mode" varchar(15) DEFAULT 'auto' NOT NULL,
	"pending" jsonb DEFAULT '{}' NOT NULL,
	"account_resolved" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD CONSTRAINT "bot_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD CONSTRAINT "bot_sessions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;