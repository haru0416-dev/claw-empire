import type { RuntimeContext } from "../../../../types/runtime-context.ts";
import {
  AGENT_MEMORY_KINDS,
  listAgentMemory,
  upsertAgentMemory,
  type AgentMemoryKind,
} from "../../../memory/agent-memory.ts";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseLimit(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 12;
  return Math.max(1, Math.min(50, Math.trunc(parsed)));
}

function parseMemoryKind(value: unknown): AgentMemoryKind | null {
  return typeof value === "string" && AGENT_MEMORY_KINDS.includes(value as AgentMemoryKind)
    ? (value as AgentMemoryKind)
    : null;
}

export function registerAgentMemoryRoutes(ctx: RuntimeContext): void {
  const { app, db, nowMs } = ctx;

  app.get("/api/agents/:id/memory", (req, res) => {
    const agentId = String(req.params.id);
    const agentExists = db.prepare("SELECT id FROM agents WHERE id = ?").get(agentId) as { id?: string } | undefined;
    if (!agentExists) return res.status(404).json({ ok: false, error: "not_found" });

    const kind = parseMemoryKind(req.query?.kind);
    const limit = parseLimit(req.query?.limit);
    const memory = listAgentMemory(db as any, agentId, { kind, limit });
    const byKind = Object.fromEntries(AGENT_MEMORY_KINDS.map((entryKind) => [entryKind, 0])) as Record<
      AgentMemoryKind,
      number
    >;
    for (const entry of memory) {
      byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
    }

    res.json({
      ok: true,
      memory,
      summary: {
        total: memory.length,
        by_kind: byKind,
      },
    });
  });

  app.post("/api/agents/:id/memory", (req, res) => {
    const agentId = String(req.params.id);
    const agentExists = db.prepare("SELECT id FROM agents WHERE id = ?").get(agentId) as { id?: string } | undefined;
    if (!agentExists) return res.status(404).json({ ok: false, error: "not_found" });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = parseMemoryKind(body.kind);
    const title = normalizeText(body.title);
    const content = normalizeText(body.content);
    const dedupeKey = normalizeText(body.dedupe_key) || null;
    const pinned = body.pinned === true || body.pinned === 1 ? 1 : 0;
    if (!kind) return res.status(400).json({ ok: false, error: "invalid_kind" });
    if (!title) return res.status(400).json({ ok: false, error: "title_required" });
    if (!content) return res.status(400).json({ ok: false, error: "content_required" });

    const memory = upsertAgentMemory(db as any, {
      agentId,
      kind,
      title,
      content,
      sourceTaskId: normalizeText(body.source_task_id) || null,
      sourceType: normalizeText(body.source_type) || "manual",
      dedupeKey,
      pinned,
      now: nowMs(),
    });

    if (!memory) {
      return res.status(400).json({ ok: false, error: "memory_write_failed" });
    }

    res.status(201).json({ ok: true, memory });
  });
}
