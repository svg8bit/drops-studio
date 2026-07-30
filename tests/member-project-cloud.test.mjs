import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  createStudioAccountCookie,
  readStudioAccountCookie,
  STUDIO_ACCOUNT_COOKIE,
} from "../lib/access-tier.ts";

const projectRoot = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const projectPath = specifier.slice(2);
    return {
      shortCircuit: true,
      url: new URL(
        projectPath.endsWith(".ts") ? projectPath : `${projectPath}.ts`,
        projectRoot,
      ).href,
    };
  },
});

const { createProjectSpec } = await import("../lib/project-factory.ts");

const accountSecret = "member-project-cloud-test-secret-with-enough-entropy";
const accountSubject = "user_drops_studio_cloud_test";

function spec(name = "Member Morning Alpha") {
  return createProjectSpec({
    presetId: "morning-alpha",
    values: {},
    prompt: name,
    tools: ["DropsTab API", "Drops Bot"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: {
      title: "Waiting for a verified prediction market",
      probability: null,
      change: null,
    },
    origin: "https://drops.example",
  });
}

function projectDraft(id = "project-cloud-1", name = "Member Morning Alpha") {
  const projectSpec = spec(name);
  return {
    id,
    spec: projectSpec,
    checkpoints: [
      {
        id: "checkpoint-1",
        label: "Working baseline",
        createdAt: "2026-07-30T00:00:00.000Z",
        source: "system",
        spec: projectSpec,
      },
    ],
    futureCheckpoints: [
      {
        id: "checkpoint-future-1",
        label: "Future version",
        createdAt: "2026-07-30T00:01:00.000Z",
        source: "design",
        spec: projectSpec,
      },
    ],
    conversation: [
      {
        id: "assistant-1",
        role: "assistant",
        content: "Your project is ready to edit.",
        createdAt: "2026-07-30T00:00:00.000Z",
        proposal: {
          label: "Safer brief",
          summary: ["Keep DropsTab evidence visible."],
          spec: projectSpec,
        },
      },
    ],
  };
}

async function withLocalCloud(run) {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    DROPS_ACCOUNT_COOKIE_SECRET: process.env.DROPS_ACCOUNT_COOKIE_SECRET,
    DROPS_STUDIO_LOCAL_PROJECT_STORE: process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE,
    VERCEL: process.env.VERCEL,
  };
  process.env.NODE_ENV = "test";
  process.env.DROPS_ACCOUNT_COOKIE_SECRET = accountSecret;
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_LOCAL_MEMBER_PROJECTS__ = new Map();
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map();
  try {
    return await run();
  } finally {
    globalThis.__DROPS_STUDIO_LOCAL_MEMBER_PROJECTS__ = undefined;
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("member cloud validates every spec, checkpoint and proposal without retaining executable artifacts", async () => {
  const {
    sanitizeMemberProjectDraft,
  } = await import("../lib/member-project-cloud.ts");
  const draft = projectDraft();
  draft.html = "<html>compiled output must not be persisted</html>";

  assert.throws(
    () => sanitizeMemberProjectDraft(draft),
    /compiled html|executable artifact/i,
  );

  delete draft.html;
  const sanitized = sanitizeMemberProjectDraft(draft);
  assert.equal(sanitized.spec.schemaVersion, 1);
  assert.equal(sanitized.checkpoints[0].spec.schemaVersion, 1);
  assert.equal(sanitized.futureCheckpoints[0].spec.schemaVersion, 1);
  assert.equal(sanitized.conversation[0].proposal.spec.schemaVersion, 1);
  assert.equal("html" in sanitized, false);
  assert.equal("quality" in sanitized, false);
});

test("member cloud rejects credential fields before validator normalization can discard them", async () => {
  const {
    sanitizeMemberProjectDraft,
  } = await import("../lib/member-project-cloud.ts");
  const draft = projectDraft();
  draft.spec.brain.apiKey = "provider-account-credential-value-that-must-never-sync";

  assert.throws(
    () => sanitizeMemberProjectDraft(draft),
    /credential|secret|key/i,
  );
});

test("member cloud keeps account ownership private and uses optimistic per-project revisions", async () => {
  await withLocalCloud(async () => {
    const {
      listMemberProjects,
      upsertMemberProject,
    } = await import("../db/member-projects.ts");
    const firstIdentity = "a".repeat(64);
    const secondIdentity = "b".repeat(64);

    const created = await upsertMemberProject(firstIdentity, projectDraft(), 0);
    assert.equal(created.status, "saved");
    assert.equal(created.project.revision, 1);
    assert.equal((await listMemberProjects(secondIdentity)).length, 0);

    const updatedDraft = projectDraft("project-cloud-1", "Updated Morning Alpha");
    const updated = await upsertMemberProject(firstIdentity, updatedDraft, 1);
    assert.equal(updated.status, "saved");
    assert.equal(updated.project.revision, 2);

    const stale = await upsertMemberProject(firstIdentity, projectDraft(), 1);
    assert.equal(stale.status, "conflict");
    assert.equal(stale.current.revision, 2);
    assert.equal(stale.current.spec.name, "Updated Morning Alpha");

    const missing = await upsertMemberProject(
      firstIdentity,
      projectDraft("missing-project", "Missing project"),
      4,
    );
    assert.equal(missing.status, "conflict");
    assert.equal("current" in missing, false);
  });
});

test("member cloud enforces the 50-project account ceiling", async () => {
  await withLocalCloud(async () => {
    const {
      MEMBER_PROJECT_LIMIT,
      upsertMemberProject,
    } = await import("../db/member-projects.ts");
    const identity = "c".repeat(64);

    for (let index = 0; index < MEMBER_PROJECT_LIMIT; index += 1) {
      const saved = await upsertMemberProject(
        identity,
        projectDraft(`project-${index}`, `Project ${index}`),
        0,
      );
      assert.equal(saved.status, "saved");
    }

    const rejected = await upsertMemberProject(
      identity,
      projectDraft("project-over-limit", "Project over limit"),
      0,
    );
    assert.equal(rejected.status, "limit");
  });
});

test("member cloud writes one private CAS-protected Vercel Blob envelope", async () => {
  const {
    listMemberProjects,
    upsertMemberProject,
  } = await import("../db/member-projects.ts");
  let stored = null;
  let etag = 0;
  const writes = [];
  const storage = {
    async get(pathname, options) {
      assert.equal(options.access, "private");
      assert.equal(options.useCache, false);
      if (!stored) return null;
      return {
        statusCode: 200,
        blob: { etag: `etag-${etag}` },
        stream: new Response(stored).body,
      };
    },
    async put(pathname, body, options) {
      writes.push({ pathname, options });
      assert.equal(options.access, "private");
      if (stored === null) assert.equal(options.allowOverwrite, false);
      else assert.equal(options.ifMatch, `etag-${etag}`);
      stored = String(body);
      etag += 1;
      return { pathname };
    },
  };
  const identity = "d".repeat(64);

  const created = await upsertMemberProject(identity, projectDraft(), 0, storage);
  assert.equal(created.status, "saved");
  assert.match(writes[0].pathname, /^drops-studio\/member-projects\/[a-f0-9]{64}\.json$/);
  assert.equal(JSON.parse(stored).projects[0].html, undefined);
  assert.equal((await listMemberProjects(identity, storage))[0].revision, 1);
});

test("member cloud refuses a corrupted stored envelope that contains compiled HTML", async () => {
  const {
    listMemberProjects,
  } = await import("../db/member-projects.ts");
  const project = {
    schemaVersion: 1,
    revision: 1,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    ...projectDraft(),
    html: "<html>must never leave the storage boundary</html>",
  };
  const storage = {
    async get() {
      return {
        statusCode: 200,
        blob: { etag: "etag-1" },
        stream: new Response(JSON.stringify({
          schemaVersion: 1,
          revision: 1,
          updatedAt: "2026-07-30T00:00:00.000Z",
          projects: [project],
        })).body,
      };
    },
    async put() {
      throw new Error("not used");
    },
  };

  await assert.rejects(
    listMemberProjects("e".repeat(64), storage),
    /invalid envelope|storage/i,
  );
});

test("member project API requires a signed account and same-origin mutations", async () => {
  await withLocalCloud(async () => {
    const { PUT } = await import("../app/api/projects/route.ts");
    const { NextRequest } = await import("next/server.js");
    const requestBody = JSON.stringify({ project: projectDraft(), expectedRevision: 0 });

    const anonymous = await PUT(new NextRequest("https://drops.example/api/projects", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "https://drops.example" },
      body: requestBody,
    }));
    assert.equal(anonymous.status, 401);

    const accountCookie = createStudioAccountCookie({
      provider: "openrouter",
      subject: accountSubject,
    }, accountSecret);
    const crossOrigin = await PUT(new NextRequest("https://drops.example/api/projects", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: `${STUDIO_ACCOUNT_COOKIE}=${accountCookie}`,
        origin: "https://attacker.example",
      },
      body: requestBody,
    }));
    assert.equal(crossOrigin.status, 403);
  });
});

