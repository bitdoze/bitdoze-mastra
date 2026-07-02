import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { memory } from "../memory";
import { tinyfishSearch } from "../tools/tinyfish-search";
import { tinyfishFetch } from "../tools/tinyfish-fetch";

// A DIFFERENT model than the editor, so the judge is an independent second
// opinion, not the same LLM grading its own work.
const JUDGE_MODEL = process.env.BITDOZE_JUDGE_MODEL ?? "opencode-go/glm-5.2";
const AGENT_MAX_STEPS = Number(process.env.BITDOZE_JUDGE_MAX_STEPS) || 45;

// The bitdoze-judge: an independent reviewer. NO workspace tools — receives
// article content inline and returns a JSON verdict as text (parsed by the
// workflow, since structuredOutput doesn't work reliably with all models).
export const bitdozeJudge = new Agent({
    id: "bitdoze-judge",
    name: "Bitdoze Judge",
    instructions: () => {
        return `You are the Bitdoze Judge, a strict but fair editor who reviews refreshed blog posts for bitdoze.com. You are a separate reviewer — be critical, do not rubber-stamp.

For each article you review:

1. **Accuracy check** — Use tinyfish_search / tinyfish_fetch to spot-check 2-3 key claims. Flag any that are wrong, outdated, or unverifiable.
2. **AI-pattern check** — Flag sentences that sound like AI: inflated significance, rule-of-three, em dash overuse, AI vocabulary (delve, landscape, tapestry, seamless, crucial, pivotal), promotional language, vague attributions, Title-Case headings, curly quotes.
3. **Guidelines check** — Verify valid frontmatter (title required, image required), max 3 tags, working imports/widgets, proper SEO description.
4. **Quality check** — Is it specific, practical, well-structured, with a real human voice?

You MUST respond with ONLY a JSON object (no markdown fences, no text before or after) in this exact shape:
{"pass": true, "score": 8, "accuracy": "...", "humanization": "...", "guidelines": "...", "issues": ["issue 1"], "summary": "..."}

Set "pass" to true only if score >= 7 AND there are no blocking accuracy or guideline issues. Otherwise false with concrete issues.`;
    },
    model: JUDGE_MODEL,
    memory,
    tools: { tinyfishSearch, tinyfishFetch },
    defaultOptions: { maxSteps: AGENT_MAX_STEPS },
});

// Parse the judge's JSON text response. Falls back to a fail verdict if the
// text isn't valid JSON.
export function parseJudgeVerdict(
    text: string,
): z.infer<typeof judgeVerdictSchema> {
    // Strip markdown fences if present.
    let cleaned = text
        .trim()
        .replace(/^```(?:json)?\s*\n?/i, "")
        .replace(/\n?```\s*$/i, "");
    // Find the first { and last } to extract the JSON object.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
        cleaned = cleaned.slice(start, end + 1);
    }
    try {
        const obj = JSON.parse(cleaned);
        return {
            pass: Boolean(obj.pass),
            score: Number(obj.score) || 5,
            accuracy: String(obj.accuracy ?? ""),
            humanization: String(obj.humanization ?? ""),
            guidelines: String(obj.guidelines ?? ""),
            issues: Array.isArray(obj.issues) ? obj.issues.map(String) : [],
            summary: String(obj.summary ?? ""),
        };
    } catch {
        return {
            pass: false,
            score: 5,
            accuracy: "",
            humanization: "",
            guidelines: "",
            issues: ["Judge response was not valid JSON"],
            summary: `Unparseable judge response: ${text.slice(0, 200)}`,
        };
    }
}

export const judgeVerdictSchema = z.object({
    pass: z.boolean(),
    score: z.number(),
    accuracy: z.string(),
    humanization: z.string(),
    guidelines: z.string(),
    issues: z.array(z.string()),
    summary: z.string(),
});
