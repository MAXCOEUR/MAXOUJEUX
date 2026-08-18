-- Les anciens flags n'avaient ni historique ni auteur. On crée un ban compte
-- permanent révocable ; l'administrateur existant en devient l'auteur quand il
-- existe, sinon le compte ciblé sert uniquement de provenance technique.
INSERT INTO "moderation_bans" (
  "kind",
  "target_user_id",
  "target_value",
  "reason",
  "created_by"
)
SELECT
  'account',
  legacy."id",
  legacy."id"::text,
  'Bannissement historique migré',
  COALESCE(
    (SELECT admin."id" FROM "users" admin WHERE admin."role" = 'admin' LIMIT 1),
    legacy."id"
  )
FROM "users" legacy
WHERE legacy."is_banned" = true
  AND legacy."role" <> 'admin'
  AND NOT EXISTS (
    SELECT 1
    FROM "moderation_bans" existing
    WHERE existing."kind" = 'account'
      AND existing."target_value" = legacy."id"::text
  );
--> statement-breakpoint
-- Un administrateur hérité doit rester accessible même si les anciennes
-- colonnes contenaient une combinaison incohérente.
UPDATE "users" SET "is_banned" = false WHERE "role" = 'admin';
