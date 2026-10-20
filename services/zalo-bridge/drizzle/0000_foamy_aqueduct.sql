CREATE TABLE "threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"own_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"thread_type" smallint NOT NULL,
	"chatwoot_contact_id" integer NOT NULL,
	"chatwoot_source_id" text NOT NULL,
	"chatwoot_conversation_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "threads_chatwoot_conversation_id_unique" UNIQUE("chatwoot_conversation_id")
);
--> statement-breakpoint
CREATE TABLE "zalo_accounts" (
	"own_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"chatwoot_inbox_id" integer NOT NULL,
	"webhook_secret" text NOT NULL,
	"proxy_url" text,
	"credentials" text NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zalo_accounts_chatwoot_inbox_id_unique" UNIQUE("chatwoot_inbox_id")
);
--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_own_id_zalo_accounts_own_id_fk" FOREIGN KEY ("own_id") REFERENCES "public"."zalo_accounts"("own_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "threads_own_id_thread_id_idx" ON "threads" USING btree ("own_id","thread_id");