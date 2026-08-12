import { z } from "zod";
import { emailSchema, passwordSchema, pseudoSchema } from "./auth.js";

/**
 * Modifications qu'un joueur peut faire sur son propre compte.
 *
 * Les règles de fond — longueur du pseudo, format de l'email, taille minimale du
 * mot de passe — ne sont pas réécrites ici : ce sont exactement celles de
 * l'inscription, importées telles quelles. Deux jeux de règles finiraient par
 * diverger, et c'est l'écart entre les deux qui deviendrait le bug.
 *
 * Aucun champ « mot de passe actuel » : la session connectée fait foi. C'est un
 * choix assumé, tracé ici pour qu'il se lise comme une décision et non comme un
 * oubli. Contrepartie retenue : le changement de mot de passe révoque les autres
 * sessions, et les routes sensibles sont plafonnées à dix requêtes par quart
 * d'heure.
 */

export const updateEmailSchema = z.object({ email: emailSchema });
export const updatePseudoSchema = z.object({ pseudo: pseudoSchema });
export const updatePasswordSchema = z.object({ password: passwordSchema });

/**
 * Mot à recopier pour fermer son compte.
 *
 * Un geste explicite plutôt qu'un mot de passe : ce qu'on cherche à éviter ici
 * n'est pas l'usurpation — la session en atteste déjà — mais le clic distrait
 * sur une action irréversible.
 */
export const DELETE_CONFIRMATION = "SUPPRIMER";

export const deleteAccountSchema = z.object({
  confirmation: z.literal(DELETE_CONFIRMATION, {
    errorMap: () => ({ message: `Recopie exactement « ${DELETE_CONFIRMATION} »` }),
  }),
});

export type UpdateEmailInput = z.infer<typeof updateEmailSchema>;
export type UpdatePseudoInput = z.infer<typeof updatePseudoSchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