test("member project API rejects credential-like material anywhere in the request envelope", async () => {
  await withLocalCloud(async () => {
    const { PUT } = await import("../app/api/projects/route.ts");
    const { NextRequest } = await import("next/server.js");
    const accountCookie = createStudioAccountCookie({
      provider: "openrouter",
      subject: accountSubject,
    }, accountSecret);
    const response = await PUT(new NextRequest("https://drops.example/api/projects", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: `${STUDIO_ACCOUNT_COOKIE}=${accountCookie}`,
        origin: "https://drops.example",
      },
      body: JSON.stringify({
        project: projectDraft(),
        expectedRevision: 0,
        apiKey: "sk-or-v1-request-envelope-credential-must-be-rejected",
      }),
    }));

    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "PROJECT_SECRET_REJECTED");
  });
});

test("member project API round-trips sanitized records and rejects stale writes", async () => {
  await withLocalCloud(async () => {
    const { DELETE, GET, PUT } = await import("../app/api/projects/route.ts");
    const { NextRequest } = await import("next/server.js");
    const accountCookie = createStudioAccountCookie({
      provider: "openrouter",
      subject: accountSubject,
    }, accountSecret);
    const headers = {
      "content-type": "application/json",
      cookie: `${STUDIO_ACCOUNT_COOKIE}=${accountCookie}`,
      origin: "https://drops.example",
    };

    const created = await PUT(new NextRequest("https://drops.example/api/projects", {
      method: "PUT",
      headers,
      body: JSON.stringify({ project: projectDraft(), expectedRevision: 0 }),
    }));
    const createdPayload = await created.json();
    assert.equal(created.status, 201);
    assert.equal(createdPayload.project.revision, 1);
    assert.equal("html" in createdPayload.project, false);

    const listed = await GET(new NextRequest("https://drops.example/api/projects", {
      headers: { cookie: `${STUDIO_ACCOUNT_COOKIE}=${accountCookie}` },
    }));
    const listPayload = await listed.json();
    assert.equal(listed.status, 200);
    assert.equal(listPayload.projects.length, 1);
    assert.equal(listPayload.projects[0].spec.name, "Member Morning Alpha");

    const stale = await PUT(new NextRequest("https://drops.example/api/projects", {
      method: "PUT",
      headers,
      body: JSON.stringify({ project: projectDraft(), expectedRevision: 0 }),
    }));
    const stalePayload = await stale.json();
    assert.equal(stale.status, 409);
    assert.equal(stalePayload.code, "PROJECT_REVISION_CONFLICT");
    assert.equal(stalePayload.current.revision, 1);

    const deleted = await DELETE(new NextRequest("https://drops.example/api/projects", {
      method: "DELETE",
      headers,
      body: JSON.stringify({ id: "project-cloud-1", expectedRevision: 1 }),
    }));
    assert.equal(deleted.status, 204);
  });
});

