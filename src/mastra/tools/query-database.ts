import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createClient } from "@libsql/client";
import { DATABASE_URL, DUCKDB_PATH } from "../paths";

// Read-only SQL query against the LibSQL (default) or DuckDB (observability)
// store. Writes are blocked at the SQL level to prevent corruption from
// hallucinated mutations. DuckDB is queried through the in-process store when
// possible (avoids file-lock conflicts with the running service). The Mastra
// instance is resolved lazily to avoid a circular import (this tool is
// referenced by agents that index.ts imports).
const ALLOWED_SQL = /^\s*SELECT\b/i;
// Block statements that mutate even if prefixed by a SELECT-shaped comment.
const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|ATTACH|DETACH|PRAGMA)\b/i;

async function getDuckDBInstance(): Promise<any> {
  // Resolve the in-process Mastra composite store's DuckDB instance if present.
  try {
    const mod = await import("../index");
    const anyMastra = (mod as any).mastra;
    const compositeStore = anyMastra?.storage ?? anyMastra?._storage ?? anyMastra?.__storage;
    const domainStore =
      compositeStore?.domains?.observability ?? compositeStore?.observabilityStore;
    const obs =
      typeof domainStore?.observability === "function"
        ? await domainStore.observability()
        : domainStore;
    const db = obs?.db ?? domainStore?.db;
    if (db) return db;
  } catch {
    // index not yet initialized or store missing — fall through.
  }
  return null;
}

export const queryDatabase = createTool({
  id: "query_database",
  description:
    "Run a read-only SQL query against the LibSQL store (threads, memory, workflows, schedules) " +
    "or the DuckDB observability store (traces, spans). Use for inspecting data, debugging, or ad-hoc analytics. " +
    "Only SELECT queries are allowed.",
  inputSchema: z.object({
    sql: z.string().describe("SQL SELECT query to execute (read-only)"),
    store: z
      .enum(["libsql", "duckdb"])
      .default("libsql")
      .describe("Which store to query. Use 'duckdb' for observability traces/spans."),
  }),
  outputSchema: z.object({
    columns: z.array(z.string()),
    rows: z.array(z.record(z.string(), z.unknown())),
    rowCount: z.number(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    const sql = input.sql.trim().replace(/;+$/, "");
    if (!ALLOWED_SQL.test(sql)) {
      return errorResult("Only SELECT queries are allowed for safety.");
    }
    // Strip comment lines before checking for forbidden statements.
    const stripped = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (FORBIDDEN.test(stripped)) {
      return errorResult("Only SELECT queries are allowed for safety.");
    }

    if (input.store === "libsql") {
      const client = createClient({ url: DATABASE_URL });
      try {
        const rs = await client.execute(sql);
        return {
          columns: rs.columns,
          rows: rs.rows.map((row) => {
            const obj: Record<string, unknown> = {};
            for (const col of rs.columns) obj[col] = (row as Record<string, unknown>)[col];
            return obj;
          }),
          rowCount: rs.rows.length,
        };
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      } finally {
        client.close();
      }
    }

    // DuckDB: prefer the in-process store connection to avoid file-lock
    // conflicts with the running service. Fall back to a read-only file open.
    try {
      const db = await getDuckDBInstance();
      if (db) {
        const conn = await db.connect();
        try {
          const reader = await conn.runAndReadAll(sql);
          const columns = reader.columnNames() as unknown as string[];
          const rows = reader.getRowObjects() as Record<string, unknown>[];
          return { columns, rows, rowCount: rows.length };
        } finally {
          conn.closeSync();
        }
      }
    } catch {
      // fall through to read-only file open
    }

    try {
      const { DuckDBInstance } = await import("@duckdb/node-api");
      const db = await DuckDBInstance.create(DUCKDB_PATH, { access_mode: "READ_ONLY" });
      const conn = await db.connect();
      try {
        const reader = await conn.runAndReadAll(sql);
        const columns = reader.columnNames() as unknown as string[];
        const rows = reader.getRowObjects() as Record<string, unknown>[];
        return { columns, rows, rowCount: rows.length };
      } finally {
        conn.closeSync();
        await db.closeSync?.();
      }
    } catch (error) {
      return errorResult(
        `DuckDB read failed (the service may hold a write lock): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
});

function errorResult(error: string) {
  return { columns: [], rows: [], rowCount: 0, error };
}
