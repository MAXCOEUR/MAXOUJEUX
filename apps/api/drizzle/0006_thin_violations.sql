CREATE TABLE "slot_spins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stake" bigint NOT NULL,
	"reels" jsonb NOT NULL,
	"kind" text NOT NULL,
	"multiplier_tenths" integer NOT NULL,
	"payout" bigint NOT NULL,
	"spun_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slot_spins" ADD CONSTRAINT "slot_spins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slot_spins_user_spun_idx" ON "slot_spins" USING btree ("user_id","spun_at");