test("member project API enforces its raw body ceiling before JSON parsing", async () => {
  await withLocalCloud(async () => {
    const {
      MEMBER_PROJECT_BODY_LIMIT_BYTES,
    } = await import("../lib/member-project-cloud.ts");
    const { PUT } = await import("../app/api/projects/route.ts");
    const { NextRequest } = await import("next/server.js");
    const accountCookie = createStudioAccountCookie({
      provider: "openrouter",
      subject: accountSubject,
    }, accountSecret);
    const response = await PUT(new NextRequest("https://drops.example/api/projects", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: `${STUDIO_ACCOUNT_COOKIE}=${accountCookie}`,
        origin: "https://drops.example",
        "content-length": String(MEMBER_PROJECT_BODY_LIMIT_BYTES + 1),
      },
      body: "{}",
    }));

    assert.equal(response.status, 413);
  });
});

test("member project API applies a durable account-scoped request limit", async () => {
  await withLocalCloud(async () => {
    const { GET } = await import("../app/api/projects/route.ts");
    const { NextRequest } = await import("next/server.js");
    const accountCookie = createStudioAccountCookie({
      provider: "openrouter",
      subject: accountSubject,
    }, accountSecret);
    const account = readStudioAccountCookie(accountCookie, accountSecret);
    assert.ok(account);
    const windowMs = 60 * 60 * 1_000;
    const bucket = Math.floor(Date.now() / windowMs);
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map([
      [`member-project-read:${bucket}:${account.identity}`, {
        count: 5_000,
        expiresAt: (bucket + 1) * windowMs,
      }],
    ]);

    const response = await GET(new NextRequest("https://drops.example/api/projects", {
      headers: { cookie: `${STUDIO_ACCOUNT_COOKIE}=${accountCookie}` },
    }));

    assert.equal(response.status, 429);
  });
});

