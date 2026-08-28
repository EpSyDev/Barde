// Applique en direct sur GitHub les éditions de hotspots faites en jeu (touche S de l'éditeur F2
// — MYRHAVEN, admin uniquement, voir `RectEditor.save()` côté jeu). Le dashboard n'a pas ce repo
// sur disque : au lieu d'écrire un fichier local (`dev/rect-writer-core.mjs`, exécuté en dev ou
// collé à la main via `scripts/apply-rects.mjs`), on lit/écrit directement via l'API GitHub.
//
// Les fonctions de réécriture pure (escapeRegExp, findObjectRange, setField, ...) sont une copie
// fidèle de `dev/rect-writer-core.mjs` du repo `myrhaven-point-and-click` — à garder synchronisées
// si l'une des deux évolue (nouveau champ édité par l'éditeur F2, etc.).

const OWNER = "EpSyDev";
const REPO = "myrhaven-point-and-click";
const BRANCH = "master";
const MAP_FILE = "src/data/map/zones.ts";
const LOCATIONS_DIR = "src/data/locations";

const TOKEN = process.env.GAME_RECTS_GITHUB_TOKEN || "";

export interface RectPayload {
  target: { kind: "location" | "map"; id: string };
  rects: Array<{
    id: string;
    isNew?: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    targetLocationId?: string;
    arrowAngle?: number;
    arrowOffsetX?: number;
    arrowOffsetY?: number;
  }>;
  deleted: string[];
}

export interface ApplyResult {
  file: string;
  updated: number;
  created: number;
  deleted: number;
}

// --- accès GitHub ------------------------------------------------------------

function ghHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghGet(path: string): Promise<any> {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/${path}`, {
    headers: ghHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`GitHub GET ${path} — ${res.status}`);
  }
  return res.json();
}

async function getFile(path: string): Promise<{ content: string; sha: string } | null> {
  try {
    const data = await ghGet(`contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${BRANCH}`);
    return { content: Buffer.from(data.content, "base64").toString("utf8"), sha: data.sha };
  } catch {
    return null;
  }
}

async function putFile(path: string, content: string, sha: string, message: string): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`,
    {
      method: "PUT",
      headers: { ...ghHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        sha,
        branch: BRANCH,
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub PUT ${path} — ${res.status} ${body}`);
  }
}

async function listLocationFiles(): Promise<string[]> {
  const tree = await ghGet(`git/trees/${BRANCH}?recursive=1`);
  const entries = (tree.tree ?? []) as Array<{ path: string; type: string }>;
  return entries
    .filter((entry) => entry.type === "blob" && entry.path.startsWith(`${LOCATIONS_DIR}/`) && entry.path.endsWith(".ts"))
    .map((entry) => entry.path);
}

async function resolveSourceFile(target: RectPayload["target"]): Promise<string> {
  if (target.kind === "map") {
    return MAP_FILE;
  }
  const needle = new RegExp(`\\bid:\\s*'${escapeRegExp(target.id)}'`);
  const candidates = await listLocationFiles();
  for (const path of candidates) {
    const file = await getFile(path);
    if (file && needle.test(file.content)) {
      return path;
    }
  }
  throw new Error(`aucun fichier de lieu ne déclare id: '${target.id}'`);
}

// --- réécriture pure (copie de dev/rect-writer-core.mjs, repo du jeu) --------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findObjectRange(source: string, id: string): { start: number; end: number } | null {
  const match = new RegExp(`\\bid:\\s*'${escapeRegExp(id)}'`).exec(source);
  if (!match) {
    return null;
  }
  const start = source.lastIndexOf("{", match.index);
  if (start < 0) {
    return null;
  }
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") {
      depth += 1;
    } else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return { start, end: i + 1 };
      }
    }
  }
  return null;
}

function setRawField(objectText: string, key: string, rawValue: string, existingValuePattern: string): string {
  const existing = new RegExp(`(\\b${key}:\\s*)(${existingValuePattern})`);
  if (existing.test(objectText)) {
    return objectText.replace(existing, `$1${rawValue}`);
  }
  const closing = objectText.lastIndexOf("}");
  const body = objectText.slice(0, closing);
  // La virgule ajoutée plus bas est inconditionnelle : si le dernier champ portait déjà une
  // virgule finale, il ne faut pas la garder sous peine d'une virgule double (même bug que
  // `dev/rect-writer-core.mjs` a connu côté jeu le 28/08/2026).
  const head = body.replace(/\s+$/, "").replace(/,$/, "");
  const gap = body.slice(head.length);
  if (!objectText.includes("\n")) {
    return `${head},${gap || " "}${key}: ${rawValue} }`;
  }
  const indentMatch = /\n([ \t]+)\S/.exec(objectText);
  const indent = indentMatch ? indentMatch[1] : "  ";
  return `${head},\n${indent}${key}: ${rawValue}${gap}}`;
}

function setField(objectText: string, key: string, value: number): string {
  return setRawField(objectText, key, String(value), "-?\\d+(?:\\.\\d+)?");
}

function setStringField(objectText: string, key: string, value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return setRawField(objectText, key, `'${escaped}'`, "'(?:[^'\\\\]|\\\\.)*'");
}

function removeField(objectText: string, key: string): string {
  const multiline = new RegExp(`\\n[ \\t]*${key}:\\s*[^\\n]*`);
  if (multiline.test(objectText)) {
    return objectText.replace(multiline, "");
  }
  const inline = new RegExp(`\\s*${key}:\\s*(?:-?\\d+(?:\\.\\d+)?|'(?:[^'\\\\]|\\\\.)*')\\s*,?`);
  return objectText.replace(inline, (match) => (match.trimStart().startsWith(",") ? "," : ""));
}

