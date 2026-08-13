CREATE TABLE "plinko_drops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stake" bigint NOT NULL,
	"risk" text NOT NULL,
	"slot" integer NOT NULL,
	"path" jsonb NOT NULL,
	"multiplier_tenths" integer NOT NULL,
	"payout" bigint NOT NULL,
	"dropped_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wheel_spins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stake" bigint NOT NULL,
	"segment" integer NOT NULL,
	"multiplier_tenths" integer NOT NULL,
	"payout" bigint NOT NULL,
	"spun_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plinko_drops" ADD CONSTRAINT "plinko_drops_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wheel_spins" ADD CONSTRAINT "wheel_spins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plinko_drops_user_dropped_idx" ON "plinko_drops" USING btree ("user_id","dropped_at");--> statement-breakpoint
CREATE INDEX "wheel_spins_user_spun_idx" ON "wheel_spins" USING btree ("user_id","spun_at");