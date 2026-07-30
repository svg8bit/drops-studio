import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const path = specifier.slice(2);
    return { shortCircuit: true, url: new URL(path.endsWith(".ts") ? path : `${path}.ts`, new URL("../", import.meta.url)).href };
  },
});

const {
  BUILDER_TOOL_NAMES,
  MemoryBuilderAgentAuditSink,
  createBuilderAgentTools,
  createBuilderToolApproval,
} = await import("../lib/builder-agent/index.ts");

function command(kind = "build") {
  return {
    commandId: `command-${kind}`,
    runId: `run-${kind}`,
    kind,
    argv: ["npm", "run", kind],
    cwd: "/sandbox/project",
    exitCode: 0,
    stdout: `${kind} passed\n`,
    stderr: "",
    outputTruncated: false,
    startedAt: "2026-07-30T12:00:00.000Z",
    finishedAt: "2026-07-30T12:00:01.000Z",
    previewUrl: null,
  };
}

function services(permissionOverrides) {
  let project = {
    id: "builder-tools-project",
    revision: 2,
    files: {
      "app/page.tsx": { path: "app/page.tsx", content: "export default function Page(){ return <main>One</main>; }", hash: "one" },
      "package.json": { path: "package.json", content: "{}", hash: "package" },
    },
  };
  const permissions = permissionOverrides ?? new Set([
    "files:read", "files:write", "runtime:execute", "runtime:network",
    "preview:start", "browser:check", "checkpoint:write", "checkpoint:restore",
    "connection:request", "project:publish",
  ]);
  return {
    actorId: "builder-tool-actor",
    requestId: "builder-tool-request",
    permissions,
    get project() { return structuredClone(project); },
    get runtimeContext() { return { actorId: this.actorId, requestId: this.requestId, project }; },
    listFiles: () => Object.keys(project.files).sort(),
    readFile: (path) => project.files[path].content,
    readFiles: (paths) => paths.map((path) => ({ path, content: project.files[path].content })),
    searchFiles: (query) => [{ path: "app/page.tsx", line: 1, text: query }],
    async writeFile(path, content) {
      project = { ...project, revision: project.revision + 1, files: { ...project.files, [path]: { path, content, hash: "updated" } } };
      return structuredClone(project);
    },
    async applyPatch(path, replacements) {
      let content = project.files[path].content;
      for (const entry of replacements) content = content.replace(entry.search, entry.replace);
      return this.writeFile(path, content);
    },
    async deleteFile(path) { delete project.files[path]; project.revision += 1; return structuredClone(project); },
    async renameFile(from, to) { project.files[to] = { ...project.files[from], path: to }; delete project.files[from]; project.revision += 1; return structuredClone(project); },
    async installPackage() { return command("install"); },
    async runTask() { return command("command"); },
    async startPreview() { return { ...command("preview"), exitCode: null, previewUrl: "https://preview.example.test/", port: 3000 }; },
    async readLogs() { return [{ sequence: 0, stream: "stdout", data: "real log", recordedAt: "2026-07-30T12:00:00.000Z" }]; },
    async runTypecheck() { return command("typecheck"); },
    async runLint() { return command("lint"); },
    async runTests() { return command("test"); },
    async runBuild() { return command("build"); },
    async browserCheck() { return { ok: true, rendered: true, primaryInteractionChecked: true, statusCode: 200, pageErrors: [], consoleErrors: [], networkErrors: [], summary: "Browser passed." }; },
    async createCheckpoint() { return { project: structuredClone(project), checkpoint: { checkpointId: "checkpoint-1", revision: project.revision, files: [] } }; },
    async restoreCheckpoint() { project.revision += 1; return structuredClone(project); },
    async requestConnection() { return { status: "setup-required", message: "Setup required" }; },
    async publishProject() { return { deploymentId: "deployment-1", status: "ready", url: "https://deployment.example.test/" }; },
    async ensureRuntime() { return {}; },
    async runReleaseGate() { return { ok: true, checks: [], blockingErrors: [], previewUrl: "https://preview.example.test/" }; },
  };
}

function executionOptions() {
  return { toolCallId: "tool-call-1", messages: [], abortSignal: AbortSignal.timeout(5_000), context: {} };
}

