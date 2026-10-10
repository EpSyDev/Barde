"use client";

// Mentions Discord dans les champs de message : insérer un rôle ou un salon en deux
// clics (bouton « @ Rôle » / « # Salon », ou en tapant @ / # directement dans le texte),
// et aperçu qui affiche ces mentions comme Discord (pastilles colorées) au lieu des
// codes bruts <@&id> / <#id>.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";

export type GuildRole = { id: string; name: string; color: number };
export type GuildChannel = { id: string; name: string; category: string | null };
type Refs = { roles: GuildRole[]; channels: GuildChannel[] };

// Une seule requête par chargement de page, partagée par tous les champs.
let cache: Promise<Refs> | null = null;
function chargerRefs(): Promise<Refs> {
  if (!cache) {
    cache = Promise.all([
      fetch("/api/fripouille/roles", { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})),
      fetch("/api/fripouille/channels", { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})),
    ])
      .then(([r, c]: Partial<Refs>[]) => ({ roles: r.roles || [], channels: c.channels || [] }))
      .catch(() => {
        cache = null;
        return { roles: [], channels: [] };
      });
  }
  return cache;
}

export function useGuildRefs(): Refs {
  const [refs, setRefs] = useState<Refs>({ roles: [], channels: [] });
  useEffect(() => {
    let vivant = true;
    chargerRefs().then((r) => vivant && setRefs(r));
    return () => {
      vivant = false;
    };
  }, []);
  return refs;
}

const hex = (c: number) => (c ? `#${c.toString(16).padStart(6, "0")}` : "#99aab5");
const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ─────────────────────────── Sélecteur de salon groupé ───────────────────────────
/** Options d'un <select> de salons, rangées par catégorie (<optgroup>) : le libellé
 *  reste court (« #salon ») au lieu de « #salon (🛖 ▌ NOM DE CATÉGORIE) » tronqué. */
export function channelOptions(channels: GuildChannel[], hash = true) {
  const m = new Map<string, GuildChannel[]>();
  for (const c of channels) {
    const k = c.category || "Sans catégorie";
    m.set(k, [...(m.get(k) || []), c]);
  }
  return [...m.entries()].map(([cat, list]) => (
    <optgroup key={cat} label={cat}>
      {list.map((c) => (
        <option key={c.id} value={c.id}>
          {hash ? "#" : ""}
          {c.name}
        </option>
      ))}
    </optgroup>
  ));
}

