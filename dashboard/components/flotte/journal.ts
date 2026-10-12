// Journal de bord : chaque événement (déjà filtré par le serveur) devient une ligne lisible.
import type { Classe, Evt, Joueur, Regles } from "@/lib/flotte";

export type Fiche = { nom: string; classe: Classe; uid: string };
export type Annuaire = Map<string, Fiche>;
export type Ligne = { texte: string; ton: "bon" | "mauvais" | "neutre" | "alerte" };

export function texteEvt(e: Evt, a: Annuaire, moi: string | null, joueurs: Joueur[], regles: Regles): Ligne | null {
  const capitaine = (uid: string) => (uid === moi ? "toi" : joueurs.find((j) => j.uid === uid)?.nom ?? "un capitaine");
  const navire = (id: string | null) => {
    if (!id) return "un navire inconnu";
    const f = a.get(id);
    if (!f) return "un navire inconnu";
    const classe = regles.classes[f.classe].nom.toLowerCase();
    const [mon, le] = GENRES[f.classe];
    return f.uid === moi ? `${mon} ${classe} « ${f.nom} »` : `${le}${le.endsWith("'") ? "" : " "}${classe} « ${f.nom} » (${capitaine(f.uid)})`;
  };
  const a_moi = (id: string | null) => !!id && a.get(id)?.uid === moi;
  switch (e.t) {
    case "mouv":
      if (a_moi(e.id) || e.debut_vu !== false || e.fin_vue === false) return null;
      return { texte: `Voile en vue : ${navire(e.id)}.`, ton: "alerte" };
    case "choc":
      return { texte: `Éperonnage ! ${e.ids.map(navire).join(" et ")} se percutent (−1).`, ton: e.ids.some(a_moi) ? "mauvais" : "neutre" };
    case "recif":
      return { texte: `${maj(navire(e.id))} s'échoue sur un récif (−${e.degats}).`, ton: a_moi(e.id) ? "mauvais" : "neutre" };
    case "reparation":
      return { texte: `${maj(navire(e.id))} répare au port (+1).`, ton: a_moi(e.id) ? "bon" : "neutre" };
    case "tir_annule":
      return { texte: `${maj(navire(e.id))} ne tire pas : ${e.raison}.`, ton: "neutre" };
    case "tir": {
      if (!e.vers) return { texte: `${maj(navire(e.de))} fait feu vers le brouillard.`, ton: "alerte" };
      const qui = e.de ? navire(e.de) : "Un tir venu de l'ombre";
      const resultat = e.touche
        ? `touche ${navire(e.vers)} (−${e.degats}${e.critique ? ", coup au but" : ""})`
        : `manque ${navire(e.vers)}`;
      const chance = e.chance !== null ? ` — ${e.chance} %` : "";
      const ton = e.touche ? (a_moi(e.vers) ? "mauvais" : a_moi(e.de) ? "bon" : "neutre") : "neutre";
      return { texte: `${maj(qui)} ${resultat}${chance}.`, ton };
    }
    case "coule": {
      const par = e.par && e.par !== e.uid ? `, envoyé par le fond par ${capitaine(e.par)}` : "";
      const cause = e.cause === "abandon" ? " (sabordé)" : e.cause === "recif" ? " sur un récif" : e.cause === "choc" ? " après un choc" : "";
      return { texte: `${maj(navire(e.id))} sombre${cause}${par}.`, ton: e.uid === moi ? "mauvais" : e.par === moi ? "bon" : "neutre" };
    }
    case "elimine":
      return { texte: e.uid === moi ? "Ta flotte est anéantie." : `La flotte de ${capitaine(e.uid)} est anéantie.`, ton: e.uid === moi ? "mauvais" : "alerte" };
    case "abandon":
      return { texte: `${maj(capitaine(e.uid))} amène son pavillon (${e.raison}).`, ton: "alerte" };
  }
  return null;
}

// Déterminants selon le genre de la classe (« ton éclaireur », « ta frégate », « l'éclaireur »).
const GENRES: Record<Classe, [string, string]> = { eclaireur: ["ton", "l'"], fregate: ["ta", "la"], siege: ["ton", "le"] };

const maj = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