function removeObject(source: string, range: { start: number; end: number }): string {
  let { start, end } = range;
  const after = /^\s*,/.exec(source.slice(end));
  if (after) {
    end += after[0].length;
  } else {
    const before = /,\s*$/.exec(source.slice(0, start));
    if (before) {
      start -= before[0].length;
    }
  }
  const lineStart = source.lastIndexOf("\n", start);
  if (lineStart >= 0 && source.slice(lineStart + 1, start).trim() === "") {
    start = lineStart;
  }
  return source.slice(0, start) + source.slice(end);
}

function renderNewObject(kind: "location" | "map", rect: RectPayload["rects"][number], indent: string): string {
  if (kind === "map") {
    return [
      `${indent}// TODO éditeur : nommer la zone et brancher sa cible.`,
      `${indent}{ id: '${rect.id}', name: 'À définir', x: ${rect.x}, y: ${rect.y}, width: ${rect.width}, height: ${rect.height}, locked: true }`,
    ].join("\n");
  }
  const inner = `${indent}  `;
  if (rect.targetLocationId) {
    const lines = [
      `${indent}{`,
      `${inner}id: '${rect.id}',`,
      `${inner}type: 'navigate',`,
      `${inner}x: ${rect.x},`,
      `${inner}y: ${rect.y},`,
      `${inner}width: ${rect.width},`,
      `${inner}height: ${rect.height},`,
      `${inner}targetLocationId: '${rect.targetLocationId}'`,
    ];
    if (rect.arrowAngle !== undefined) {
      lines[lines.length - 1] += ",";
      lines.push(`${inner}arrowAngle: ${rect.arrowAngle}`);
      if (rect.arrowOffsetX !== undefined || rect.arrowOffsetY !== undefined) {
        lines[lines.length - 1] += ",";
        lines.push(`${inner}arrowOffsetX: ${rect.arrowOffsetX ?? 0},`);
        lines.push(`${inner}arrowOffsetY: ${rect.arrowOffsetY ?? 0}`);
      }
    }
    lines.push(`${indent}}`);
    return lines.join("\n");
  }
  return [
    `${indent}// TODO éditeur : choisir le type (info / navigate / dialogue) et la cible.`,
    `${indent}{`,
    `${inner}id: '${rect.id}',`,
    `${inner}type: 'info',`,
    `${inner}x: ${rect.x},`,
    `${inner}y: ${rect.y},`,
    `${inner}width: ${rect.width},`,
    `${inner}height: ${rect.height},`,
    `${inner}title: 'À définir',`,
    `${inner}text: 'Hotspot créé dans l’éditeur (F2), à compléter.'`,
    `${indent}}`,
  ].join("\n");
}

