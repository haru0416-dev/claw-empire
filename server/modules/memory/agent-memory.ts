import type { DatabaseSync } from "node:sqlite";

export const AGENT_MEMORY_KINDS = ["state", "procedure", "knowledge", "episode"] as const;
export type AgentMemoryKind = (typeof AGENT_MEMORY_KINDS)[number];

export type AgentMemoryEntry = {
  id: number;
  agent_id: string;
  kind: AgentMemoryKind;
  title: string;
  content: string;
  source_task_id: string | null;
  source_type: string;
  dedupe_key: string | null;
  pinned: number;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
};

type DbLike = Pick<DatabaseSync, "prepare">;

type UpsertAgentMemoryInput = {
  agentId: string;
  kind: AgentMemoryKind;
  title: string;
  content: string;
  sourceTaskId?: string | null;
  sourceType?: string | null;
  dedupeKey?: string | null;
  pinned?: number | boolean | null;
  now?: number;
};

type TaskCompletionMemoryInput = {
  agentId: string | null | undefined;
  taskId: string;
  taskTitle: string;
  taskDescription?: string | null;
  taskResult?: string | null;
  departmentName?: string | null;
  workflowPackKey?: string | null;
  now?: number;
};

type ListAgentMemoryOptions = {
  limit?: number;
  kind?: AgentMemoryKind | null;
};

const KIND_ORDER: Record<AgentMemoryKind, number> = {
  state: 0,
  procedure: 1,
  knowledge: 2,
  episode: 3,
};

const PROMPT_KIND_LIMITS: Record<AgentMemoryKind, number> = {
  state: 1,
  procedure: 2,
  knowledge: 2,
  episode: 2,
};

const PROCEDURE_COMMAND_REGEX =
  /\b(?:pnpm|npm|yarn|bun|cargo|cargo nextest|pytest|python -m pytest|ruff|uv run|vitest|eslint|tsc|turbo|nx|go test|go vet|mvn|mvnw|gradle|phpunit|composer test|deno test|sqlx|psql)\b[^\n]{0,72}/gi;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeMultiline(value: unknown): string {
  return typeof value === "string"
    ? value
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join("\n")
        .trim()
    : "";
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const normalized = item.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(item);
  }
  return out;
}

function isAgentMemoryKind(value: unknown): value is AgentMemoryKind {
  return typeof value === "string" && AGENT_MEMORY_KINDS.includes(value as AgentMemoryKind);
}

function scoreSignalLine(line: string): number {
  let score = 0;
  if (/(pass|passed|verified|verify|lint|build|test|fixed|implemented|updated|created|render|migrat|review|health)/i.test(line)) {
    score += 4;
  }
  if (/[./\\][A-Za-z0-9_-]/.test(line)) score += 2;
  if (line.length >= 24 && line.length <= 180) score += 1;
  if (/^(RUN|Status ->|Status →|\[Task Session\]|\[Available Skills\])/i.test(line)) score -= 4;
  if (/^(thinking|analysis|assistant|system)/i.test(line)) score -= 2;
  return score;
}

