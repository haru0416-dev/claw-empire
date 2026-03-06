import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { registerAgentMemoryRoutes } from "./memory.ts";

type RouteHandler = (req: any, res: any) => any;

type FakeResponse = {
  statusCode: number;
  payload: unknown;
  status: (code: number) => FakeResponse;
  json: (body: unknown) => FakeResponse;
};

function createFakeResponse(): FakeResponse {
  return {
    statusCode: 200,
    payload: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.payload = body;
      return this;
    },
  };
}

function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL
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
  return db;
}

function createHarness(db: DatabaseSync) {
  const getRoutes = new Map<string, RouteHandler>();
  const postRoutes = new Map<string, RouteHandler>();
  const app = {
    get(path: string, handler: RouteHandler) {
      getRoutes.set(path, handler);
      return this;
    },
    post(path: string, handler: RouteHandler) {
      postRoutes.set(path, handler);
      return this;
    },
  };

  registerAgentMemoryRoutes({
    app: app as any,
    db: db as any,
    nowMs: () => 500,
  } as any);

  return { getRoutes, postRoutes };
}

describe("agent memory routes", () => {
  it("creates and lists agent memory entries", () => {
    const db = createDb();
    try {
      const { getRoutes, postRoutes } = createHarness(db);
      const postHandler = postRoutes.get("/api/agents/:id/memory");
      const getHandler = getRoutes.get("/api/agents/:id/memory");
      expect(postHandler).toBeTypeOf("function");
      expect(getHandler).toBeTypeOf("function");

      const postRes = createFakeResponse();
      postHandler?.(
        {
          params: { id: "agent-1" },
          body: {
            kind: "knowledge",
            title: "Repo anchor",
            content: "Keep the pixel-office vibe while improving reliability.",
            dedupe_key: "knowledge:repo-anchor",
          },
        },
        postRes,
      );
      expect(postRes.statusCode).toBe(201);

      const getRes = createFakeResponse();
      getHandler?.(
        {
          params: { id: "agent-1" },
          query: { limit: "5" },
        },
        getRes,
      );

      expect(getRes.statusCode).toBe(200);
      expect(getRes.payload).toMatchObject({
        ok: true,
        summary: {
          total: 1,
          by_kind: {
            knowledge: 1,
          },
        },
      });
    } finally {
      db.close();
    }
  });
});