function appendObjects(source: string, kind: "location" | "map", rects: RectPayload["rects"]): string {
  const closing = source.lastIndexOf("]");
  if (closing < 0) {
    throw new Error("tableau introuvable dans le fichier");
  }
  const lineStart = source.lastIndexOf("\n", closing) + 1;
  const bracketIndentMatch = /^[ \t]*/.exec(source.slice(lineStart, closing));
  const bracketIndent = bracketIndentMatch ? bracketIndentMatch[0] : "";
  const itemIndent = `${bracketIndent}  `;
  const head = source.slice(0, closing).replace(/\s+$/, "");
  const separator = head.endsWith("[") ? "" : ",";
  const block = rects.map((rect) => renderNewObject(kind, rect, itemIndent)).join(",\n");
  return `${head}${separator}\n${block}\n${bracketIndent}${source.slice(closing)}`;
}

/**
 * Équivalent GitHub de `applyPayload` (dev/rect-writer-core.mjs, repo du jeu) — même contrat,
 * même résultat (`{ file, updated, created, deleted }`), même message de succès affiché dans le
 * toast de l'éditeur F2. Ne commit que si le contenu a réellement changé.
 */
export async function applyPayloadViaGitHub(payload: RectPayload): Promise<ApplyResult> {
  if (!TOKEN) {
    throw new Error("GAME_RECTS_GITHUB_TOKEN manquant côté serveur");
  }

  const path = await resolveSourceFile(payload.target);
  const file = await getFile(path);
  if (!file) {
    throw new Error(`impossible de lire ${path}`);
  }
  let source = file.content;
  let updated = 0;

  payload.rects
    .filter((rect) => !rect.isNew)
    .forEach((rect) => {
      const range = findObjectRange(source, rect.id);
      if (!range) {
        return;
      }
      let objectText = source.slice(range.start, range.end);
      objectText = setField(objectText, "x", rect.x);
      objectText = setField(objectText, "y", rect.y);
      objectText = setField(objectText, "width", rect.width);
      objectText = setField(objectText, "height", rect.height);
      if (rect.targetLocationId !== undefined) {
        objectText = setStringField(objectText, "targetLocationId", rect.targetLocationId);
      }
      if (rect.arrowAngle !== undefined) {
        objectText = setField(objectText, "arrowAngle", rect.arrowAngle);
        if (rect.arrowOffsetX !== undefined) {
          objectText = setField(objectText, "arrowOffsetX", rect.arrowOffsetX);
        }
        if (rect.arrowOffsetY !== undefined) {
          objectText = setField(objectText, "arrowOffsetY", rect.arrowOffsetY);
        }
      } else {
        objectText = removeField(objectText, "arrowAngle");
        objectText = removeField(objectText, "arrowOffsetX");
        objectText = removeField(objectText, "arrowOffsetY");
      }
      source = source.slice(0, range.start) + objectText + source.slice(range.end);
      updated += 1;
    });

  let deletedCount = 0;
  payload.deleted.forEach((id) => {
    const range = findObjectRange(source, id);
    if (range) {
      source = removeObject(source, range);
      deletedCount += 1;
    }
  });

  const created = payload.rects.filter((rect) => rect.isNew);
  if (created.length > 0) {
    source = appendObjects(source, payload.target.kind, created);
  }

  if (source !== file.content) {
    await putFile(path, source, file.sha, `fix: édition de hotspots en direct depuis le jeu (F2, admin) — ${path}`);
  }

  return { file: path, updated, created: created.length, deleted: deletedCount };
}
