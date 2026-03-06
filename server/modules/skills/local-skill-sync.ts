import fs from "node:fs";
import path from "node:path";

export const LOCAL_SKILL_PROVIDER_DIRS = {
  claude: ".claude",
  codex: ".codex",
  gemini: ".gemini",
  opencode: ".opencode",
  copilot: ".copilot",
  antigravity: ".antigravity",
} as const;

export type LocalSkillProvider = keyof typeof LOCAL_SKILL_PROVIDER_DIRS;

const CUSTOM_SKILL_MARKER_FILE = ".claw-empire-custom-skill.json";
const SYMLINK_TYPE = process.platform === "win32" ? "junction" : "dir";

type CustomSkillMarker = {
  source: "claw-empire-custom-skill";
  canonicalSkillName: string;
  provider: LocalSkillProvider;
  updatedAt: number;
};

export class ProviderSkillConflictError extends Error {
  provider: LocalSkillProvider;

  skillDir: string;

  constructor(provider: LocalSkillProvider, skillDir: string) {
    super(`provider skill directory already exists for ${provider}: ${skillDir}`);
    this.name = "ProviderSkillConflictError";
    this.provider = provider;
    this.skillDir = skillDir;
  }
}

export function isLocalSkillProvider(value: string): value is LocalSkillProvider {
  return value in LOCAL_SKILL_PROVIDER_DIRS;
}

export function normalizeLocalSkillProviders(values: readonly string[]): LocalSkillProvider[] {
  const out: LocalSkillProvider[] = [];
  for (const raw of values) {
    const value = String(raw ?? "")
      .trim()
      .toLowerCase();
    if (isLocalSkillProvider(value) && !out.includes(value)) out.push(value);
  }
  return out;
}

export function resolveProviderSkillRoot(rootDir: string, provider: LocalSkillProvider): string {
  return path.join(rootDir, LOCAL_SKILL_PROVIDER_DIRS[provider], "skills");
}

function resolveProviderSkillDir(rootDir: string, provider: LocalSkillProvider, canonicalSkillName: string): string {
  return path.join(resolveProviderSkillRoot(rootDir, provider), canonicalSkillName);
}

function readCustomSkillMarker(skillDir: string): CustomSkillMarker | null {
  const markerPath = path.join(skillDir, CUSTOM_SKILL_MARKER_FILE);
  if (!fs.existsSync(markerPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath, "utf8")) as Partial<CustomSkillMarker>;
    if (parsed?.source !== "claw-empire-custom-skill") return null;
    if (!parsed.canonicalSkillName || !parsed.provider) return null;
    if (!isLocalSkillProvider(String(parsed.provider))) return null;
    return {
      source: "claw-empire-custom-skill",
      canonicalSkillName: String(parsed.canonicalSkillName).trim().toLowerCase(),
      provider: String(parsed.provider).trim().toLowerCase() as LocalSkillProvider,
      updatedAt: Number(parsed.updatedAt ?? 0) || 0,
    };
  } catch {
    return null;
  }
}

function ensureProviderSkillDirWritable(
  rootDir: string,
  provider: LocalSkillProvider,
  canonicalSkillName: string,
): string {
  const skillDir = resolveProviderSkillDir(rootDir, provider, canonicalSkillName);
  if (!fs.existsSync(skillDir)) return skillDir;
  const marker = readCustomSkillMarker(skillDir);
  if (marker?.canonicalSkillName === canonicalSkillName && marker.provider === provider) {
    return skillDir;
  }
  throw new ProviderSkillConflictError(provider, skillDir);
}

function writeCustomSkillMarker(skillDir: string, canonicalSkillName: string, provider: LocalSkillProvider): void {
  const marker: CustomSkillMarker = {
    source: "claw-empire-custom-skill",
    canonicalSkillName,
    provider,
    updatedAt: Date.now(),
  };
  fs.writeFileSync(path.join(skillDir, CUSTOM_SKILL_MARKER_FILE), JSON.stringify(marker, null, 2), "utf8");
}

export function syncCustomSkillToProviderDirs(opts: {
  rootDir: string;
  canonicalSkillName: string;
  content: string;
  providers: readonly string[];
  previousProviders?: readonly string[];
}): LocalSkillProvider[] {
  const rootDir = path.resolve(opts.rootDir);
  const canonicalSkillName = String(opts.canonicalSkillName).trim().toLowerCase();
  const providers = normalizeLocalSkillProviders(opts.providers);
  const previousProviders = normalizeLocalSkillProviders(opts.previousProviders ?? []);

  for (const provider of providers) {
    ensureProviderSkillDirWritable(rootDir, provider, canonicalSkillName);
  }

  for (const provider of previousProviders) {
    if (providers.includes(provider)) continue;
    removeCustomSkillFromProviderDirs({
      rootDir,
      canonicalSkillName,
      providers: [provider],
    });
  }

  for (const provider of providers) {
    const skillDir = resolveProviderSkillDir(rootDir, provider, canonicalSkillName);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), opts.content, "utf8");
    writeCustomSkillMarker(skillDir, canonicalSkillName, provider);
  }

  return providers;
}

export function removeCustomSkillFromProviderDirs(opts: {
  rootDir: string;
  canonicalSkillName: string;
  providers: readonly string[];
}): void {
  const rootDir = path.resolve(opts.rootDir);
  const canonicalSkillName = String(opts.canonicalSkillName).trim().toLowerCase();
  const providers = normalizeLocalSkillProviders(opts.providers);
  for (const provider of providers) {
    const skillDir = resolveProviderSkillDir(rootDir, provider, canonicalSkillName);
    if (!fs.existsSync(skillDir)) continue;
    const marker = readCustomSkillMarker(skillDir);
    if (!marker) continue;
    if (marker.canonicalSkillName !== canonicalSkillName || marker.provider !== provider) continue;
    fs.rmSync(skillDir, { recursive: true, force: true });
  }
}

export function linkInstalledSkillDirsIntoWorktree(rootDir: string, worktreePath: string): string[] {
  const linked: string[] = [];
  const baseDir = path.resolve(rootDir);
  for (const dotDir of new Set(Object.values(LOCAL_SKILL_PROVIDER_DIRS))) {
    const sourceSkillsDir = path.join(baseDir, dotDir, "skills");
    if (!fs.existsSync(sourceSkillsDir)) continue;
    const targetProviderDir = path.join(worktreePath, dotDir);
    const targetSkillsLink = path.join(targetProviderDir, "skills");
    if (fs.existsSync(targetSkillsLink)) continue;
    fs.mkdirSync(targetProviderDir, { recursive: true });
    fs.symlinkSync(sourceSkillsDir, targetSkillsLink, SYMLINK_TYPE);
    linked.push(dotDir);
  }
  return linked;
}
