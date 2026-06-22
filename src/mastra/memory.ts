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
- Name:
- Timezone:
- Preferred Language:

## Environment
- OS:
- Runtime/Stack:
- Editor:

## Preferences
- Communication Style: [e.g., concise, detailed]
- Coding Conventions:

## Session State
- Active Task:
- Open Questions:
- Decisions Made:
`,
    },
  },
});
