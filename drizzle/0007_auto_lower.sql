ALTER TABLE "posts" ADD COLUMN "auto_lower" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "tier_changed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "posts" SET "tier_changed_at" = "created_at" WHERE "tier_changed_at" IS NULL;
--> statement-breakpoint
-- 기존 질문은 작성자가 동의한 적이 없으므로 끔 (새 질문만 기본 켜짐)
UPDATE "posts" SET "auto_lower" = false;
