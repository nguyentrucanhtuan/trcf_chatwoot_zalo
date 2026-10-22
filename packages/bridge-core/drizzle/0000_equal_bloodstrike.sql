CREATE TABLE "channels" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text NOT NULL,
	"chatwoot_inbox_id" integer NOT NULL,
	"webhook_secret" text NOT NULL,
	"proxy_url" text,
	"credentials" text NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_chatwoot_inbox_id_unique" UNIQUE("chatwoot_inbox_id")
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_key" text NOT NULL,
	"thread_id" text NOT NULL,
	"thread_type" smallint NOT NULL,
	"chatwoot_contact_id" integer NOT NULL,
	"chatwoot_source_id" text NOT NULL,
	"chatwoot_conversation_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "threads_chatwoot_conversation_id_unique" UNIQUE("chatwoot_conversation_id")
);
--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_channel_key_channels_key_fk" FOREIGN KEY ("channel_key") REFERENCES "public"."channels"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "threads_channel_key_thread_id_idx" ON "threads" USING btree ("channel_key","thread_id");