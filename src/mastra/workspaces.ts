import {
  Workspace,
  LocalFilesystem,
  LocalSandbox,
  LocalSkillSource,
  WORKSPACE_TOOLS,
} from "@mastra/core/workspace";
import { WORKSPACE_PATH, SKILLS_PATH, PROJECT_ROOT } from "./paths";
import { symlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Ensure skills are browsable from inside the workspace (Studio file browser).
// The workspace filesystem is sandboxed to WORKSPACE_PATH, but skills live at
// the project root. A symlink bridges them on every boot.
const skillsSymlink = join(WORKSPACE_PATH, "skills");
try {
  if (!existsSync(skillsSymlink)) {
    mkdirSync(WORKSPACE_PATH, { recursive: true });
    symlinkSync(SKILLS_PATH, skillsSymlink, "dir");
  }
} catch {
  // Symlink may already exist or permissions issue; not critical
}

// Extra directories the agent's file tools can read/write, in addition to the
// workspace. Lets the agent work across multiple projects. Set in .env as a
// colon-separated list of absolute paths, e.g.
//   ALLOWED_DIRECTORIES=/home/me/projects/app-a:/home/me/projects/app-b
function parseAllowedDirectories(): string[] {
  const raw = process.env.ALLOWED_DIRECTORIES?.trim();
  if (!raw) return [];
  return raw
    .split(":")
    .map((p) => p.trim())
    .filter(Boolean);
}

const allowedDirectories = parseAllowedDirectories();

// Whether `execute_command` requires user approval before running. Defaults to
// true (safe). Set REQUIRE_COMMAND_APPROVAL=false in .env to skip approval for
// trusted local setups.
const requireCommandApproval = process.env.REQUIRE_COMMAND_APPROVAL !== "false";

if (!requireCommandApproval) {
  console.warn(
    "[workspace] REQUIRE_COMMAND_APPROVAL=false — commands will run WITHOUT approval.",
  );
}

// Filesystem + sandbox pointed at the same absolute directory so files written
// are immediately executable. BM25 search indexes files and skills.
//
// Skills auto-discovered from the project-level ./skills dir via a dedicated
// LocalSkillSource (basePath = project root). The `skills` array just lists
// the parent directory; the workspace scans subdirectories for SKILL.md files.
// Drop a new skill into ./skills/<name>/SKILL.md and it's picked up on restart
// — no code changes needed.

// Environment variables passed to the sandbox so agent-run commands (e.g.
// HyperFrames CLI, TTS, renders) have access to Chrome, Python venv, etc.
// LocalSandbox only inherits PATH by default; everything else must be explicit.
const hfPythonPath = process.env.HYPERFRAMES_PYTHON_PATH;
const sandboxEnv: NodeJS.ProcessEnv = {
  HOME: process.env.HOME,
  USER: process.env.USER,
  SHELL: process.env.SHELL,
  PATH: hfPythonPath
    ? `${hfPythonPath}:${process.env.PATH ?? ""}`
    : process.env.PATH,
  ...(process.env.HYPERFRAMES_BROWSER_PATH
    ? { HYPERFRAMES_BROWSER_PATH: process.env.HYPERFRAMES_BROWSER_PATH }
    : {}),
  ...(process.env.GITHUB_TOKEN
    ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN }
    : {}),
};

export const workspace = new Workspace({
  id: "default",
  name: "Default Workspace",
  filesystem: new LocalFilesystem({
    basePath: WORKSPACE_PATH,
    allowedPaths: allowedDirectories,
  }),
  sandbox: new LocalSandbox({
    workingDirectory: WORKSPACE_PATH,
    env: sandboxEnv,
  }),
  bm25: true,
  skills: [SKILLS_PATH],
  skillSource: new LocalSkillSource({ basePath: PROJECT_ROOT }),
  tools: {
    enabled: true,
    requireApproval: false,
    [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: {
      requireApproval: true,
      requireReadBeforeWrite: true,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: {
      requireApproval: true,
      requireReadBeforeWrite: true,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: {
      enabled: false,
    },
    [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: {
      requireApproval: requireCommandApproval,
      maxOutputTokens: 5000,
    },
  },
});
