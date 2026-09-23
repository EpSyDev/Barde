"use client";

// Le triptyque « charger / modifier / enregistrer » d'un module, écrit une fois.
//
// Avant, chaque écran le recodait avec ses propres `busy`/`okCard`/`error` — cinq
// copies littérales de « Chargement de la config… » — et surtout : rien ne savait
// qu'un brouillon était en cours. On pouvait quitter un onglet et tout perdre en
// silence. Ici l'état `dirty` est la source de vérité, et c'est lui qui alimente la
// barre d'enregistrement et le garde-fou de fermeture d'onglet.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToasts } from "@/components/Toasts";

export type ModuleState<T> = {
  /** Valeurs affichées et éditées (brouillon). `null` tant que le chargement dure. */
  draft: T | null;
  /** Dernières valeurs connues du bot — sert de point de comparaison et d'annulation. */
  saved: T | null;
  /** Modifie une clé du brouillon. */
  patch: (values: Partial<T>) => void;
  /** Remplace tout le brouillon (utile pour les listes). */
  setDraft: (next: T) => void;
  dirty: boolean;
  /** Champs réellement différents de l'enregistré. */
  dirtyKeys: string[];
  saving: boolean;
  loading: boolean;
  error: string | null;
  /** Enregistre le brouillon. Renvoie true en cas de succès. */
  save: () => Promise<boolean>;
  /** Revient aux dernières valeurs enregistrées. */
  reset: () => void;
  /** Recharge depuis le bot (écrase le brouillon). */
  reload: () => Promise<void>;
};

/** Comparaison structurelle : suffisante pour de la config JSON, et sans dépendance. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useModuleConfig<T extends object>(
  module: string,
  /** Normalise la réponse du bot (IDs en chaînes, défauts…) avant de l'afficher. */
  normalize?: (raw: Record<string, unknown>) => T,
  /** Nettoie le brouillon avant l'envoi (trim, lignes vides écartées…). Le brouillon
   *  affiché, lui, n'est jamais modifié pendant la frappe. */
  serialize?: (draft: T) => object
): ModuleState<T> {
  const [saved, setSaved] = useState<T | null>(null);
  const [draft, setDraftState] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toasts = useToasts();
  // `normalize` est souvent une lambda recréée à chaque rendu : on la fige pour que
  // le chargement ne se relance pas en boucle.
  const norm = useRef(normalize);
  norm.current = normalize;
  const ser = useRef(serialize);
  ser.current = serialize;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/fripouille/config/${module}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const raw = await res.json();
      const value = (norm.current ? norm.current(raw) : raw) as T;
      setSaved(value);
      setDraftState(value);
      setError(null);
    } catch {
      setError("La Fripouille est injoignable.");
    } finally {
      setLoading(false);
    }
  }, [module]);

  useEffect(() => {
    reload();
  }, [reload]);

  const patch = useCallback((values: Partial<T>) => {
    setDraftState((d) => (d ? { ...d, ...values } : d));
  }, []);

  const setDraft = useCallback((next: T) => setDraftState(next), []);

  const dirtyKeys = useMemo(() => {
    if (!draft || !saved) return [];
    return Object.keys(draft).filter(
      (k) => !same((draft as Record<string, unknown>)[k], (saved as Record<string, unknown>)[k])
    );
  }, [draft, saved]);

  const dirty = dirtyKeys.length > 0;

  const save = useCallback(async () => {
    if (!draft) return false;
    setSaving(true);
    try {
      const res = await fetch(`/api/fripouille/config/${module}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ser.current ? ser.current(draft) : draft),
      });
      if (!res.ok) throw new Error();
      const data = await res.json().catch(() => null);
      const next = (data?.config
        ? norm.current
          ? norm.current(data.config)
          : data.config
        : draft) as T;
      setSaved(next);
      setDraftState(next);
      setError(null);
      toasts.ok("Consigné", "Le bot applique la nouvelle configuration.");
      return true;
    } catch {
      setError("Échec de l'enregistrement.");
      toasts.err("Rien n'a été enregistré", "Le bot n'a pas répondu — tes modifications sont toujours là.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, module, toasts]);

  const reset = useCallback(() => setDraftState(saved), [saved]);

  return {
    draft, saved, patch, setDraft, dirty, dirtyKeys,
    saving, loading, error, save, reset, reload,
  };
}

/** Empêche la fermeture de l'onglet tant qu'un brouillon n'est pas enregistré. */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}

/** Appel d'action ponctuelle d'un module (`/api/action/{module}/{action}`). */
export async function runAction<T = Record<string, unknown>>(
  module: string,
  action: string,
  body: object = {}
): Promise<T> {
  const res = await fetch(`/api/fripouille/action/${module}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || "action refusée");
  return data as T;
}
