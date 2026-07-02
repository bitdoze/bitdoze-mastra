import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { readdir, readFile, writeFile, mkdir, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { PROJECT_ROOT } from "../paths";
import { judgeVerdictSchema, parseJudgeVerdict } from "../agents/bitdoze-judge";

const execFileAsync = promisify(execFile);

// --- Config ---------------------------------------------------------------
const BITDOZE_ROOT = "/home/dragos/projects/bitdoze.com";
const POSTS_DIR = join(BITDOZE_ROOT, "src/content/posts");
const TRACKING_FILE = join(PROJECT_ROOT, "workspace", "bitdoze-art-upd.md");
const AGENT_TIMEZONE = process.env.AGENT_TIMEZONE ?? "Europe/Bucharest";
// Skip posts whose frontmatter date is within this many days.
const STALE_DAYS = 60;
// How many editor->judge revision rounds before accepting best effort.
const MAX_REVISION_ROUNDS = 2;
// How many editor fix attempts when the site build fails before giving up.
const MAX_BUILD_FIX_ATTEMPTS = Number(process.env.BITDOZE_MAX_BUILD_FIXES) || 3;

// --- Helpers --------------------------------------------------------------

function parseFrontmatter(raw: string): Record<string, string> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function parseFrontmatterDate(raw: string): Date | null {
  const fm = parseFrontmatter(raw);
  if (!fm.date) return null;
  const d = new Date(fm.date);
  return isNaN(d.getTime()) ? null : d;
}

// Returns the set of slugs already recorded in the tracking file so we don't
// refresh the same post repeatedly.
async function getDoneSlugs(): Promise<Set<string>> {
  try {
    const text = await readFile(TRACKING_FILE, "utf-8");
    const slugs = new Set<string>();
    // entries look like: | 2026-06-26 08:00 | add-accordion-carrd | ... |
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/\|\s*([a-z0-9][a-z0-9-]+)\s*\|/);
      // only count table rows that mention a status
      if (m && /(updated|skipped|failed|pushed)/i.test(line)) {
        slugs.add(m[1]);
      }
    }
    return slugs;
  } catch {
    return new Set();
  }
}

async function runCmd(cmd: string[], opts: { cwd: string }): Promise<{ ok: boolean; stdout: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd[0], cmd.slice(1), {
      cwd: opts.cwd,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, CI: "true" },
    });
    return { ok: true, stdout: (stdout + "\n" + stderr).slice(-3000) };
  } catch (err: any) {
    return { ok: false, stdout: ((err.stdout ?? "") + "\n" + (err.stderr ?? "")).slice(-3000) };
  }
}

// --- Step 1: Select a stale post -----------------------------------------

