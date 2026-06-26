<script lang="ts">
  import {
    CheckCircle,
    ChevronDown,
    ChevronRight,
    Copy,
    Download,
    ExternalLink,
    Eye,
    EyeOff,
    GitBranch,
    RefreshCw,
    SplitSquareHorizontal,
    XCircle
  } from "lucide-svelte";
  import type { DiffFile, DiffLine, ReviewFinding, RunMetadata } from "../../src/shared/types";

  let metadata: RunMetadata | undefined;
  let diff: DiffFile[] = [];
  let findings: ReviewFinding[] = [];
  let selectedId = "";
  let severity = "all";
  let category = "all";
  let showDismissed = false;
  let mode: "unified" | "split" = "unified";
  let expanded = new Set<string>();
  let busy = "";
  let error = "";

  const severities = ["all", "critical", "high", "medium", "low", "info"];
  const categories = ["all", "bug", "security", "performance", "maintainability", "test", "docs", "style"];

  $: visibleFindings = findings.filter((finding) => {
    if (!showDismissed && finding.status === "dismissed") return false;
    if (severity !== "all" && finding.severity !== severity) return false;
    if (category !== "all" && finding.category !== category) return false;
    return true;
  });
  $: selected = findings.find((finding) => finding.id === selectedId) ?? visibleFindings[0];
  $: filesWithFindings = new Map(diff.map((file) => [file.newPath, visibleFindings.filter((finding) => finding.location.file === file.newPath)]));

  load();

  async function load() {
    try {
      error = "";
      const [runRes, diffRes, findingsRes] = await Promise.all([fetch("/api/run"), fetch("/api/diff"), fetch("/api/findings")]);
      metadata = await runRes.json();
      diff = await diffRes.json();
      findings = await findingsRes.json();
      expanded = new Set(diff.map((file) => file.newPath));
      selectedId = findings[0]?.id ?? "";
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  async function post(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) throw new Error((await response.json()).error ?? response.statusText);
    return response.json();
  }

  async function dismiss(finding: ReviewFinding) {
    busy = finding.id;
    try {
      const response = await post(`/api/findings/${finding.id}/dismiss`);
      findings = response.findings;
    } finally {
      busy = "";
    }
  }

  async function markFixed(finding: ReviewFinding) {
    busy = finding.id;
    try {
      const response = await post(`/api/findings/${finding.id}/mark-fixed`);
      findings = response.findings;
    } finally {
      busy = "";
    }
  }

  async function rerun() {
    busy = "rerun";
    try {
      const job = await post("/api/rerun");
      await pollJob(job.id);
      await load();
    } finally {
      busy = "";
    }
  }

  async function pollJob(id: string) {
    while (true) {
      const job = await (await fetch(`/api/jobs/${id}`)).json();
      if (job.status === "done") return;
      if (job.status === "failed") throw new Error(job.error ?? "Rerun failed");
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
  }

  async function exportRun() {
    await post("/api/export");
  }

  async function openEditor(finding: ReviewFinding) {
    await post("/api/open-editor", { file: finding.location.file, line: finding.location.line });
  }

  async function copyFinding(finding: ReviewFinding) {
    await navigator.clipboard.writeText(`${finding.location.file}${finding.location.line ? `:${finding.location.line}` : ""}\n${finding.title}\n${finding.claim}`);
  }

  function toggleFile(file: string) {
    const next = new Set(expanded);
    if (next.has(file)) next.delete(file);
    else next.add(file);
    expanded = next;
    saveUiState();
  }

  function saveUiState() {
    void post("/api/ui-state", { severity, category, showDismissed, mode, expanded: [...expanded] }).catch(() => {});
  }

  function lineFindings(file: string, line?: number) {
    return visibleFindings.filter((finding) => finding.location.file === file && finding.location.line === line);
  }

  function lineClass(line: DiffLine) {
    if (line.kind === "add") return "bg-emerald-50";
    if (line.kind === "del") return "bg-red-50";
    return "bg-white";
  }
</script>

<main class="min-h-screen bg-[#f6f8fa] text-[#1f2328]">
  <header class="border-b border-[#d0d7de] bg-white px-4 py-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="flex items-center gap-2 text-sm text-[#57606a]">
          <GitBranch size={16} />
          <span>{metadata?.branch ?? "loading"}</span>
          <span>base {metadata?.baseRef}</span>
          <span>{metadata?.headSha?.slice(0, 8)}</span>
        </div>
        <h1 class="mt-1 text-xl font-semibold">prepr review</h1>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="rounded border border-[#d0d7de] bg-[#f6f8fa] px-2 py-1 text-sm">{metadata?.counts.open ?? 0} open</span>
        <span class="rounded border border-[#d0d7de] bg-[#f6f8fa] px-2 py-1 text-sm">{metadata?.counts.dismissed ?? 0} dismissed</span>
        <button class="inline-flex h-9 items-center gap-2 rounded border border-[#d0d7de] bg-white px-3 text-sm hover:bg-[#f6f8fa]" on:click={rerun} disabled={busy === "rerun"} title="Rerun review">
          <RefreshCw size={16} /> Rerun
        </button>
        <button class="inline-flex h-9 items-center gap-2 rounded border border-[#d0d7de] bg-white px-3 text-sm hover:bg-[#f6f8fa]" on:click={exportRun} title="Export review">
          <Download size={16} /> Export
        </button>
      </div>
    </div>
    {#if error}<p class="mt-2 text-sm text-red-700">{error}</p>{/if}
  </header>

  <div class="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_340px]">
    <aside class="border-b border-[#d0d7de] bg-white p-3 lg:min-h-[calc(100vh-73px)] lg:border-b-0 lg:border-r">
      <div class="grid grid-cols-2 gap-2">
        <select class="h-9 rounded border border-[#d0d7de] bg-white px-2 text-sm" bind:value={severity} on:change={saveUiState} aria-label="Severity filter">
          {#each severities as item}<option value={item}>{item}</option>{/each}
        </select>
        <select class="h-9 rounded border border-[#d0d7de] bg-white px-2 text-sm" bind:value={category} on:change={saveUiState} aria-label="Category filter">
          {#each categories as item}<option value={item}>{item}</option>{/each}
        </select>
      </div>
      <div class="mt-3 flex items-center justify-between gap-2">
        <button class="inline-flex h-9 items-center gap-2 rounded border border-[#d0d7de] bg-white px-3 text-sm" on:click={() => { showDismissed = !showDismissed; saveUiState(); }} title="Toggle dismissed findings">
          {#if showDismissed}<Eye size={16} />{:else}<EyeOff size={16} />{/if}
          Dismissed
        </button>
        <button class="inline-flex h-9 items-center gap-2 rounded border border-[#d0d7de] bg-white px-3 text-sm" on:click={() => { mode = mode === "unified" ? "split" : "unified"; saveUiState(); }} title="Toggle diff mode">
          <SplitSquareHorizontal size={16} /> {mode}
        </button>
      </div>
      <nav class="mt-4 space-y-1">
        {#each diff as file}
          <button class="flex w-full items-center justify-between gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[#f6f8fa]" on:click={() => toggleFile(file.newPath)}>
            <span class="flex min-w-0 items-center gap-2">
              {#if expanded.has(file.newPath)}<ChevronDown size={15} />{:else}<ChevronRight size={15} />{/if}
              <span class="truncate">{file.newPath}</span>
            </span>
            <span class="shrink-0 text-xs text-[#57606a]">{filesWithFindings.get(file.newPath)?.length ?? 0}</span>
          </button>
        {/each}
      </nav>
    </aside>

    <section class="min-w-0 p-3">
      {#each diff as file}
        {#if expanded.has(file.newPath)}
          <article class="mb-3 overflow-hidden rounded border border-[#d0d7de] bg-white">
            <div class="flex items-center justify-between border-b border-[#d0d7de] bg-[#f6f8fa] px-3 py-2 font-mono text-sm">
              <span class="truncate">{file.newPath}</span>
              <span class="text-[#57606a]">+{file.additions} -{file.deletions}</span>
            </div>
            {#if file.binary}
              <p class="p-3 text-sm text-[#57606a]">Binary file changed.</p>
            {:else}
              {#each file.hunks as hunk}
                <div class="border-b border-[#d8dee4] bg-[#ddf4ff] px-3 py-1 font-mono text-xs text-[#57606a]">{hunk.header}</div>
                {#if mode === "unified"}
                  {#each hunk.lines as line}
                    <div class={`grid diff-grid font-mono text-xs leading-5 ${lineClass(line)}`}>
                      <div class="select-none border-r border-[#d0d7de] px-2 text-right text-[#57606a]">{line.newLine ?? line.oldLine ?? ""}</div>
                      <div class="min-w-0 whitespace-pre-wrap px-2">
                        <span>{line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}</span>{line.content}
                        {#each lineFindings(file.newPath, line.newLine) as finding}
                          <button class="ml-2 rounded bg-amber-100 px-1 text-[11px] text-amber-900" on:click={() => (selectedId = finding.id)}>{finding.severity}</button>
                        {/each}
                      </div>
                    </div>
                  {/each}
                {:else}
                  {#each hunk.lines as line}
                    <div class={`grid side-grid font-mono text-xs leading-5 ${lineClass(line)}`}>
                      <div class="select-none border-r border-[#d0d7de] px-2 text-right text-[#57606a]">{line.oldLine ?? ""}</div>
                      <div class="min-w-0 whitespace-pre-wrap border-r border-[#d0d7de] px-2">{line.kind === "add" ? "" : line.content}</div>
                      <div class="select-none border-r border-[#d0d7de] px-2 text-right text-[#57606a]">{line.newLine ?? ""}</div>
                      <div class="min-w-0 whitespace-pre-wrap px-2">{line.kind === "del" ? "" : line.content}</div>
                    </div>
                  {/each}
                {/if}
              {/each}
            {/if}
          </article>
        {/if}
      {/each}
    </section>

    <aside class="border-t border-[#d0d7de] bg-white p-3 lg:min-h-[calc(100vh-73px)] lg:border-l lg:border-t-0">
      <h2 class="text-sm font-semibold">Findings</h2>
      <div class="mt-3 space-y-2">
        {#each visibleFindings as finding}
          <button class={`w-full rounded border p-2 text-left text-sm ${selected?.id === finding.id ? "border-[#0969da] bg-[#ddf4ff]" : "border-[#d0d7de] bg-white"}`} on:click={() => (selectedId = finding.id)}>
            <div class="flex items-center justify-between gap-2">
              <span class="font-medium">{finding.title}</span>
              <span class="rounded bg-[#f6f8fa] px-1.5 py-0.5 text-xs">{finding.status}</span>
            </div>
            <div class="mt-1 truncate text-xs text-[#57606a]">{finding.location.file}{finding.location.line ? `:${finding.location.line}` : ""}</div>
          </button>
        {/each}
      </div>
      {#if selected}
        <section class="mt-4 border-t border-[#d0d7de] pt-4">
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="rounded bg-red-50 px-2 py-1 text-red-800">{selected.severity}</span>
            <span class="rounded bg-blue-50 px-2 py-1 text-blue-800">{selected.category}</span>
            <span class="rounded bg-slate-100 px-2 py-1">{selected.confidence}</span>
          </div>
          <h3 class="mt-3 text-base font-semibold">{selected.title}</h3>
          <p class="mt-2 text-sm leading-6">{selected.claim}</p>
          {#if selected.suggestion}<p class="mt-2 text-sm leading-6 text-[#57606a]">{selected.suggestion}</p>{/if}
          <div class="mt-4 grid grid-cols-2 gap-2">
            <button class="inline-flex h-9 items-center justify-center gap-2 rounded border border-[#d0d7de] bg-white text-sm" on:click={() => copyFinding(selected)} title="Copy finding"><Copy size={16} /> Copy</button>
            <button class="inline-flex h-9 items-center justify-center gap-2 rounded border border-[#d0d7de] bg-white text-sm" on:click={() => openEditor(selected)} title="Open in editor"><ExternalLink size={16} /> Editor</button>
            <button class="inline-flex h-9 items-center justify-center gap-2 rounded border border-[#d0d7de] bg-white text-sm" on:click={() => markFixed(selected)} disabled={busy === selected.id} title="Mark fixed"><CheckCircle size={16} /> Fixed</button>
            <button class="inline-flex h-9 items-center justify-center gap-2 rounded border border-[#d0d7de] bg-white text-sm" on:click={() => dismiss(selected)} disabled={busy === selected.id} title="Dismiss"><XCircle size={16} /> Dismiss</button>
          </div>
        </section>
      {/if}
    </aside>
  </div>
</main>
