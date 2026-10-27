CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"link" text,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_tag_counts" (
	"user_id" text NOT NULL,
	"tag" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_tag_counts_user_id_tag_pk" PRIMARY KEY("user_id","tag")
);
--> statement-breakpoint
ALTER TABLE "credential_documents" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "channel" text DEFAULT '자유' NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_documents" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "answer_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "revealed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "therapist_profiles" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "therapist_profiles" ADD COLUMN "tier_rank" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "temperature" real DEFAULT 36.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rating_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "adopted_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tag_counts" ADD CONSTRAINT "user_tag_counts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_room_channel_created_idx" ON "chat_messages" USING btree ("room","channel","created_at");--> statement-breakpoint
CREATE INDEX "posts_board_category_created_idx" ON "posts" USING btree ("board","category","created_at");--> statement-breakpoint
CREATE INDEX "posts_open_tier_idx" ON "posts" USING btree ("board","status","target_tier","answer_count");--> statement-breakpoint
CREATE INDEX "posts_author_idx" ON "posts" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_search_trgm_idx" ON "posts" USING gin (("title" || ' ' || "body") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ratings_unrevealed_idx" ON "ratings" USING btree ("created_at") WHERE revealed_at is null;--> statement-breakpoint
CREATE INDEX "profiles_directory_idx" ON "therapist_profiles" USING btree ("verification","tier_rank");