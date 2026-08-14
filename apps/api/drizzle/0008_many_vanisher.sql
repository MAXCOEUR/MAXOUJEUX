ALTER TABLE "stats" DROP COLUMN "elo";--> statement-breakpoint
-- Reprise de l'historique dans les cumuls journaliers.
--
-- `wallet_tx` est le seul journal complet antérieur à ces tables : il porte
-- chaque mise et chaque gain des neuf jeux depuis l'ouverture du site. L'argent
-- est donc reconstitué **exactement**.
--
-- Ce qu'il ne porte pas : le nombre de manches. Le blackjack débite plusieurs
-- fois par manche (assurance, split, double) et le poker joue ses mains en
-- jetons sans toucher au porte-monnaie. `rounds`, `wins`, `losses` et `draws`
-- restent donc à zéro pour l'historique — conséquence assumée : le classement
-- « Fortune » couvre tout le passé, le classement « Rendement » n'a de sens
-- qu'à partir d'ici.
--
-- Le fuseau est nommé explicitement : la conversion doit tomber sur le jour
-- civil parisien, pas sur celui du serveur PostgreSQL.
INSERT INTO "game_stats_daily" ("user_id", "game", "day", "wagered", "returned", "net")
SELECT
  t."user_id",
  CASE
    WHEN t."reason" LIKE 'motus%'     THEN 'motus'
    WHEN t."reason" LIKE 'wheel%'     THEN 'wheel'
    WHEN t."reason" LIKE 'plinko%'    THEN 'plinko'
    WHEN t."reason" LIKE 'slots%'     THEN 'slots'
    WHEN t."reason" LIKE 'blackjack%' THEN 'blackjack'
    WHEN t."reason" LIKE 'roulette%'  THEN 'roulette'
    WHEN t."reason" LIKE 'poker%'     THEN 'poker'
    -- Puissance 4 et Morpion partagent les raisons `match_*` : seul le jeu de
    -- la partie référencée permet de les distinguer.
    ELSE m."game"
  END AS game,
  (t."created_at" AT TIME ZONE 'Europe/Paris')::date AS day,
  COALESCE(SUM(-t."delta") FILTER (WHERE t."delta" < 0), 0) AS wagered,
  COALESCE(SUM(t."delta")  FILTER (WHERE t."delta" > 0), 0) AS returned,
  COALESCE(SUM(t."delta"), 0) AS net
FROM "wallet_tx" t
LEFT JOIN "matches" m ON m."id" = t."match_id"
WHERE
  -- Bonus, ajustements et primes ne sont l'argent d'aucun jeu.
  t."reason" NOT IN ('signup_bonus', 'daily_bonus', 'admin_adjustment', 'achievement_reward')
  -- Une écriture `match_*` dont la partie a disparu n'est rattachable à rien.
  AND (t."reason" NOT LIKE 'match%' OR m."game" IS NOT NULL)
GROUP BY 1, 2, 3
ON CONFLICT ("user_id", "game", "day") DO NOTHING;--> statement-breakpoint
INSERT INTO "stats" ("user_id", "game", "wagered", "returned", "net")
SELECT "user_id", "game", SUM("wagered"), SUM("returned"), SUM("net")
FROM "game_stats_daily"
GROUP BY "user_id", "game"
ON CONFLICT ("user_id", "game") DO UPDATE SET
  "wagered"  = "stats"."wagered"  + EXCLUDED."wagered",
  "returned" = "stats"."returned" + EXCLUDED."returned",
  "net"      = "stats"."net"      + EXCLUDED."net";