test("member project API logs unexpected failures without exposing infrastructure details", async () => {
  await withLocalCloud(async () => {
    const { GET } = await import("../app/api/projects/route.ts");
    const { NextRequest } = await import("next/server.js");
    const accountCookie = createStudioAccountCookie({
      provider: "openrouter",
      subject: accountSubject,
    }, accountSecret);
    const member = readStudioAccountCookie(accountCookie, accountSecret);
    assert.ok(member);
    const internalDetail = "private database connection failed at db-internal.example";
    globalThis.__DROPS_STUDIO_LOCAL_MEMBER_PROJECTS__ = new Map([
      [member.identity, {
        get projects() {
          throw new Error(internalDetail);
        },
      }],
    ]);
    const previousConsoleError = console.error;
    const logged = [];
    console.error = (...values) => logged.push(values);

    try {
      const response = await GET(new NextRequest("https://drops.example/api/projects", {
        headers: { cookie: `${STUDIO_ACCOUNT_COOKIE}=${accountCookie}` },
      }));
      const payload = await response.json();

      assert.equal(response.status, 503);
      assert.equal(payload.error, "Member project sync is temporarily unavailable. The browser copy remains available.");
      assert.doesNotMatch(JSON.stringify(payload), /db-internal|private database connection/i);
      assert.ok(logged.length > 0);
    } finally {
      console.error = previousConsoleError;
    }
  });
});

test("member project API preserves stable 400 responses for invalid project drafts", async () => {
  await withLocalCloud(async () => {
    const { PUT } = await import("../app/api/projects/route.ts");
    const { NextRequest } = await import("next/server.js");
    const accountCookie = createStudioAccountCookie({
      provider: "openrouter",
      subject: accountSubject,
    }, accountSecret);
    const response = await PUT(new NextRequest("https://drops.example/api/projects", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: `${STUDIO_ACCOUNT_COOKIE}=${accountCookie}`,
        origin: "https://drops.example",
      },
      body: JSON.stringify({ project: {}, expectedRevision: 0 }),
    }));

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /project id/i);
  });
});
