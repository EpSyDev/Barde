"use client";

// Connexion temps réel des Flottes Royales : ticket délivré par le dashboard (session
// Discord vérifiée), puis flux SSE direct sur La Fripouille — le quai (salon = null) ou la
// vue filtrée d'un salon. Reconnexion automatique ; ticket renouvelé si le bot l'a oublié
// (redémarrage) ; l'heure du serveur fait foi pour les comptes à rebours.

import { useCallback, useEffect, useRef, useState } from "react";
import type { VueQuai, VueSalon } from "@/lib/flotte";

type Urls = { flux_url: string; op_url: string };
export type Liaison = "connexion" | "direct" | "perdue";
export type Reponse = { ok: boolean; salon?: string; code?: string; erreur?: string };

export function useFlotte(salon: string | null, surFermeture: () => void) {
  const [vue, setVue] = useState<VueQuai | VueSalon | null>(null);
  const [liaison, setLiaison] = useState<Liaison>("connexion");
  const [erreur, setErreur] = useState<string | null>(null);
  const urls = useRef<Urls | null>(null);
  const decalage = useRef(0);
  const fermeture = useRef(surFermeture);
  fermeture.current = surFermeture;

  const ticket = useCallback(async (): Promise<Urls | null> => {
    const r = await fetch("/api/flotte/ticket", { method: "POST" });
    if (r.status === 401) {
      window.location.href = "/login?callbackUrl=/flotte";
      return null;
    }
    if (r.status === 403) {
      const e = await r.json().catch(() => ({}));
      setErreur(e.error || "Accès refusé.");
      return null;
    }
    if (!r.ok) throw new Error(String(r.status));
    urls.current = await r.json();
    return urls.current;
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let vivant = true;
    let echecs = 0;
    let recu = false;
    let relance: ReturnType<typeof setTimeout> | null = null;
    setVue(null);
    const plusTard = (ms: number) => {
      if (relance) clearTimeout(relance);
      if (vivant) relance = setTimeout(connecter, ms);
    };
    const connecter = async () => {
      es?.close();
      try {
        // Après deux échecs d'affilée, le bot a pu redémarrer : on redemande un ticket.
        const u = urls.current && echecs < 2 ? urls.current : await ticket();
        if (!u || !vivant) return;
        es = new EventSource(u.flux_url + (salon ? `&salon=${encodeURIComponent(salon)}` : ""));
        es.onopen = () => { setLiaison("direct"); setErreur(null); echecs = 0; };
        es.onerror = () => {
          setLiaison("perdue");
          if (es?.readyState === EventSource.CLOSED) {
            echecs++;
            // Un salon qui n'a jamais répondu n'existe plus (404) : retour au quai.
            if (salon && !recu && echecs >= 2) { fermeture.current(); return; }
            plusTard(Math.min(10000, 1500 * echecs));
          }
        };
        es.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.type === "ferme") { fermeture.current(); return; }
          recu = true;
          if (typeof m.maintenant === "number") decalage.current = m.maintenant - Date.now() / 1000;
          setVue(m);
        };
      } catch {
        setLiaison("perdue");
        echecs++;
        plusTard(Math.min(10000, 2000 * echecs));
      }
    };
    connecter();
    return () => { vivant = false; if (relance) clearTimeout(relance); es?.close(); };
  }, [salon, ticket]);

  const op = useCallback(async (corps: Record<string, unknown>): Promise<Reponse> => {
    try {
      const u = urls.current ?? (await ticket());
      if (!u) return { ok: false, erreur: "Pas de ticket de capitaine." };
      let r = await fetch(u.op_url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
      if (r.status === 401) {                       // ticket oublié par le bot : un neuf, et on rejoue
        const n = await ticket();
        if (!n) return { ok: false, erreur: "Session expirée." };
        r = await fetch(n.op_url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
      }
      const d = await r.json().catch(() => ({}));
      return r.ok ? { ok: true, ...d } : { ok: false, erreur: d.error || "Geste refusé." };
    } catch {
      return { ok: false, erreur: "La Fripouille ne répond pas." };
    }
  }, [ticket]);

  const maintenant = useCallback(() => Date.now() / 1000 + decalage.current, []);

  return { vue, liaison, erreur, op, maintenant };
}
