import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RerunJob, ReviewRun } from "../shared/types.js";
import { CodexRunner } from "../agents/codex.js";
import { PreprError } from "../core/errors.js";
import { addDismissedFingerprint, loadRun, updateFindings, updateMetadataCounts, updateUiState } from "../core/storage.js";
import { countFindings, createReviewRun, runDirectory } from "../core/run.js";
import { writeExports } from "../core/export.js";
import { openEditor } from "./editor.js";

export interface ServerOptions {
  repoRoot: string;
  runId?: string;
  baseRef?: string;
  risk?: "low" | "medium" | "high";
  only?: ReviewRun["metadata"]["only"];
  noAgent?: boolean;
}

const jobs = new Map<string, RerunJob>();

export async function startServer(options: ServerOptions & { port?: number }): Promise<{ server: http.Server; port: number; url: string }> {
  let run = await loadRun(options.repoRoot, options.runId);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) {
        const result = await handleApi(req, url, options, () => run, (next) => {
          run = next;
        });
        sendJson(res, result);
        return;
      }
      await serveAsset(res, url.pathname);
    } catch (error) {
      const status = error instanceof PreprError ? 400 : 500;
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, status);
    }
  });
  const port = await listen(server, options.port ?? 0);
  return { server, port, url: `http://127.0.0.1:${port}` };
}

async function handleApi(
  req: http.IncomingMessage,
  url: URL,
  options: ServerOptions,
  getRun: () => ReviewRun,
  setRun: (run: ReviewRun) => void
): Promise<unknown> {
  const run = getRun();
  if (req.method === "GET" && url.pathname === "/api/run") return run.metadata;
  if (req.method === "GET" && url.pathname === "/api/diff") return run.diff;
  if (req.method === "GET" && url.pathname === "/api/findings") return run.findings;
  if (req.method === "POST" && url.pathname.match(/^\/api\/findings\/[^/]+\/dismiss$/)) {
    const id = decodeURIComponent(url.pathname.split("/")[3]);
    const target = run.findings.find((f) => f.id === id);
    if (!target) throw new PreprError(`Unknown finding ${id}`, "UNKNOWN_FINDING");
    await addDismissedFingerprint(options.repoRoot, target.fingerprint);
    const next = await updateFindings(options.repoRoot, run.metadata.id, (findings) =>
      findings.map((f) => (f.id === id ? { ...f, status: "dismissed" } : f))
    );
    const counts = countFindings(run.diff.length, next);
    await updateMetadataCounts(options.repoRoot, run.metadata.id, counts);
    setRun({ ...run, findings: next, metadata: { ...run.metadata, counts } });
    return { findings: next };
  }
  if (req.method === "POST" && url.pathname.match(/^\/api\/findings\/[^/]+\/mark-fixed$/)) {
    const id = decodeURIComponent(url.pathname.split("/")[3]);
    if (!run.findings.some((f) => f.id === id)) throw new PreprError(`Unknown finding ${id}`, "UNKNOWN_FINDING");
    const next = await updateFindings(options.repoRoot, run.metadata.id, (findings) => findings.map((f) => (f.id === id ? { ...f, status: "fixed" } : f)));
    const counts = countFindings(run.diff.length, next);
    await updateMetadataCounts(options.repoRoot, run.metadata.id, counts);
    setRun({ ...run, findings: next, metadata: { ...run.metadata, counts } });
    return { findings: next };
  }
  if (req.method === "POST" && url.pathname === "/api/rerun") {
    const job = queueRerun(options, run, setRun);
    return job;
  }
  if (req.method === "GET" && url.pathname.match(/^\/api\/jobs\/[^/]+$/)) {
    const id = decodeURIComponent(url.pathname.split("/")[3]);
    const job = jobs.get(id);
    if (!job) throw new PreprError(`Unknown job ${id}`, "UNKNOWN_JOB");
    return job;
  }
  if (req.method === "POST" && url.pathname === "/api/export") {
    return writeExports(runDirectory(options.repoRoot, run.metadata.id), run);
  }
  if (req.method === "POST" && url.pathname === "/api/open-editor") {
    const body = await readBody(req);
    if (!isRecord(body) || typeof body.file !== "string") throw new PreprError("open-editor requires { file, line? }.", "INVALID_BODY");
    await openEditor(options.repoRoot, body.file, typeof body.line === "number" ? body.line : undefined);
    return { ok: true };
  }
  if (req.method === "POST" && url.pathname === "/api/ui-state") {
    const body = await readBody(req);
    if (!isRecord(body)) throw new PreprError("ui-state must be an object.", "INVALID_BODY");
    await updateUiState(options.repoRoot, run.metadata.id, body);
    setRun({ ...run, uiState: body });
    return { ok: true };
  }
  throw new PreprError(`No route for ${req.method} ${url.pathname}`, "NOT_FOUND");
}

function queueRerun(options: ServerOptions, previous: ReviewRun, setRun: (run: ReviewRun) => void): RerunJob {
  const id = `job-${Date.now().toString(36)}`;
  const job: RerunJob = { id, status: "queued", createdAt: new Date().toISOString() };
  jobs.set(id, job);
  setImmediate(async () => {
    jobs.set(id, { ...job, status: "running" });
    try {
      const { run } = await createReviewRun({
        cwd: options.repoRoot,
        baseRef: options.baseRef ?? previous.metadata.baseRef,
        headRef: "HEAD",
        risk: options.risk ?? previous.metadata.risk,
        only: options.only ?? previous.metadata.only,
        agentName: options.noAgent ? "none" : "codex",
        runner: options.noAgent ? undefined : new CodexRunner(),
        previous: previous.findings
      });
      setRun(run);
      jobs.set(id, { id, status: "done", createdAt: job.createdAt, completedAt: new Date().toISOString(), runId: run.metadata.id });
    } catch (error) {
      jobs.set(id, { id, status: "failed", createdAt: job.createdAt, completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
    }
  });
  return job;
}

async function serveAsset(res: http.ServerResponse, route: string): Promise<void> {
  const uiDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../ui/dist");
  const clean = route === "/" ? "/index.html" : route;
  const file = path.resolve(uiDist, clean.slice(1));
  const target = file.startsWith(uiDist) ? file : path.join(uiDist, "index.html");
  const data = await fs.readFile(target).catch(() => undefined);
  if (!data) {
    res.writeHead(200, { "content-type": "text/html; charset=utf8" });
    res.end("<div id=\"app\">prepr UI has not been built. Run npm run build:ui.</div>");
    return;
  }
  res.writeHead(200, { "content-type": contentType(target) });
  res.end(data);
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : port);
    });
  });
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
}

function sendJson(res: http.ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf8" });
  res.end(`${JSON.stringify(value, null, 2)}\n`);
}

function contentType(file: string): string {
  if (file.endsWith(".js")) return "text/javascript; charset=utf8";
  if (file.endsWith(".css")) return "text/css; charset=utf8";
  if (file.endsWith(".html")) return "text/html; charset=utf8";
  return "application/octet-stream";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
