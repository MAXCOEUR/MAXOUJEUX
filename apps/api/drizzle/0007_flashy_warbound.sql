CREATE TABLE "game_stats_daily" (
	"user_id" uuid NOT NULL,
	"game" text NOT NULL,
	"day" date NOT NULL,
	"rounds" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"wagered" bigint DEFAULT 0 NOT NULL,
	"returned" bigint DEFAULT 0 NOT NULL,
	"net" bigint DEFAULT 0 NOT NULL,
	"best_win" bigint DEFAULT 0 NOT NULL,
	"duration_ms" bigint DEFAULT 0 NOT NULL,
	"best_time_ms" bigint,
	"best_attempts" integer,
	CONSTRAINT "game_stats_daily_user_id_game_day_pk" PRIMARY KEY("user_id","game","day")
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"unlocked_at" timestamp with time zone,
	CONSTRAINT "user_achievements_user_id_code_pk" PRIMARY KEY("user_id","code")
);
--> statement-breakpoint
DROP INDEX "stats_game_elo_idx";--> statement-breakpoint
ALTER TABLE "motus_attempts" ADD COLUMN "started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "wagered" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "returned" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "net" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "best_win" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "win_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "best_win_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "best_time_ms" bigint;--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "best_attempts" integer;--> statement-breakpoint
ALTER TABLE "game_stats_daily" ADD CONSTRAINT "game_stats_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_stats_daily_game_day_idx" ON "game_stats_daily" USING btree ("game","day");--> statement-breakpoint
CREATE INDEX "game_stats_daily_day_idx" ON "game_stats_daily" USING btree ("day");--> statement-breakpoint
CREATE INDEX "user_achievements_unlocked_idx" ON "user_achievements" USING btree ("user_id","unlocked_at") WHERE "user_achievements"."unlocked_at" is not null;--> statement-breakpoint
CREATE INDEX "stats_game_net_idx" ON "stats" USING btree ("game","net");