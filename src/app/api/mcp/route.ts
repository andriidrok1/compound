/**
 * Compound MCP server — JSON-RPC 2.0 over HTTP.
 * Spec: https://modelcontextprotocol.io/specification
 *
 * Supports: initialize, tools/list, tools/call.
 * Anthropic's cloud Routines can connect to this via /api/mcp once deployed publicly.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  listTopics,
  researchTopic,
  addNoteToVault,
  crossReference,
} from "@/lib/compound-tools";
import { logToolCall, logVaultAddition } from "@/lib/convex-server";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SERVER_INFO = {
  name: "compound",
  version: "0.1.0",
};

const TOOLS = [
  {
    name: "list_topics",
    description:
      "List active research topics extracted from the user's Obsidian vault. Returns top-level folders and the most-frequently-linked notes (hotLinks).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "research_topic",
    description:
      "Search external sources (arxiv, web) for new content about a topic. Returns only papers not already researched (de-duplicated against per-topic Tensorlake state).",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "The topic to research." },
        limit: { type: "number", description: "Max papers to return.", default: 5 },
      },
      required: ["topic"],
      additionalProperties: false,
    },
  },
  {
    name: "add_note_to_vault",
    description:
      "Write a markdown note to the Obsidian vault's 'Atlas additions' folder. Use [[wikilinks]] to existing notes for graph integration.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Filename (without path)." },
        content: { type: "string", description: "Markdown content with wikilinks." },
        topic: { type: "string", description: "Topic this note belongs to." },
      },
      required: ["filename", "content", "topic"],
      additionalProperties: false,
    },
  },
  {
    name: "cross_reference",
    description:
      "Find vault notes related to a specific paper and topic. Returns related-note paths and a synthesis paragraph.",
    inputSchema: {
      type: "object",
      properties: {
        paperTitle: { type: "string" },
        topic: { type: "string" },
      },
      required: ["paperTitle", "topic"],
      additionalProperties: false,
    },
  },
];

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: any;
}

function jsonRpcResult(id: any, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function jsonRpcError(id: any, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0" as const,
    id,
    error: { code, message, data },
  };
}

async function handleMethod(req: JsonRpcRequest) {
  switch (req.method) {
    case "initialize": {
      return jsonRpcResult(req.id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: SERVER_INFO,
      });
    }

    case "notifications/initialized":
    case "notifications/cancelled": {
      // notifications expect no response (no id)
      return null;
    }

    case "tools/list": {
      return jsonRpcResult(req.id, { tools: TOOLS });
    }

    case "tools/call": {
      const { name, arguments: args } = req.params ?? {};
      const start = Date.now();
      try {
        const data = await callTool(name, args ?? {});
        const durationMs = Date.now() - start;

        // Best-effort Convex logging (won't block on failure)
        void logToolCall({
          tool: name,
          args,
          result: data,
          durationMs,
          source: "routine",
        });

        // Side-channel: if a note was just added, log a vault_addition row
        if (name === "add_note_to_vault" && data && typeof data === "object" && "path" in data) {
          const d = data as { path: string; topic: string; size: number };
          void logVaultAddition({
            topic: d.topic,
            title: path.basename(d.path).replace(/\.md$/, ""),
            relativePath: d.path,
            sizeBytes: d.size,
            trigger: "routine",
          });
        }

        return jsonRpcResult(req.id, {
          content: [
            {
              type: "text",
              text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
            },
          ],
        });
      } catch (err: any) {
        const durationMs = Date.now() - start;
        void logToolCall({
          tool: name,
          args,
          result: { error: err?.message ?? String(err) },
          durationMs,
          isError: true,
          source: "routine",
        });
        return jsonRpcResult(req.id, {
          content: [
            { type: "text", text: `Error: ${err?.message ?? String(err)}` },
          ],
          isError: true,
        });
      }
    }

    case "ping":
      return jsonRpcResult(req.id, {});

    default:
      return jsonRpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

async function callTool(name: string, args: any) {
  switch (name) {
    case "list_topics":
      return listTopics();
    case "research_topic":
      return researchTopic(args.topic, args.limit ?? 5);
    case "add_note_to_vault":
      return addNoteToVault(args.filename, args.content, args.topic);
    case "cross_reference":
      return crossReference(args.paperTitle, args.topic);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function POST(req: NextRequest) {
  let body: JsonRpcRequest | JsonRpcRequest[];
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(jsonRpcError(null, -32700, "Parse error"), { status: 400 });
  }

  // Handle batch
  if (Array.isArray(body)) {
    const responses = await Promise.all(body.map(handleMethod));
    return NextResponse.json(responses.filter(Boolean));
  }

  const resp = await handleMethod(body);
  if (resp === null) {
    return new NextResponse(null, { status: 204 });
  }
  return NextResponse.json(resp);
}

export async function GET() {
  // Discovery / health
  return NextResponse.json({
    server: SERVER_INFO,
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    status: "ok",
  });
}
