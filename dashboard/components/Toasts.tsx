"use client";

// Un seul endroit où une confirmation ou une erreur peut apparaître. Avant, chaque
// écran gardait son propre `okCard`/`error` local : l'information s'affichait à
// l'endroit où on ne regardait pas, et disparaissait sans trace.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Icon, { IconName } from "@/components/Icon";

type Kind = "ok" | "err" | "info";
type Toast = { id: number; kind: Kind; title: string; body?: string };

type Api = {
  /** Confirmation courte — disparaît seule au bout de 4 s. */
  ok: (title: string, body?: string) => void;
  /** Échec — reste 8 s, le temps de le lire vraiment. */
  err: (title: string, body?: string) => void;
  info: (title: string, body?: string) => void;
};

const ToastCtx = createContext<Api | null>(null);

const ICON: Record<Kind, IconName> = { ok: "sceau", err: "alerte", info: "plume" };
const DELAY: Record<Kind, number> = { ok: 4000, err: 8000, info: 5000 };

export function useToasts(): Api {
  const api = useContext(ToastCtx);
  if (!api) throw new Error("useToasts hors de <ToastProvider>");
  return api;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setList((l) => l.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (kind: Kind, title: string, body?: string) => {
      const id = ++seq.current;
      setList((l) => [...l.slice(-3), { id, kind, title, body }]);
      timers.current.set(id, setTimeout(() => dismiss(id), DELAY[kind]));
    },
    [dismiss]
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach(clearTimeout);
  }, []);

  const api: Api = {
    ok: (t, b) => push("ok", t, b),
    err: (t, b) => push("err", t, b),
    info: (t, b) => push("info", t, b),
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span className="toast-icon">
              <Icon name={ICON[t.kind]} />
            </span>
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              {t.body && <div>{t.body}</div>}
            </div>
            <button
              className="toast-close"
              onClick={() => dismiss(t.id)}
              aria-label="Fermer"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
