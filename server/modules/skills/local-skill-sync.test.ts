import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ProviderSkillConflictError,
  linkInstalledSkillDirsIntoWorktree,
  removeCustomSkillFromProviderDirs,
  syncCustomSkillToProviderDirs,
} from "./local-skill-sync.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("local skill sync", () => {
  it("writes custom skills into provider runtime directories and removes deselected providers", () => {
    const rootDir = makeTempDir("climpire-skill-root-");

    const written = syncCustomSkillToProviderDirs({
      rootDir,
      canonicalSkillName: "my-skill",
      content: "---\nname: my-skill\ndescription: test\n---\n",
      providers: ["claude", "codex"],
    });

    expect(written).toEqual(["claude", "codex"]);
    expect(fs.existsSync(path.join(rootDir, ".claude", "skills", "my-skill", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, ".codex", "skills", "my-skill", "SKILL.md"))).toBe(true);

    syncCustomSkillToProviderDirs({
      rootDir,
      canonicalSkillName: "my-skill",
      content: "---\nname: my-skill\ndescription: test v2\n---\n",
      providers: ["codex"],
      previousProviders: ["claude", "codex"],
    });

    expect(fs.existsSync(path.join(rootDir, ".claude", "skills", "my-skill"))).toBe(false);
    expect(fs.existsSync(path.join(rootDir, ".codex", "skills", "my-skill", "SKILL.md"))).toBe(true);
  });

  it("refuses to overwrite unmanaged provider skill directories", () => {
    const rootDir = makeTempDir("climpire-skill-conflict-");
    const existingDir = path.join(rootDir, ".claude", "skills", "existing-skill");
    fs.mkdirSync(existingDir, { recursive: true });
    fs.writeFileSync(path.join(existingDir, "SKILL.md"), "manual", "utf8");

    expect(() =>
      syncCustomSkillToProviderDirs({
        rootDir,
        canonicalSkillName: "existing-skill",
        content: "---\nname: existing-skill\ndescription: test\n---\n",
        providers: ["claude"],
      }),
    ).toThrow(ProviderSkillConflictError);
  });

  it("links all installed provider skill roots into a worktree", () => {
    const rootDir = makeTempDir("climpire-skill-link-root-");
    const worktreeDir = makeTempDir("climpire-skill-link-wt-");

    fs.mkdirSync(path.join(rootDir, ".claude", "skills"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, ".codex", "skills"), { recursive: true });

    const linked = linkInstalledSkillDirsIntoWorktree(rootDir, worktreeDir);

    expect(linked).toContain(".claude");
    expect(linked).toContain(".codex");
    expect(fs.lstatSync(path.join(worktreeDir, ".claude", "skills")).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(path.join(worktreeDir, ".codex", "skills")).isSymbolicLink()).toBe(true);
  });

  it("removes only Claw-Empire-managed provider skill directories", () => {
    const rootDir = makeTempDir("climpire-skill-remove-");
    syncCustomSkillToProviderDirs({
      rootDir,
      canonicalSkillName: "managed-skill",
      content: "---\nname: managed-skill\ndescription: test\n---\n",
      providers: ["claude"],
    });

    const unmanagedDir = path.join(rootDir, ".codex", "skills", "manual-skill");
    fs.mkdirSync(unmanagedDir, { recursive: true });
    fs.writeFileSync(path.join(unmanagedDir, "SKILL.md"), "manual", "utf8");

    removeCustomSkillFromProviderDirs({
      rootDir,
      canonicalSkillName: "managed-skill",
      providers: ["claude", "codex"],
    });

    expect(fs.existsSync(path.join(rootDir, ".claude", "skills", "managed-skill"))).toBe(false);
    expect(fs.existsSync(unmanagedDir)).toBe(true);
  });
});
