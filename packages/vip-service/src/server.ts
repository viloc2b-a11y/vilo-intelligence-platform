import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config } from "dotenv";
import { createVIPHttpHandler } from "./http.js";
import { createSupabaseVIPService } from "./supabase.js";

config({ path: ".env.local" });
config();

const port = Number(process.env.PORT ?? 8787);
const apiKey = requireEnv("VIP_API_KEY");
const service = createSupabaseVIPService({
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY")
});
const handler = createVIPHttpHandler({
  apiKey,
  createResolvers: service.createResolvers,
  artifactStore: service.artifactStore,
  healthReader: service.healthReader
});

const server = createServer(async (incoming, outgoing) => {
  try {
    const request = await toFetchRequest(incoming);
    const response = await handler(request);
    await writeFetchResponse(outgoing, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected VIP service error.";
    outgoing.writeHead(500, { "content-type": "application/json" });
    outgoing.end(
      JSON.stringify({
        traceId: incoming.headers["x-trace-id"] ?? "unavailable",
        error: {
          code: "internal_error",
          message
        }
      })
    );
  }
});

server.listen(port, () => {
  console.log(`VIP HTTP service listening on http://localhost:${port}`);
});

async function toFetchRequest(incoming: IncomingMessage): Promise<Request> {
  const host = incoming.headers.host ?? `localhost:${port}`;
  const url = new URL(incoming.url ?? "/", `http://${host}`);
  const headers = new Headers();

  for (const [key, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const bodyBuffer =
    incoming.method === "GET" || incoming.method === "HEAD" ? undefined : await readBody(incoming);
  const body = bodyBuffer ? new Uint8Array(bodyBuffer) : undefined;

  return new Request(url, {
    method: incoming.method,
    headers,
    body
  });
}

async function readBody(incoming: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function writeFetchResponse(outgoing: ServerResponse, response: Response): Promise<void> {
  outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  const body = Buffer.from(await response.arrayBuffer());
  outgoing.end(body);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
