import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

const {
  VercelAgentBrowserChecker,
} = await import("../lib/vercel-agent-browser-checker.ts");

function commandResult(json = { success: true }, stdout = JSON.stringify(json)) {
  return { command: "agent-browser", exitCode: 0, json, stderr: "", stdout };
}

function checkerHarness(overrides = {}) {
  const calls = [];
  let sandboxOptions;
  const checker = new VercelAgentBrowserChecker({
    snapshotId: "snap_browser_test_1234",
    fetchImpl: async () => new Response("<main>Whales</main>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
    withSandbox: async (callback, options) => {
      sandboxOptions = options;
      return callback({ stop: async () => undefined });
    },
    runCommand: async (_sandbox, args) => {
      calls.push(args);
      if (args[0] === "snapshot") return commandResult({ success: true, data: { tree: "button Whale feed" } });
      if (args[0] === "eval" && String(args[1]).includes("readyState")) {
        return commandResult({ success: true, data: { result: {
          readyState: "complete",
          bodyTextLength: 120,
          elementCount: 20,
          interactiveCount: 2,
          title: "Whale Intelligence",
        } } });
      }
      if (args[0] === "eval") {
        return commandResult({ success: true, data: { result: {
          found: true,
          activated: true,
          kind: "button",
          label: "Open alert",
        } } });
      }
      if (args[0] === "errors") {
        return commandResult({ success: true, data: { errors: [] }, error: null });
      }
      if (args[0] === "console") {
        return commandResult({
          success: true,
          data: {
            messages: [{ type: "info", text: "Download the React DevTools" }],
          },
          error: null,
        });
      }
      if (args[0] === "network") return commandResult({ success: true, data: { requests: [{ status: 200, url: "https://preview.vercel.run/" }] } });
      return commandResult();
    },
    ...overrides,
  });
  return { checker, calls, get options() { return sandboxOptions; } };
}

test("runs a real isolated browser smoke flow against only the Sandbox preview host", async () => {
  const harness = checkerHarness();
  const result = await harness.checker.check({
    url: "https://preview-123.vercel.run/",
    project: { id: "project-test" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.rendered, true);
  assert.equal(result.primaryInteractionChecked, true);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.pageErrors, []);
  assert.match(result.summary, /Whale Intelligence/);
  assert.deepEqual(harness.options.createOptions.networkPolicy, {
    allow: ["preview-123.vercel.run"],
  });
  assert.deepEqual(harness.options.createOptions.env, {});
  assert.equal(harness.options.snapshotId, "snap_browser_test_1234");
  assert.equal(harness.options.bootstrap, false);
  assert.ok(harness.calls.some((args) => args[0] === "snapshot"));
  assert.ok(harness.calls.some((args) => args[0] === "network"));
  for (const args of harness.calls.filter((entry) => entry[0] === "eval")) {
    assert.doesNotThrow(() => new vm.Script(args[1]));
  }
});

test("fails the release check on console or failed network evidence", async () => {
  const harness = checkerHarness({
    runCommand: async (_sandbox, args) => {
      if (args[0] === "snapshot") return commandResult({ tree: "button" });
      if (args[0] === "eval" && String(args[1]).includes("readyState")) {
        return commandResult({ result: {
          readyState: "complete",
          bodyTextLength: 40,
          elementCount: 8,
          interactiveCount: 1,
          title: "Broken preview",
        } });
      }
      if (args[0] === "eval") {
        return commandResult({ result: { found: true, activated: true, kind: "button", label: "Run" } });
      }
      if (args[0] === "errors") return commandResult({ errors: [] }, "No page errors");
      if (args[0] === "console") {
        return commandResult({ messages: [{ level: "error", message: "Hydration failed" }] });
      }
      if (args[0] === "network") {
        return commandResult({ requests: [{ status: 500, url: "https://preview-123.vercel.run/api/events" }] });
      }
      return commandResult();
    },
  });
  const result = await harness.checker.check({
    url: "https://preview-123.vercel.run/",
    project: { id: "project-test" },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.consoleErrors, ["Hydration failed"]);
  assert.deepEqual(result.networkErrors, ["500 https://preview-123.vercel.run/api/events"]);
  assert.match(result.summary, /First: Hydration failed/);
});

test("rejects SSRF-shaped preview URLs and missing browser snapshots before execution", async () => {
  let called = false;
  const harness = checkerHarness({
    withSandbox: async () => {
      called = true;
      throw new Error("must not execute");
    },
  });
  await assert.rejects(
    harness.checker.check({ url: "http://169.254.169.254/latest", project: { id: "p" } }),
    /HTTPS Vercel Sandbox preview domain/,
  );
  assert.equal(called, false);

  const withoutSnapshot = checkerHarness({ snapshotId: null });
  await assert.rejects(
    withoutSnapshot.checker.check({ url: "https://preview-123.vercel.run/", project: { id: "p" } }),
    /AGENT_BROWSER_SNAPSHOT_ID/,
  );
});

test("reports the exact browser snapshot preflight failure with bounded diagnostics", async () => {
  const calls = [];
  const harness = checkerHarness({
    runCommand: async (_sandbox, args) => {
      calls.push(args);
      if (args[0] === "open") {
        const error = new Error("agent-browser command failed");
        error.stdout = JSON.stringify({
          success: false,
          error:
            "Chrome exited early because libnspr4.so could not be loaded. " +
            "Rebuild the browser snapshot with Chromium system dependencies. " +
            "x".repeat(2_000),
        });
        throw error;
      }
      return commandResult();
    },
  });

  await assert.rejects(
    harness.checker.check({
      url: "https://preview-123.vercel.run/",
      project: { id: "project-test" },
    }),
    (error) => {
      assert.equal(error.name, "ProjectRuntimeProviderError");
      assert.match(error.message, /^Verify browser snapshot failed:/);
      assert.match(error.message, /libnspr4\.so/);
      assert.ok(error.message.length <= 300);
      return true;
    },
  );
  assert.deepEqual(calls, [["open", "about:blank"]]);
});

test("redacts provider secrets from browser step failures", async () => {
  const secret = `github_pat_${"A".repeat(48)}`;
  const harness = checkerHarness({
    runCommand: async () => {
      const error = new Error("agent-browser command failed");
      error.stdout = JSON.stringify({
        success: false,
        error: `Provider rejected credential ${secret}`,
      });
      throw error;
    },
  });

  await assert.rejects(
    harness.checker.check({
      url: "https://preview-123.vercel.run/",
      project: { id: "project-test" },
    }),
    (error) => {
      assert.equal(error.name, "ProjectRuntimeProviderError");
      assert.match(error.message, /^Verify browser snapshot failed:/);
      assert.match(error.message, /redacted: potential secret material/);
      assert.doesNotMatch(error.message, /github_pat_/);
      return true;
    },
  );
});

test("labels and bounds browser Sandbox boot failures", async () => {
  const harness = checkerHarness({
    withSandbox: async (_callback, options) => {
      options.onStep({ status: "running", step: "Booting sandbox from snapshot" });
      throw new Error(`provider unavailable ${"z".repeat(2_000)}`);
    },
  });

  await assert.rejects(
    harness.checker.check({
      url: "https://preview-123.vercel.run/",
      project: { id: "project-test" },
    }),
    (error) => {
      assert.equal(error.name, "ProjectRuntimeProviderError");
      assert.match(error.message, /^Booting sandbox from snapshot failed:/);
      assert.ok(error.message.length <= 300);
      return true;
    },
  );
});
