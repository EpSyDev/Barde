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
        // Ticket à usage unique puis upload direct navigateur → Funnel : évite la
        // limite de taille de requête des fonctions serverless Vercel (~4,5 Mo), trop
        // juste pour un audio de quelques Mo.
        const ticketRes = await fetch("/api/fripouille/media/upload-ticket", { method: "POST" });
        if (!ticketRes.ok) throw new Error();
        const { upload_url } = await ticketRes.json();
        if (!upload_url) throw new Error();
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(upload_url, { method: "POST", body: form });
        if (!res.ok) throw new Error();
        await load();
      } catch {
        setError("Échec de l'upload (images : png/jpg/gif/webp max 8 Mo · audio : mp3/ogg/wav/m4a max 10 Mo).");
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [load]
  );

  const remove = useCallback(
    async (name: string) => {
      if (!window.confirm("Supprimer définitivement ce fichier ?")) return;
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

  const rename = useCallback(
    async (it: MediaItem) => {
      const label = window.prompt("Nouveau nom", it.label || it.name);
      if (label === null || label.trim() === (it.label || it.name)) return;
      try {
        const res = await fetch("/api/fripouille/media/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: it.name, label: label.trim() }),
        });
        if (!res.ok) throw new Error();
        await load();
      } catch {
        setError("Échec du renommage.");
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
            Uploade des images (vignette, grande image) ou des audios (mp3, ogg, wav, m4a) à
            réutiliser dans les messages. Copie l'URL et colle-la dans le champ correspondant,
            ou choisis directement depuis la bibliothèque intégrée à l'éditeur.
          </p>
        </div>
        <label className="btn primary" style={{ cursor: "pointer" }}>
          {uploading ? "Upload en cours…" : "＋ Ajouter un fichier"}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,audio/mpeg,audio/ogg,audio/wav,audio/x-m4a,audio/mp4,.mp3,.ogg,.wav,.m4a"
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
            {it.kind === "audio" ? (
              <audio controls src={it.url} style={{ width: "100%" }} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.url} alt="" />
            )}
            <div className="media-name" title={it.name}>
              {it.label || it.name}
            </div>
            {it.builtin && <span className="media-badge">intégrée</span>}
            <div className="media-actions">
              <button className="btn" onClick={() => copy(it.url)}>
                {copied === it.url ? "✓ Copié" : "Copier l'URL"}
              </button>
              {!it.builtin && (
                <>
                  <button className="btn icon" title="Renommer" onClick={() => rename(it)}>
                    ✎
                  </button>
                  <button
                    className="btn icon danger"
                    title="Supprimer"
                    onClick={() => remove(it.name)}
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
