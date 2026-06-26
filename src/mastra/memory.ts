import { Memory } from "@mastra/memory";
import { LibSQLVector } from "@mastra/libsql";
import { fastembed } from "@mastra/fastembed";
import { DATABASE_URL } from "./paths";

// Working memory (resource-scoped Markdown scratchpad) + semantic recall
// (vector search over past messages using a local embedder).
//
// - Storage: instance-level composite store (LibSQL default + DuckDB
//   observability) wired in src/mastra/index.ts; Memory inherits it.
// - Vector store: LibSQLVector on the same database file.
// - Embedder: @mastra/fastembed runs locally (bge-small-en-v1.5) via ONNX
//   Runtime, so no embedding API key is needed. First use downloads the model.
// - Working memory: persists across all threads for a resource (user).
export const memory = new Memory({
    vector: new LibSQLVector({
        id: "agent-vector",
        url: DATABASE_URL,
    }),
    embedder: fastembed,
    options: {
        semanticRecall: {
            topK: 3,
            messageRange: 2,
        },
        workingMemory: {
            enabled: true,
            scope: "resource",
            template: `# User Profile

## Identity
- Name: Dragos
- Timezone: Bucharest
- Preferred Language: English
- About me: I am an online blogger that writes articles on nitdoze.com on web, dev, ai, devops. I have also an youtube channel @webdoze where I post videos on similar subjects.
- My goal: My goal is to learn new things, be informed and make money online. I like building things and I need help from AI.
## Environment
- OS: Ubuntu
- Runtime/Stack: mastra.ai you are build on, the project is under /home/dragos/projects/mastra-app, the skill to see the docs under /home/dragos/projects/mastra-app/.agents/skills/mastra/SKILL.md. More details under /home/dragos/projects/mastra-app/AGENTS.md
- Editor:

## Preferences
- Communication Style:  concise
- Coding Conventions:

## Session State
- Active Task:
- Open Questions:
- Decisions Made:
`,
        },
    },
});
