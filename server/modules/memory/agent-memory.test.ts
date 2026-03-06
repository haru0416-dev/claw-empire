import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  buildAgentMemoryPromptBlock,
  listAgentMemory,
  recordAgentTaskCompletionMemory,
  upsertAgentMemory,
} from "./agent-memory.ts";

function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT
    );

    CREATE TABLE agent_memory_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('state','procedure','knowledge','episode')),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      source_type TEXT NOT NULL DEFAULT 'system',
      dedupe_key TEXT,
      pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
      created_at INTEGER DEFAULT (unixepoch()*1000),
      updated_at INTEGER DEFAULT (unixepoch()*1000),
      last_used_at INTEGER,
      UNIQUE(agent_id, dedupe_key)
    );
  `);
  db.prepare("INSERT INTO agents (id, name) VALUES (?, ?)").run("agent-1", "Haru");
  db.prepare("INSERT INTO tasks (id, title) VALUES (?, ?)").run("task-1", "Stabilize memory");
  return db;
}

describe("agent memory", () => {
  it("records task completion memory and reuses dedupe slots", () => {
    const db = createDb();
    try {
      const created = recordAgentTaskCompletionMemory(db, {
        agentId: "agent-1",
        taskId: "task-1",
        taskTitle: "Stabilize memory",
        taskDescription: "Tighten prompt context and validate with pnpm test and pnpm build.",
        taskResult: "Updated prompt assembly.\npnpm test passed\npnpm build passed",
        departmentName: "planning",
        workflowPackKey: "development",
        now: 100,
      });

      expect(created.map((entry) => entry.kind)).toEqual(["state", "procedure", "episode"]);

      const rows = listAgentMemory(db, "agent-1", { limit: 10 });
      expect(rows).toHaveLength(3);
      expect(rows.some((entry) => entry.kind === "procedure" && entry.content.includes("pnpm test"))).toBe(true);

      const refreshed = recordAgentTaskCompletionMemory(db, {
        agentId: "agent-1",
        taskId: "task-1",
        taskTitle: "Stabilize memory",
        taskDescription: "Retried verification with pnpm test.",
        taskResult: "pnpm test passed",
        now: 200,
      });

      expect(refreshed).toHaveLength(3);
      const afterRefresh = listAgentMemory(db, "agent-1", { limit: 10 });
      expect(afterRefresh).toHaveLength(3);
      const episode = afterRefresh.find((entry) => entry.kind === "episode");
      expect(episode?.updated_at).toBe(200);
    } finally {
      db.close();
    }
  });

  it("builds a grouped prompt block and marks selected entries as used", () => {
    const db = createDb();
    try {
      upsertAgentMemory(db, {
        agentId: "agent-1",
        kind: "knowledge",
        title: "Repo anchor",
        content: "The dashboard favors concise, high-signal summaries.",
        dedupeKey: "knowledge:repo-anchor",
        now: 100,
      });
      upsertAgentMemory(db, {
        agentId: "agent-1",
        kind: "episode",
        title: "Recent dashboard pass",
        content: "Shipped a focused dashboard tweak without changing the office vibe.",
        dedupeKey: "episode:dashboard-pass",
        now: 120,
      });

      const block = buildAgentMemoryPromptBlock(db, "agent-1", 333);

      expect(block).toContain("[Agent Memory]");
      expect(block).toContain("[Knowledge]");
      expect(block).toContain("Repo anchor");
      expect(block).toContain("[Episodes]");

      const touched = db
        .prepare("SELECT COUNT(*) AS cnt FROM agent_memory_entries WHERE last_used_at = 333")
        .get() as { cnt: number };
      expect(touched.cnt).toBe(2);
    } finally {
      db.close();
    }
  });
});