function extractSignalLines(raw: string, maxItems = 2): string[] {
  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 12 && line.length <= 220)
    .filter((line) => !/^[-=*_`]+$/.test(line));

  const ranked = lines
    .map((line, index) => ({
      line,
      index,
      score: scoreSignalLine(line),
    }))
    .filter((entry) => entry.score >= 1)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .map((entry) => clipText(entry.line, 180));

  if (ranked.length > 0) return uniqueStrings(ranked).slice(0, maxItems);

  return uniqueStrings(lines.map((line) => clipText(line, 180)).slice(-maxItems));
}

function extractVerificationCommands(raw: string): string[] {
  const matches = raw.match(PROCEDURE_COMMAND_REGEX) ?? [];
  return uniqueStrings(
    matches
      .map((match) => match.replace(/[.;,:)\]]+$/g, "").trim())
      .filter((match) => match.length >= 3)
      .map((match) => clipText(match, 72)),
  ).slice(0, 4);
}

function buildStateMemoryContent(input: TaskCompletionMemoryInput): string {
  const scopeParts = [
    normalizeText(input.departmentName),
    normalizeText(input.workflowPackKey),
  ].filter((part) => part.length > 0);
  const scopeLabel = scopeParts.length > 0 ? ` (${scopeParts.join(" / ")})` : "";
  return clipText(
    `Latest completed focus${scopeLabel}: ${normalizeText(input.taskTitle)}. Continue from current repo state, keep scope tight, and verify before reporting.`,
    280,
  );
}

function buildEpisodeMemoryContent(input: TaskCompletionMemoryInput): string {
  const description = normalizeText(input.taskDescription);
  const result = normalizeMultiline(input.taskResult);
  const parts: string[] = [];
  if (description) parts.push(`Goal: ${clipText(description, 150)}`);
  const signals = result ? extractSignalLines(result, 2) : [];
  if (signals.length > 0) parts.push(`Outcome: ${signals.join(" | ")}`);
  if (parts.length === 0) {
    parts.push("Completed successfully and handed off for review.");
  }
  return clipText(parts.join(" "), 320);
}

function buildProcedureMemoryContent(input: TaskCompletionMemoryInput): string | null {
  const commands = extractVerificationCommands(`${input.taskDescription ?? ""}\n${input.taskResult ?? ""}`);
  if (commands.length <= 0) return null;
  return clipText(
    `Reuse this verification rhythm when relevant: ${commands.join(" -> ")}. Start targeted, then widen only if needed.`,
    320,
  );
}

export function listAgentMemory(db: DbLike, agentId: string, options: ListAgentMemoryOptions = {}): AgentMemoryEntry[] {
  const normalizedAgentId = normalizeText(agentId);
  if (!normalizedAgentId) return [];

  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(50, Math.trunc(options.limit!))) : 20;
  const kind = isAgentMemoryKind(options.kind) ? options.kind : null;
  const kindClause = kind ? "AND kind = ?" : "";
  const params = kind ? [normalizedAgentId, kind, limit] : [normalizedAgentId, limit];

  try {
    return db
      .prepare(
        `
          SELECT *
          FROM agent_memory_entries
          WHERE agent_id = ?
            ${kindClause}
          ORDER BY
            pinned DESC,
            CASE kind
              WHEN 'state' THEN 0
              WHEN 'procedure' THEN 1
              WHEN 'knowledge' THEN 2
              ELSE 3
            END ASC,
            COALESCE(last_used_at, 0) DESC,
            updated_at DESC,
            id DESC
          LIMIT ?
        `,
      )
      .all(...params) as AgentMemoryEntry[];
  } catch {
    return [];
  }
}

export function upsertAgentMemory(db: DbLike, input: UpsertAgentMemoryInput): AgentMemoryEntry | null {
  const agentId = normalizeText(input.agentId);
  const title = clipText(normalizeText(input.title), 120);
  const content = clipText(normalizeText(input.content), 400);
  const sourceTaskId = normalizeText(input.sourceTaskId) || null;
  const sourceType = normalizeText(input.sourceType) || "system";
  const dedupeKey = normalizeText(input.dedupeKey) || null;
  const pinned = input.pinned === true || input.pinned === 1 ? 1 : 0;
  const now = Number.isFinite(input.now) ? Math.trunc(input.now!) : Date.now();
  if (!agentId || !title || !content || !isAgentMemoryKind(input.kind)) return null;

  try {
    db.prepare(
      `
        INSERT INTO agent_memory_entries (
          agent_id, kind, title, content, source_task_id, source_type, dedupe_key,
          pinned, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(agent_id, dedupe_key) DO UPDATE SET
          kind = excluded.kind,
          title = excluded.title,
          content = excluded.content,
          source_task_id = COALESCE(excluded.source_task_id, agent_memory_entries.source_task_id),
          source_type = excluded.source_type,
          pinned = MAX(agent_memory_entries.pinned, excluded.pinned),
          updated_at = excluded.updated_at
      `,
    ).run(agentId, input.kind, title, content, sourceTaskId, sourceType, dedupeKey, pinned, now, now);

    if (dedupeKey) {
      return db
        .prepare("SELECT * FROM agent_memory_entries WHERE agent_id = ? AND dedupe_key = ? LIMIT 1")
        .get(agentId, dedupeKey) as AgentMemoryEntry | null;
    }
    return db.prepare("SELECT * FROM agent_memory_entries WHERE id = last_insert_rowid()").get() as AgentMemoryEntry | null;
  } catch {
    return null;
  }
}

export function recordAgentTaskCompletionMemory(db: DbLike, input: TaskCompletionMemoryInput): AgentMemoryEntry[] {
  const agentId = normalizeText(input.agentId);
  if (!agentId) return [];
  const taskId = normalizeText(input.taskId);
  const taskTitle = normalizeText(input.taskTitle);
  if (!taskId || !taskTitle) return [];

  const now = Number.isFinite(input.now) ? Math.trunc(input.now!) : Date.now();
  const created: AgentMemoryEntry[] = [];

  const stateEntry = upsertAgentMemory(db, {
    agentId,
    kind: "state",
    title: "Current focus",
    content: buildStateMemoryContent(input),
    sourceTaskId: taskId,
    sourceType: "task_completion",
    dedupeKey: "state:current-focus",
    now,
  });
  if (stateEntry) created.push(stateEntry);

  const procedureContent = buildProcedureMemoryContent(input);
  if (procedureContent) {
    const procedureEntry = upsertAgentMemory(db, {
      agentId,
      kind: "procedure",
      title: "Verification loop",
      content: procedureContent,
      sourceTaskId: taskId,
      sourceType: "task_completion",
      dedupeKey: "procedure:verification-loop",
      now,
    });
    if (procedureEntry) created.push(procedureEntry);
  }

  const episodeEntry = upsertAgentMemory(db, {
    agentId,
    kind: "episode",
    title: taskTitle,
    content: buildEpisodeMemoryContent(input),
    sourceTaskId: taskId,
    sourceType: "task_completion",
    dedupeKey: `episode:task:${taskId}`,
    now,
  });
  if (episodeEntry) created.push(episodeEntry);

  return created;
}

export function buildAgentMemoryPromptBlock(db: DbLike, agentId: string, now = Date.now()): string {
  const entries = listAgentMemory(db, agentId, { limit: 16 });
  if (entries.length <= 0) return "";

  const grouped = new Map<AgentMemoryKind, AgentMemoryEntry[]>();
  for (const kind of AGENT_MEMORY_KINDS) grouped.set(kind, []);

  for (const entry of entries) {
    const bucket = grouped.get(entry.kind);
    if (!bucket) continue;
    if (bucket.length >= PROMPT_KIND_LIMITS[entry.kind]) continue;
    bucket.push(entry);
  }

  const selected = AGENT_MEMORY_KINDS.flatMap((kind) => grouped.get(kind) ?? []);
  if (selected.length <= 0) return "";

  try {
    db.prepare(
      `UPDATE agent_memory_entries SET last_used_at = ? WHERE id IN (${selected.map(() => "?").join(", ")})`,
    ).run(now, ...selected.map((entry) => entry.id));
  } catch {
    // best effort only
  }

  const labelMap: Record<AgentMemoryKind, string> = {
    state: "State",
    procedure: "Procedures",
    knowledge: "Knowledge",
    episode: "Episodes",
  };

  const lines = [
    "[Agent Memory]",
    "Use these as continuity hints. If they conflict with the current repo or task, trust the current repo/task.",
  ];

  for (const kind of AGENT_MEMORY_KINDS) {
    const bucket = grouped.get(kind) ?? [];
    if (bucket.length <= 0) continue;
    lines.push(`[${labelMap[kind]}]`);
    for (const entry of bucket) {
      lines.push(`- ${entry.title}: ${clipText(entry.content, 220)}`);
    }
  }

  return lines.join("\n");
}
