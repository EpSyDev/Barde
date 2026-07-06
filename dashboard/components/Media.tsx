"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BUILTIN_MEDIA, type MediaItem } from "@/lib/media";

export default function Media() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/fripouille/media", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setItems(d.media || []);
      setError(null);
    } catch {
      setError("La Fripouille est injoignable.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const upload = useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/fripouille/media/upload", { method: "POST", body: form });
        if (!res.ok) throw new Error();
        await load();
      } catch {
        setError("Échec de l'upload (formats png/jpg/gif/webp, max 8 Mo).");
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [load]
  );

  const remove = useCallback(
    async (name: string) => {
      if (!window.confirm("Supprimer définitivement cette image ?")) return;
      try {
        await fetch("/api/fripouille/media/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        await load();
      } catch {
        /* ignore */
      }
    },
    [load]
  );

  const copy = (url: string) => {
    navigator.clipboard?.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied((c) => (c === url ? null : c)), 1500);
  };

  if (error && !items) return <div className="empty-state">{error}</div>;
  if (!items) return <div className="empty-state">Chargement…</div>;

  return (
    <div>
      <section className="cfg-card" style={{ marginBottom: 20 }}>
        <div className="cfg-card-head">
          <h2>🖼️ Média</h2>
          <p>
            Uploade des images à réutiliser dans les embeds (vignette ou grande image). Copie
            l'URL et colle-la dans le champ « Image » d'un message.
          </p>
        </div>
        <label className="btn primary" style={{ cursor: "pointer" }}>
          {uploading ? "Upload en cours…" : "＋ Choisir une image"}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            disabled={uploading}
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
            }}
          />
        </label>
        {error && <span className="cfg-err" style={{ marginLeft: 12 }}>{error}</span>}
      </section>

      <div className="media-grid">
        {[...BUILTIN_MEDIA, ...items].map((it) => (
          <div className="media-item" key={it.url}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.url} alt="" />
            {it.builtin && <span className="media-badge">intégrée</span>}
            <div className="media-actions">
              <button className="btn" onClick={() => copy(it.url)}>
                {copied === it.url ? "✓ Copié" : "Copier l'URL"}
              </button>
              {!it.builtin && (
                <button
                  className="btn icon danger"
                  title="Supprimer"
                  onClick={() => remove(it.name)}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