const selectPostStep = createStep({
  id: "select-post",
  inputSchema: z.object({}).optional(),
  outputSchema: z.object({
    found: z.boolean(),
    slug: z.string().optional(),
    path: z.string().optional(),
    topic: z.string().optional(),
    reason: z.string().optional(),
  }),
  execute: async () => {
    try {
      const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
      const done = await getDoneSlugs();
      const allFiles = await readdir(POSTS_DIR);
      const files = allFiles.filter((f) => /\.(md|mdx)$/.test(f));

      type Cand = { slug: string; path: string; date: Date; title: string };
      const candidates: Cand[] = [];
      for (const file of files) {
        const slug = file.replace(/\.(md|mdx)$/, "");
        if (done.has(slug)) continue;
        const fullPath = join(POSTS_DIR, file);
        try {
          const content = await readFile(fullPath, "utf-8");
          const date = parseFrontmatterDate(content);
          if (!date) continue;
          if (date <= cutoff) {
            const fm = parseFrontmatter(content);
            candidates.push({ slug, path: fullPath, date, title: fm.title ?? slug });
          }
        } catch {
          continue;
        }
      }

      if (candidates.length === 0) {
        return { found: false, reason: "No posts older than 60 days that haven't been refreshed." };
      }

      // Pick the oldest post — the most overdue for a refresh.
      candidates.sort((a, b) => a.date.getTime() - b.date.getTime());
      const pick = candidates[0];
      return {
        found: true,
        slug: pick.slug,
        path: pick.path,
        topic: pick.title,
      };
    } catch (error) {
      return {
        found: false,
        reason: `selectPostStep error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

// --- Step 2: Research + rewrite (editor agent) ----------------------------
// Reads file content from disk and passes it inline. The editor has NO
// workspace/file tools, so it can't accidentally write fragments to disk.

const rewriteStep = createStep({
  id: "research-rewrite",
  inputSchema: z.object({
    found: z.boolean(),
    slug: z.string().optional(),
    path: z.string().optional(),
    topic: z.string().optional(),
    reason: z.string().optional(),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    slug: z.string().optional(),
    path: z.string().optional(),
    topic: z.string().optional(),
    rewritten: z.string().optional(),
    reason: z.string().optional(),
  }),
  execute: async ({ inputData, mastra }) => {
    if (!inputData.found || !inputData.path) {
      return { found: false, reason: inputData.reason };
    }
    const editor = mastra.getAgent("bitdozeEditor");

    try {
      // Read the current file content from disk.
      const fileContent = await readFile(inputData.path, "utf-8");

      const result = await editor.generate(
        `Rewrite and improve this bitdoze.com article. Title: ${inputData.topic}\n\n` +
          `Here is the current file content:\n\n${fileContent}\n\n` +
          `Research the topic to verify accuracy, then output the complete rewritten MDX file. ` +
          `Your response must start with --- (frontmatter) and contain the full article body.`,
        {
          memory: { thread: `bitdoze-edit-${inputData.slug}`, resource: "workflow" },
        },
      );

      let text = (result.text ?? "").trim();
      // Strip accidental markdown fences the model sometimes wraps around output.
      text = text.replace(/^```(?:mdx|markdown|md)?\s*\n/i, "").replace(/\n```\s*$/i, "");

      // The model sometimes emits commentary before the actual article.
      // Find the first standalone "---" line (frontmatter start) and trim
      // everything before it. Also trim trailing commentary after the last
      // line that looks like article content.
      const fmStart = text.indexOf("\n---\n");
      if (fmStart >= 0 && fmStart < text.length * 0.3) {
        text = text.slice(fmStart + 1).trim();
      }

      // Validate: output must start with frontmatter --- and be substantial.
      if (!text.startsWith("---") || text.length < 200) {
        return {
          found: false,
          reason: `Editor output invalid: must start with --- frontmatter and be >200 chars. Got len=${text.length}, starts with: "${text.slice(0, 80)}"`,
        };
      }

      return {
        found: true,
        slug: inputData.slug,
        path: inputData.path,
        topic: inputData.topic,
        rewritten: text,
      };
    } catch (error) {
      return {
        found: false,
        reason: `rewriteStep error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

// --- Step 3: Judge + revise loop ------------------------------------------

const judgeStep = createStep({
  id: "judge-and-revise",
  inputSchema: z.object({
    found: z.boolean(),
    slug: z.string().optional(),
    path: z.string().optional(),
    topic: z.string().optional(),
    rewritten: z.string().optional(),
    reason: z.string().optional(),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    slug: z.string().optional(),
    path: z.string().optional(),
    topic: z.string().optional(),
    rewritten: z.string().optional(),
    judgePassed: z.boolean(),
    judgeScore: z.number(),
    judgeSummary: z.string(),
    revisionRounds: z.number(),
    reason: z.string().optional(),
  }),
  execute: async ({ inputData, mastra }) => {
    if (!inputData.found || !inputData.rewritten || inputData.rewritten.length < 50) {
      return {
        found: false,
        judgePassed: false,
        judgeScore: 0,
        judgeSummary: inputData.reason ?? "no post or empty rewrite",
        revisionRounds: 0,
      };
    }

    const judge = mastra.getAgent("bitdozeJudge");
    const editor = mastra.getAgent("bitdozeEditor");
    let currentDraft = inputData.rewritten;
    let rounds = 0;
    let verdict: z.infer<typeof judgeVerdictSchema> | null = null;

    try {
      // Loop: judge -> (revise if failed) -> judge, up to MAX_REVISION_ROUNDS.
      for (rounds = 1; rounds <= MAX_REVISION_ROUNDS + 1; rounds++) {
        const res = await judge.generate(
          `Review this refreshed bitdoze.com article (slug: ${inputData.slug}).\n\n${currentDraft}`,
          {
            memory: { thread: `bitdoze-judge-${inputData.slug}`, resource: "workflow" },
          },
        );
        // Parse JSON verdict from text (structuredOutput not reliable with all models).
        verdict = parseJudgeVerdict(res.text ?? "");

        if (verdict.pass) break;
        if (rounds > MAX_REVISION_ROUNDS) break;

        const feedback = verdict.issues.map((i) => `- ${i}`).join("\n");
        const reviseRes = await editor.generate(
          `The judge rejected your draft of "${inputData.topic}" with these issues:\n${feedback}\n\n` +
            `Here is the rejected draft:\n\n${currentDraft}\n\n` +
            `Fix every issue and return the complete updated article file.`,
          { memory: { thread: `bitdoze-edit-${inputData.slug}`, resource: "workflow" } },
        );
        const revised = (reviseRes.text ?? "")
          .trim()
          .replace(/^```(?:mdx|markdown|md)?\s*\n/i, "")
          .replace(/\n```\s*$/i, "");
        if (revised.length > 50) currentDraft = revised;
      }
    } catch (error) {
      // If judge/revise errors, accept the current draft as best-effort.
      verdict = verdict ?? {
        pass: false, score: 5, accuracy: "", humanization: "", guidelines: "",
        issues: [], summary: `judge error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    return {
      found: true,
      slug: inputData.slug,
      path: inputData.path,
      topic: inputData.topic,
      rewritten: currentDraft,
      judgePassed: verdict?.pass ?? false,
      judgeScore: verdict?.score ?? 0,
      judgeSummary: verdict?.summary ?? "no verdict",
      revisionRounds: rounds - 1,
    };
  },
});

// --- Step 4: Write file, build, and conditionally push --------------------

const buildPushStep = createStep({
  id: "build-and-push",
  inputSchema: z.object({
    found: z.boolean(),
    slug: z.string().optional(),
    path: z.string().optional(),
    topic: z.string().optional(),
    rewritten: z.string().optional(),
    judgePassed: z.boolean(),
    judgeScore: z.number(),
    judgeSummary: z.string(),
    revisionRounds: z.number(),
    reason: z.string().optional(),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    slug: z.string().optional(),
    written: z.boolean(),
    buildOk: z.boolean(),
    pushed: z.boolean(),
    judgePassed: z.boolean(),
    judgeScore: z.number(),
    judgeSummary: z.string(),
    buildLog: z.string().optional(),
    error: z.string().optional(),
    reason: z.string().optional(),
  }),
  execute: async ({ inputData, mastra }) => {
    if (!inputData.found || !inputData.path || !inputData.rewritten) {
      return {
        found: false,
        written: false,
        buildOk: false,
        pushed: false,
        judgePassed: false,
        judgeScore: 0,
        judgeSummary: inputData.reason ?? "no post",
        reason: inputData.reason,
      };
    }

    // Safety: never write a file that doesn't start with valid frontmatter.
    if (!inputData.rewritten.startsWith("---") || inputData.rewritten.length < 200) {
      return {
        found: true,
        slug: inputData.slug,
        written: false,
        buildOk: false,
        pushed: false,
        judgePassed: inputData.judgePassed,
        judgeScore: inputData.judgeScore,
        judgeSummary: inputData.judgeSummary,
        error: `Refusing to write: output doesn't start with --- or is too short (${inputData.rewritten.length} chars).`,
      };
    }

    const editor = mastra.getAgent("bitdozeEditor");
    const today = new Date().toISOString().split("T")[0] + "T00:00:00Z";
    const dateLineRegex = /^date:\s*.+$/m;

    // Stamp today's date onto the draft and write it to disk.
    let currentDraft = inputData.rewritten;
    if (dateLineRegex.test(currentDraft)) {
      currentDraft = currentDraft.replace(dateLineRegex, `date: ${today}`);
    }
    await writeFile(inputData.path, currentDraft, "utf-8");

    // Build + fix loop. On a failed build, send the error log back to the
    // editor with the current draft so it can correct the MDX, then rebuild.
    let build = await runCmd(["bun", "run", "build:ci"], { cwd: BITDOZE_ROOT });
    let buildFixAttempts = 0;

    while (!build.ok && buildFixAttempts < MAX_BUILD_FIX_ATTEMPTS) {
      buildFixAttempts++;
      try {
        const fixRes = await editor.generate(
          `The bitdoze.com site build just failed after writing your refreshed article "${inputData.topic}" (${inputData.slug}). ` +
            `Fix the article so the build succeeds.\n\n` +
            `Here is the build error log (tail):\n${build.stdout.slice(-3000)}\n\n` +
            `Here is the current article file that is failing the build:\n\n${currentDraft}\n\n` +
            `Return the complete corrected MDX file. No commentary, no markdown fences — just the file starting with ---.`,
          { memory: { thread: `bitdoze-edit-${inputData.slug}`, resource: "workflow" } },
        );
        let fixed = (fixRes.text ?? "")
          .trim()
          .replace(/^```(?:mdx|markdown|md)?\s*\n/i, "")
          .replace(/\n```\s*$/i, "");
        // Trim any preamble before the frontmatter.
        const fmIdx = fixed.indexOf("\n---\n");
        if (fmIdx >= 0 && fmIdx < fixed.length * 0.3) {
          fixed = fixed.slice(fmIdx + 1).trim();
        }
        if (!fixed.startsWith("---") || fixed.length < 200) {
          // Editor produced invalid output — stop trying.
          break;
        }
        if (dateLineRegex.test(fixed)) {
          fixed = fixed.replace(dateLineRegex, `date: ${today}`);
        }
        currentDraft = fixed;
        await writeFile(inputData.path, currentDraft, "utf-8");
        build = await runCmd(["bun", "run", "build:ci"], { cwd: BITDOZE_ROOT });
      } catch (fixError) {
        // Editor fix call errored — keep last build result and stop.
        break;
      }
    }

    if (!build.ok) {
      return {
        found: true,
        slug: inputData.slug,
        written: true,
        buildOk: false,
        pushed: false,
        judgePassed: inputData.judgePassed,
        judgeScore: inputData.judgeScore,
        judgeSummary: inputData.judgeSummary,
        buildLog: build.stdout,
        error: `Build failed after ${buildFixAttempts} fix attempt(s) — not pushing.`,
      };
    }

    // Build passed: commit and push.
    const dateTag = new Date().toISOString().split("T")[0];
    const msg = `refresh: ${inputData.slug} (automated article update ${dateTag})`;
    await runCmd(["git", "add", "-A"], { cwd: BITDOZE_ROOT });
    await runCmd(["git", "commit", "-m", msg], { cwd: BITDOZE_ROOT });
    const push = await runCmd(["git", "push", "origin", "main"], { cwd: BITDOZE_ROOT });

    return {
      found: true,
      slug: inputData.slug,
      written: true,
      buildOk: true,
      pushed: push.ok,
      judgePassed: inputData.judgePassed,
      judgeScore: inputData.judgeScore,
      judgeSummary: inputData.judgeSummary,
      error: push.ok ? undefined : `Push failed: ${push.stdout.slice(-500)}`,
    };
  },
});

// --- Step 5: Append to tracking file --------------------------------------

const trackStep = createStep({
  id: "track-result",
  inputSchema: z.object({
    found: z.boolean(),
    slug: z.string().optional(),
    written: z.boolean(),
    buildOk: z.boolean(),
    pushed: z.boolean(),
    judgePassed: z.boolean(),
    judgeScore: z.number(),
    judgeSummary: z.string(),
    buildLog: z.string().optional(),
    error: z.string().optional(),
    reason: z.string().optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    slug: z.string().optional(),
    pushed: z.boolean(),
    tracked: z.boolean(),
    summary: z.string(),
  }),
  execute: async ({ inputData }) => {
    await mkdir(join(PROJECT_ROOT, "workspace"), { recursive: true });

    // Ensure the tracking file exists with a header.
    try {
      await access(TRACKING_FILE);
    } catch {
      await writeFile(
        TRACKING_FILE,
        "# Bitdoze Article Update Log\n\n" +
          "Automated log of articles refreshed by the bitdoze-article-update workflow.\n\n" +
          "| Date (UTC) | Slug | Judge | Score | Build | Pushed | Notes |\n" +
          "|---|---|---:|---:|---|---|---|\n",
        "utf-8",
      );
    }

    const ts = new Date().toISOString().replace("T", " ").slice(0, 16);
    let status: string;
    let notes: string;
    if (!inputData.found) {
      status = "skipped";
      notes = inputData.reason ?? "nothing to update";
    } else if (inputData.error || !inputData.buildOk) {
      status = "failed";
      notes = inputData.error ?? inputData.buildLog?.slice(-200) ?? "build failed";
    } else {
      status = inputData.pushed ? "pushed" : "updated";
      notes = inputData.judgeSummary.replace(/\|/g, "/").slice(0, 120);
    }

    const judgeCell = inputData.found ? (inputData.judgePassed ? "pass" : "best-effort") : "-";
    const scoreCell = inputData.found ? String(inputData.judgeScore) : "-";
    const row =
      `| ${ts} | ${inputData.slug ?? "-"} | ${judgeCell} | ${scoreCell} | ` +
      `${inputData.buildOk ? "ok" : "fail"} | ${inputData.pushed ? "yes" : "no"} | ${notes} |\n`;

    const existing = await readFile(TRACKING_FILE, "utf-8");
    await writeFile(TRACKING_FILE, existing + row, "utf-8");

    const summary = inputData.found
      ? `${inputData.slug}: judge ${judgeCell} (${scoreCell}/10), build ${inputData.buildOk ? "ok" : "fail"}, ${inputData.pushed ? "pushed" : "not pushed"}`
      : `No stale posts to update (${inputData.reason ?? ""})`;

    return {
      ok: true,
      slug: inputData.slug,
      pushed: inputData.pushed,
      tracked: true,
      summary,
    };
  },
});

// --- Workflow assembly ----------------------------------------------------

export const bitdozeArticleUpdate = createWorkflow({
  id: "bitdoze-article-update",
  inputSchema: z.object({}).optional(),
  outputSchema: z.object({
    ok: z.boolean(),
    slug: z.string().optional(),
    pushed: z.boolean(),
    tracked: z.boolean(),
    summary: z.string(),
  }),
  // Twice daily: morning (08:00) and night (20:00) in the configured timezone.
  schedule: {
    cron: "0 8,20 * * *",
    timezone: AGENT_TIMEZONE,
    inputData: {},
  },
})
  .then(selectPostStep)
  .then(rewriteStep)
  .then(judgeStep)
  .then(buildPushStep)
  .then(trackStep)
  .commit();