export function ChannelSelect({
  channels,
  value,
  onChange,
  disabled,
  placeholder = "— Salon —",
}: {
  channels: GuildChannel[];
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const groupes = useMemo(() => {
    const m = new Map<string, GuildChannel[]>();
    for (const c of channels) {
      const k = c.category || "Sans catégorie";
      m.set(k, [...(m.get(k) || []), c]);
    }
    return [...m.entries()];
  }, [channels]);
  return (
    <select value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {groupes.map(([cat, list]) => (
        <optgroup key={cat} label={cat}>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// ─────────────────────────── Champ avec insertion de mentions ───────────────────────────
type Kind = "role" | "salon";
type Item = { token: string; label: string; sub?: string; color?: string };
type Picker = { kind: Kind; query: string; start: number | null };

const SPECIAUX: Item[] = [
  { token: "@everyone", label: "everyone", sub: "tout le serveur", color: "#f0b232" },
  { token: "@here", label: "here", sub: "membres en ligne", color: "#f0b232" },
];

export function MentionField({
  value,
  onChange,
  multiline,
  rows = 3,
  placeholder,
  max,
  embed,
}: {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  /** Limite Discord du champ (compteur affiché). */
  max?: number;
  /** Champ d'embed : les mentions s'y affichent mais ne notifient personne. */
  embed?: boolean;
}) {
  const { roles, channels } = useGuildRefs();
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const caret = useRef(0);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [sel, setSel] = useState(0);

  const items = useMemo<Item[]>(() => {
    if (!picker) return [];
    const q = norm(picker.query);
    const base: Item[] =
      picker.kind === "role"
        ? [
            ...SPECIAUX,
            ...roles.map((r) => ({ token: `<@&${r.id}>`, label: r.name, color: hex(r.color) })),
          ]
        : channels.map((c) => ({ token: `<#${c.id}>`, label: c.name, sub: c.category || undefined }));
    return base.filter((it) => !q || norm(it.label).includes(q)).slice(0, 8);
  }, [picker, roles, channels]);

  useEffect(() => setSel(0), [picker?.kind, picker?.query]);

  // Ferme le sélecteur au clic en dehors du champ.
  const boite = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!picker) return;
    const off = (e: MouseEvent) => {
      if (!boite.current?.contains(e.target as Node)) setPicker(null);
    };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [picker]);

  /** Repère un « @mot » / « #mot » en cours de frappe juste avant le curseur. */
  const detecter = (texte: string, pos: number) => {
    const avant = texte.slice(0, pos);
    const m = /(^|\s)([@#])([^\s@#<>]{0,32})$/.exec(avant);
    if (!m) {
      if (picker?.start != null) setPicker(null);
      return;
    }
    setPicker({ kind: m[2] === "@" ? "role" : "salon", query: m[3], start: pos - m[3].length - 1 });
  };

  const inserer = (it: Item) => {
    const el = ref.current;
    const fin = picker?.start != null ? el?.selectionStart ?? value.length : caret.current;
    const debut = picker?.start != null ? picker.start : caret.current;
    const ajout = `${it.token} `;
    const next = value.slice(0, debut) + ajout + value.slice(fin);
    onChange(next);
    setPicker(null);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const p = debut + ajout.length;
      el.setSelectionRange(p, p);
    });
  };

  const ouvrir = (kind: Kind) => {
    caret.current = ref.current?.selectionStart ?? value.length;
    setPicker(picker?.kind === kind && picker.start == null ? null : { kind, query: "", start: null });
  };

  const clavier = (e: React.KeyboardEvent) => {
    if (!picker || items.length === 0) {
      if (e.key === "Escape" && picker) setPicker(null);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => (s + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      inserer(items[sel]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setPicker(null);
    }
  };

  const champ = {
    ref,
    value,
    placeholder,
    onKeyDown: clavier,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      onChange(e.target.value);
      detecter(e.target.value, e.target.selectionStart ?? e.target.value.length);
    },
  };
  const aMention = /<@&\d+>|<#\d+>|@everyone|@here/.test(value);

  return (
    <div className="mention-field" ref={boite}>
      <div className="mention-bar">
        <button type="button" className={`mention-btn ${picker?.kind === "role" ? "on" : ""}`} onClick={() => ouvrir("role")}>
          @ Rôle
        </button>
        <button type="button" className={`mention-btn ${picker?.kind === "salon" ? "on" : ""}`} onClick={() => ouvrir("salon")}>
          # Salon
        </button>
        {max != null && (
          <span className={`mention-count ${value.length > max ? "over" : ""}`}>
            {value.length}/{max}
          </span>
        )}
      </div>
      {multiline ? <textarea rows={rows} {...champ} /> : <input type="text" {...champ} />}

      {picker && (
        <div className="mention-pop" role="listbox">
          {picker.start == null && (
            <input
              autoFocus
              className="mention-search"
              placeholder={picker.kind === "role" ? "Chercher un rôle…" : "Chercher un salon…"}
              value={picker.query}
              onChange={(e) => setPicker({ ...picker, query: e.target.value })}
              onKeyDown={clavier}
            />
          )}
          {items.length === 0 ? (
            <div className="mention-empty">Aucun résultat</div>
          ) : (
            items.map((it, i) => (
              <button
                type="button"
                key={it.token}
                role="option"
                aria-selected={i === sel}
                className={`mention-opt ${i === sel ? "sel" : ""}`}
                onMouseEnter={() => setSel(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => inserer(it)}
              >
                {picker.kind === "role" ? (
                  <span className="mention-dot" style={{ background: it.color }} />
                ) : (
                  <span className="mention-hash">#</span>
                )}
                <span className="mention-name">{it.label}</span>
                {it.sub && <span className="mention-sub">{it.sub}</span>}
              </button>
            ))
          )}
        </div>
      )}
      {embed && aMention && (
        <p className="cfg-hint">
          Dans un embed, les mentions s&apos;affichent mais ne notifient personne : mets-les dans le
          texte hors embed pour pinger.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────── Rendu façon Discord ───────────────────────────
// Sous-ensemble utile : mentions, **gras**, *italique*, __souligné__, ~~barré~~, `code`.
const MOTIF =
  /(<@&\d+>|<#\d+>|<@!?\d+>|@everyone|@here|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`)/g;

export function DiscordText({ text }: { text: string }) {
  const { roles, channels } = useGuildRefs();
  const parts = text.split(MOTIF);
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{p}</Fragment>;
        let m: RegExpExecArray | null;
        if ((m = /^<@&(\d+)>$/.exec(p))) {
          const r = roles.find((x) => x.id === m![1]);
          const c = hex(r?.color ?? 0);
          return (
            <span key={i} className="dc-mention" style={{ color: c, background: `${c}26` }}>
              @{r?.name ?? "rôle-inconnu"}
            </span>
          );
        }
        if ((m = /^<#(\d+)>$/.exec(p))) {
          const c = channels.find((x) => x.id === m![1]);
          return (
            <span key={i} className="dc-mention">
              #{c?.name ?? "salon-inconnu"}
            </span>
          );
        }
        if (/^<@!?\d+>$/.test(p)) return <span key={i} className="dc-mention">@membre</span>;
        if (p === "@everyone" || p === "@here") return <span key={i} className="dc-mention">{p}</span>;
        if (p.startsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("__")) return <u key={i}>{p.slice(2, -2)}</u>;
        if (p.startsWith("~~")) return <s key={i}>{p.slice(2, -2)}</s>;
        if (p.startsWith("`")) return <code key={i} className="dc-code">{p.slice(1, -1)}</code>;
        return <em key={i}>{p.slice(1, -1)}</em>;
      })}
    </>
  );
}
