CREATE TABLE "articles" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"body_part" text NOT NULL,
	"summary" text NOT NULL,
	"causes" jsonb NOT NULL,
	"exercises" jsonb NOT NULL,
	"red_flags" jsonb NOT NULL,
	"emergency" jsonb,
	"tips" jsonb NOT NULL,
	"status" text DEFAULT 'review' NOT NULL,
	"publish_on" text,
	"author_id" text,
	"author_name" text NOT NULL,
	"review_note" text,
	"views" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "articles_status_publish_idx" ON "articles" USING btree ("status","publish_on");--> statement-breakpoint
CREATE INDEX "articles_author_idx" ON "articles" USING btree ("author_id");