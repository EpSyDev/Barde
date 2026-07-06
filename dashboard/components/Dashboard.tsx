"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Track = {
  title: string | null;
  duration: number | null;
  live: boolean;
  thumb: string | null;
};

type Slot = {
  index: number;
  name: string;
  active: boolean;
  playing: boolean;
  paused: boolean;
  shuffle: boolean;
  pos: number;
  position: number;
  current: Track | null;
  queue: Track[];
  queue_len: number;
  baking: { pending: number; progress: number | null };
};

function fmt(sec: number | null | undefined): string {
  if (!sec || sec < 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export default function Dashboard() {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSlots(data.slots);
      setError(null);
    } catch {
      setError("Impossible de joindre les bardes.");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  const act = useCallback(
    async (index: number, action: string, body?: object) => {
      const key = `${index}:${action}`;
      setBusy((b) => ({ ...b, [key]: true }));
      try {
        await fetch(`/api/slot/${index}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
        await load();
      } finally {
        setBusy((b) => ({ ...b, [key]: false }));
      }
    },
    [load]
  );

  const removeTrack = useCallback(
    async (index: number, n: number) => {
      const key = `${index}:rm:${n}`;
      setBusy((b) => ({ ...b, [key]: true }));
      try {
        await fetch(`/api/slot/${index}/track/${n}/remove`, { method: "POST" });
        await load();
      } finally {
        setBusy((b) => ({ ...b, [key]: false }));
      }
    },
    [load]
  );

  const moveTrack = useCallback(
    async (index: number, n: number, dir: "up" | "down") => {
      const key = `${index}:mv:${n}`;
      setBusy((b) => ({ ...b, [key]: true }));
      try {
        await fetch(`/api/slot/${index}/track/${n}/move`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dir }),
        });
        await load();
      } finally {
        setBusy((b) => ({ ...b, [key]: false }));
      }
    },
    [load]
  );

  const moveToSlot = useCallback(
    async (src: number, n: number, dst: number) => {
      const key = `${src}:to:${n}`;
      setBusy((b) => ({ ...b, [key]: true }));
      try {
        await fetch(`/api/slot/${src}/track/${n}/to/${dst}`, { method: "POST" });
        await load();
      } finally {
        setBusy((b) => ({ ...b, [key]: false }));
      }
    },
    [load]
  );

  if (error && !slots) return <div className="empty-state">{error}</div>;
  if (!slots) return <div className="empty-state">Les bardes accordent leurs luths…</div>;

  return (
    <div className="grid">
      {slots.map((s) => (
        <SlotCard
          key={s.index}
          slot={s}
          allSlots={slots}
          act={act}
          removeTrack={removeTrack}
          moveTrack={moveTrack}
          moveToSlot={moveToSlot}
          busy={busy}
          fmt={fmt}
        />
      ))}
    </div>
  );
}

function SlotCard({
  slot,
  allSlots,
  act,
  removeTrack,
  moveTrack,
  moveToSlot,
  busy,
  fmt,
}: {
  slot: Slot;
  allSlots: Slot[];
  act: (i: number, a: string, b?: object) => void;
  removeTrack: (i: number, n: number) => void;
  moveTrack: (i: number, n: number, dir: "up" | "down") => void;
  moveToSlot: (src: number, n: number, dst: number) => void;
  busy: Record<string, boolean>;
  fmt: (s: number | null | undefined) => string;
}) {
  const [url, setUrl] = useState("");
  const cur = slot.current;
  const dur = cur?.duration ?? null;
  const pct = dur && dur > 0 ? Math.min(100, (slot.position / dur) * 100) : 0;
  const isBusy = (a: string) => !!busy[`${slot.index}:${a}`];

  const stateLabel = slot.paused
    ? "en pause"
    : slot.playing
      ? "à l'antenne"
      : slot.active
        ? "en attente"
        : "silence";
  const stateClass = slot.paused ? "paused" : slot.playing ? "live" : "";

  const submitUrl = () => {
    const v = url.trim();
    if (!v) return;
    act(slot.index, "add", { url: v });
    setUrl("");
  };

  return (
    <div className={`card ${slot.playing ? "on" : ""}`}>
      <div className="card-head">
        <h2>{slot.name}</h2>
        <span className={`state-dot ${stateClass}`}>{stateLabel}</span>
      </div>

      <div className="now">
        {cur?.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="thumb" src={cur.thumb} alt="" />
        ) : (
          <div className="thumb empty">🎵</div>
        )}
        <div className="now-meta">
          <div className="now-title">{cur?.title || "Aucune piste"}</div>
          <div className="now-sub">
            {cur
              ? cur.live
                ? "🔴 Direct"
                : `${fmt(slot.position)} / ${fmt(dur)}`
              : "File vide"}
          </div>
        </div>
      </div>

      <div className="progress">
        <i style={{ width: `${pct}%` }} />
      </div>

      <div className="controls">
        {slot.playing || slot.active ? (
          <button
            className="btn"
            disabled={isBusy("stop")}
            onClick={() => act(slot.index, "stop")}
          >
            ⏹ Stop
          </button>
        ) : (
          <button
            className="btn primary"
            disabled={isBusy("play") || slot.queue_len === 0}
            onClick={() => act(slot.index, "play")}
          >
            ▶ Lancer
          </button>
        )}

        {slot.paused ? (
          <button
            className="btn"
            disabled={isBusy("resume")}
            onClick={() => act(slot.index, "resume")}
          >
            ▶ Reprendre
          </button>
        ) : (
          <button
            className="btn icon"
            disabled={isBusy("pause") || !slot.playing}
            onClick={() => act(slot.index, "pause")}
            title="Pause"
          >
            ⏸
          </button>
        )}

        <button
          className="btn icon"
          disabled={isBusy("next") || slot.queue_len === 0}
          onClick={() => act(slot.index, "next")}
          title="Suivant"
        >
          ⏭
        </button>

        <button
          className={`btn icon ${slot.shuffle ? "on" : ""}`}
          disabled={isBusy("shuffle")}
          onClick={() => act(slot.index, "shuffle")}
          title="Aléatoire"
        >
          🔀
        </button>
      </div>

      <div className="add-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitUrl()}
          placeholder="Coller un lien YouTube…"
        />
        <button
          className="btn primary"
          disabled={isBusy("add") || !url.trim()}
          onClick={submitUrl}
        >
          Ajouter
        </button>
      </div>

      <div className="queue-count">
        <span>📜 {slot.queue_len} piste{slot.queue_len > 1 ? "s" : ""} en file</span>
        {slot.baking.pending > 0 && (
          <span className="baking">
            · ⚙ préparation
            {slot.baking.progress != null ? ` ${slot.baking.progress}%` : "…"}
          </span>
        )}
      </div>

      {slot.queue.length > 0 && (
        <ul className="queue-list">
          {slot.queue.map((t, i) => (
            <li key={i} className={i === slot.pos ? "playing" : ""}>
              <span className="q-idx">{i === slot.pos ? "▶" : i + 1}</span>
              <span className="q-title" title={t.title || ""}>
                {t.title || "—"}
              </span>
              <span className="q-dur">{t.live ? "🔴" : fmt(t.duration)}</span>
              <button
                className="q-move"
                title="Monter"
                disabled={i === 0 || isBusy(`mv:${i}`)}
                onClick={() => moveTrack(slot.index, i, "up")}
              >
                ▲
              </button>
              <button
                className="q-move"
                title="Descendre"
                disabled={i === slot.queue.length - 1 || isBusy(`mv:${i}`)}
                onClick={() => moveTrack(slot.index, i, "down")}
              >
                ▼
              </button>
              {allSlots.length > 1 && (
                <select
                  className="q-to"
                  value=""
                  disabled={isBusy(`to:${i}`)}
                  title="Basculer vers un autre salon"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) moveToSlot(slot.index, i, Number(v));
                  }}
                >
                  <option value="">⇄</option>
                  {allSlots
                    .filter((s) => s.index !== slot.index)
                    .map((s) => (
                      <option key={s.index} value={s.index}>
                        → {s.name}
                      </option>
                    ))}
                </select>
              )}
              <button
                className="q-del"
                title="Retirer de la file"
                disabled={isBusy(`rm:${i}`)}
                onClick={() => removeTrack(slot.index, i)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
