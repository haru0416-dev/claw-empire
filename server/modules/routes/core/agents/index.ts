import type { RuntimeContext } from "../../../../types/runtime-context.ts";
import { registerAgentCrudRoutes } from "./crud.ts";
import { registerAgentMemoryRoutes } from "./memory.ts";
import { registerAgentProcessInspectorRoutes } from "./process-inspector.ts";
import { registerAgentSpawnRoute } from "./spawn.ts";
import { registerSpriteRoutes } from "./sprites.ts";

export function registerAgentRoutes(ctx: RuntimeContext): void {
  registerAgentProcessInspectorRoutes(ctx);
  registerAgentCrudRoutes(ctx);
  registerAgentMemoryRoutes(ctx);
  registerSpriteRoutes(ctx);
  registerAgentSpawnRoute(ctx);
}