test("exports the complete required strict tool catalog", () => {
  const tools = createBuilderAgentTools(services(), new MemoryBuilderAgentAuditSink());
  assert.deepEqual(Object.keys(tools), [...BUILDER_TOOL_NAMES]);
  for (const name of BUILDER_TOOL_NAMES) {
    assert.equal(tools[name].strict, true, `${name} must use provider strict mode`);
    assert.ok(tools[name].inputSchema, `${name} must expose an input schema`);
    assert.ok(tools[name].outputSchema, `${name} must expose an output schema`);
  }
});

test("file tools mutate real service state and emit bounded audit events", async () => {
  const service = services();
  const audit = new MemoryBuilderAgentAuditSink();
  const tools = createBuilderAgentTools(service, audit);
  const write = await tools.write_file.execute(
    { path: "components/Card.tsx", content: "export function Card(){ return <p>Card</p>; }" },
    executionOptions(),
  );
  assert.equal(write.revision, 3);
  const listed = await tools.list_files.execute({}, executionOptions());
  assert.ok(listed.files.includes("components/Card.tsx"));
  const patch = await tools.apply_patch.execute({
    path: "app/page.tsx",
    replacements: [{ search: "One", replace: "Two" }],
  }, executionOptions());
  assert.equal(patch.revision, 4);
  assert.match(service.readFile("app/page.tsx"), /Two/);
  assert.deepEqual(audit.events.map((event) => event.status), [
    "started", "succeeded", "started", "succeeded", "started", "succeeded",
  ]);
});

test("tool policy denies missing permissions and blocks provider-token material", async () => {
  const deniedService = services(new Set(["files:read"]));
  const deniedAudit = new MemoryBuilderAgentAuditSink();
  const deniedTools = createBuilderAgentTools(deniedService, deniedAudit);
  await assert.rejects(
    () => deniedTools.write_file.execute({ path: "app/x.ts", content: "export {};" }, executionOptions()),
    /permission/i,
  );
  assert.equal(deniedAudit.events.at(-1).status, "denied");

  const tools = createBuilderAgentTools(services(), new MemoryBuilderAgentAuditSink());
  await assert.rejects(
    () => tools.write_file.execute({
      path: "lib/secret.ts",
      content: 'export const apiKey = "sk-this-is-a-provider-token-value";',
    }, executionOptions()),
    /secret/i,
  );
});

test("approval policy requires a user decision for destructive and external actions", async () => {
  const approval = createBuilderToolApproval(new Set());
  const decision = (name) => approval({
    toolCall: { toolName: name },
    tools: undefined,
    toolsContext: {},
    runtimeContext: {},
    messages: [],
  });
  assert.equal(await decision("write_file"), "approved");
  assert.equal(await decision("delete_file"), "user-approval");
  assert.equal(await decision("restore_checkpoint"), "user-approval");
  assert.equal(await decision("publish_project"), "user-approval");
  const preapproved = createBuilderToolApproval(new Set(["publish_project"]));
  assert.equal(await preapproved({
    toolCall: { toolName: "publish_project" }, tools: undefined, toolsContext: {}, runtimeContext: {}, messages: [],
  }), "approved");
});

test("run_command accepts only a declared task id at the public tool boundary", async () => {
  const tools = createBuilderAgentTools(services(), new MemoryBuilderAgentAuditSink());
  const schema = tools.run_command.inputSchema;
  assert.equal(schema.safeParse({ taskId: "build" }).success, true);
  assert.equal(schema.safeParse({ taskId: "build", command: "rm -rf /" }).success, false);
  const output = await tools.run_command.execute({ taskId: "build" }, executionOptions());
  assert.equal(output.exitCode, 0);
});

test("tool outputs fail closed when a provider returns more than the policy limit", async () => {
  const service = services();
  service.readFile = () => "x".repeat(40_000);
  const tools = createBuilderAgentTools(service, new MemoryBuilderAgentAuditSink());
  await assert.rejects(
    () => tools.read_file.execute({ path: "app/page.tsx" }, executionOptions()),
    /bounded limit/i,
  );
});
