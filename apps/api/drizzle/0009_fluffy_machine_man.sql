CREATE TABLE "account_accesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ip" text NOT NULL,
	"device_hash" text,
	"user_agent" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_bans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"target_user_id" uuid,
	"target_value" text NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "moderation_bans_kind_valid" CHECK ("moderation_bans"."kind" in ('account', 'ip', 'device'))
);
--> statement-breakpoint
CREATE TABLE "staff_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"target_user_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'player' NOT NULL;--> statement-breakpoint
UPDATE "users" SET "role" = CASE WHEN "is_admin" THEN 'admin' ELSE 'player' END;--> statement-breakpoint
ALTER TABLE "account_accesses" ADD CONSTRAINT "account_accesses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_bans" ADD CONSTRAINT "moderation_bans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_bans" ADD CONSTRAINT "moderation_bans_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_audit_log" ADD CONSTRAINT "staff_audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_accesses_user_seen_idx" ON "account_accesses" USING btree ("user_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "moderation_bans_target_idx" ON "moderation_bans" USING btree ("kind","target_value");--> statement-breakpoint
CREATE INDEX "moderation_bans_account_idx" ON "moderation_bans" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "staff_audit_log_actor_created_idx" ON "staff_audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_single_admin_idx" ON "users" USING btree ("role") WHERE "users"."role" = 'admin';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_valid" CHECK ("users"."role" in ('player', 'moderator', 'admin'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_admin_compat_synced" CHECK ("users"."is_admin" = ("users"."role" = 'admin'));
