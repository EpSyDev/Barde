"use client";

import { useEffect, useRef, useState } from "react";
import { BUILTIN_MEDIA, type MediaItem } from "@/lib/media";

// Champ d'URL d'image + bouton ouvrant la bibliothèque média pour choisir sans
// copier-coller. Réutilisé dans les éditeurs d'embed (Messages, Accueil, Départ).
export default function MediaPicker({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [uploaded, setUploaded] = useState<MediaItem[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || uploaded) return;
    fetch("/api/fripouille/media", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setUploaded(d.media || []))
      .catch(() => setUploaded([]));
  }, [open, uploaded]);

  const items = uploaded ? [...BUILTIN_MEDIA, ...uploaded] : null;

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div className="media-field" ref={ref}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "https://… ou choisis dans la bibliothèque"}
      />
      <button
        type="button"
        className="btn"
        onClick={() => setOpen((o) => !o)}
        title="Choisir dans la bibliothèque média"
      >
        🖼️
      </button>
      {open && (
        <div className="media-pop">
          {!items ? (
            <div className="media-pop-empty">Chargement…</div>
          ) : items.length === 0 ? (
            <div className="media-pop-empty">
              Aucune image. Va dans « Média » pour en uploader.
            </div>
          ) : (
            <div className="media-pop-grid">
              <button
                type="button"
                className="media-pop-clear"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                ✕ Aucune image
              </button>
              {items.map((it) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={it.name}
                  src={it.url}
                  alt=""
                  className={value === it.url ? "sel" : ""}
                  onClick={() => {
                    onChange(it.url);
                    setOpen(false);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
