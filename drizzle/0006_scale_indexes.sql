CREATE INDEX "answers_author_idx" ON "answers" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "profiles_specialties_idx" ON "therapist_profiles" USING gin ("specialties");--> statement-breakpoint
CREATE INDEX "users_temperature_idx" ON "users" USING btree ("temperature");