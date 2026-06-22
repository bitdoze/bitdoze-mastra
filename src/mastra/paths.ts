import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

// Mastra's dev server runs the bundled output with cwd = `src/mastra/public/`,
// and production (`mastra start`) runs the bundle from `.mastra/output/`.
// Both ship their own package.json + lockfiles, so those alone can't identify
// the project root. Instead we anchor on a marker that only exists at the real
// project root: the `src/` directory (source code isn't copied to build output).
function isProjectRoot(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "package.json")) &&
    fs.existsSync(path.join(dir, "src"))
  );
}

function findProjectRoot(start: string): string {
  let dir = path.resolve(start);
  for (let i = 0; i < 12; i++) {
    if (isProjectRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start);
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = findProjectRoot(moduleDir);

// Workspace filesystem + sandbox working directory.
export const WORKSPACE_PATH = path.join(PROJECT_ROOT, "workspace");

// Skills directory (SKILL.md folders), read via a LocalSkillSource.
export const SKILLS_PATH = path.join(PROJECT_ROOT, "skills");

// LibSQL storage URL. Honors an explicit DATABASE_URL (e.g. a hosted Turso
// `libsql://` URL for production); otherwise a local file at the project root.
export const DATABASE_URL =
  process.env.DATABASE_URL ?? `file:${path.join(PROJECT_ROOT, "mastra.db")}`;

// DuckDB observability store file. Defaults to cwd-relative `mastra.duckdb`
// otherwise, which lands in src/mastra/public under `mastra dev`.
export const DUCKDB_PATH =
  process.env.DUCKDB_PATH ?? path.join(PROJECT_ROOT, "mastra.duckdb");
