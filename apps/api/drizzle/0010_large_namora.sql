ALTER TABLE "moderation_bans" DROP CONSTRAINT "moderation_bans_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "moderation_bans" DROP CONSTRAINT "moderation_bans_revoked_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "staff_audit_log" DROP CONSTRAINT "staff_audit_log_actor_user_id_users_id_fk";
