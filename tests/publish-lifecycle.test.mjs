import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

import { strFromU8, unzipSync } from "fflate";
import { NextRequest } from "next/server.js";

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

const publishCapability = await import("../lib/publish-capability.ts").catch(() => ({}));
const publishLifecycle = await import("../lib/publish-lifecycle.ts").catch(() => ({}));
const publishRoute = await import("../app/api/projects/publish/route.ts");
const { createProjectArchive } = await import("../lib/project-export.ts");
const { compileProject } = await import("../lib/project-compiler.ts");
const { createProjectSpec } = await import("../lib/project-factory.ts");

const TEST_SECRET = "publish-capability-test-secret-that-is-longer-than-32-bytes";

function createBaseSpec(prompt = "Build a focused market research explorer") {
  return createProjectSpec({
    presetId: "crypto-aggregator",
    values: {},
    prompt,
    tools: ["DropsTab market data", "Drops Bot action handoff"],
    provider: "free",
    model: "Free Auto",
    market: [],
    prediction: {
      title: "No prediction selected",
      probability: null,
      change: null,
    },
    origin: "https://drops.example",
  });
}

function mutationRequest(method, body, capability) {
  return new NextRequest("https://drops.example/api/projects/publish", {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://drops.example",
      "sec-fetch-site": "same-origin",
      "x-drops-session": "11111111-1111-4111-8111-111111111111",
      ...(capability ? { authorization: `Bearer ${capability}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("publish capabilities are opaque, tamper evident and bound to one slug", async () => {
  assert.equal(typeof publishCapability.createPublishCapability, "function");
  assert.equal(typeof publishCapability.verifyPublishCapability, "function");

  const capability = publishCapability.createPublishCapability(
    "market-board-123",
    TEST_SECRET,
  );
  assert.match(capability, /^dsp1\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(capability, /market-board/i);
  assert.equal(
    publishCapability.verifyPublishCapability(
      "market-board-123",
      capability,
      TEST_SECRET,
    ),
    true,
  );
  assert.equal(
    publishCapability.verifyPublishCapability(
      "another-market-board",
      capability,
      TEST_SECRET,
    ),
    false,
  );
  assert.equal(
    publishCapability.verifyPublishCapability(
      "market-board-123",
      `${capability.slice(0, -1)}${capability.endsWith("a") ? "b" : "a"}`,
      TEST_SECRET,
    ),
    false,
  );
});

test("new publish retries collisions with strong bounded slug candidates", async () => {
  assert.equal(typeof publishLifecycle.insertWithUniquePublishSlug, "function");

  const entropies = [
    "111111111111111111111111",
    "222222222222222222222222",
    "333333333333333333333333",
  ];
  const attempted = [];
  const result = await publishLifecycle.insertWithUniquePublishSlug({
    baseSlug: "a-very-long-market-product-name-that-needs-to-be-shortened",
    maxAttempts: 3,
    createEntropy: () => entropies.shift(),
    createRecord: (slug) => ({ slug }),
    insert: async (record) => {
      attempted.push(record.slug);
      return attempted.length === 3;
    },
  });

  assert.equal(attempted.length, 3);
  assert.equal(result.slug, attempted[2]);
  assert.ok(attempted.every((slug) => slug.length <= 72));
  assert.ok(attempted.every((slug) => /-[a-f0-9]{24}$/.test(slug)));
  assert.equal(new Set(attempted).size, 3);
});

test("legacy links stay read-only while managed links update in place", () => {
  assert.equal(typeof publishLifecycle.publishMutationForProject, "function");
  const capability = publishCapability.createPublishCapability(
    "managed-link-123",
    TEST_SECRET,
  );
  assert.equal(
    publishLifecycle.publishMutationForProject({
      publishedSlug: "legacy-link-123",
      publishedUrl: "https://drops.example/p/legacy-link-123",
    }),
    "create",
  );
  assert.equal(
    publishLifecycle.publishMutationForProject({
      publishedSlug: "managed-link-123",
      publishedUrl: "https://drops.example/p/managed-link-123",
      publishCapability: capability,
    }),
    "update",
  );
});

test("publication metadata merges into the newest local edit after a storage conflict", () => {
  assert.equal(typeof publishLifecycle.mergePublicationState, "function");
  const latest = {
    id: "project-1",
    spec: { prompt: "newer edit from another tab" },
    html: "<main>newer edit</main>",
    updatedAt: "2026-07-30T12:02:00.000Z",
    publishedUrl: "https://drops.example/p/old",
    publishedSlug: "old",
    publishedAt: "2026-07-30T12:00:00.000Z",
  };
  const justPublished = {
    ...latest,
    spec: { prompt: "older edit sent to the server" },
    html: "<main>older edit</main>",
    updatedAt: "2026-07-30T12:01:00.000Z",
    publishedUrl: "https://drops.example/p/managed",
    publishedSlug: "managed",
    publishedAt: "2026-07-30T12:01:00.000Z",
    publishCapability: "dsp1.browser-only-capability",
  };

  const merged = publishLifecycle.mergePublicationState(latest, justPublished);
  assert.equal(merged.spec, latest.spec);
  assert.equal(merged.html, latest.html);
  assert.equal(merged.updatedAt, latest.updatedAt);
  assert.equal(merged.publishedUrl, justPublished.publishedUrl);
  assert.equal(merged.publishedSlug, justPublished.publishedSlug);
  assert.equal(merged.publishedAt, justPublished.publishedAt);
  assert.equal(merged.publishCapability, justPublished.publishCapability);
});

test("publish capability creates, updates and unpublishes one URL without entering public artifacts", async (context) => {
  assert.equal(typeof publishRoute.PUT, "function");
  assert.equal(typeof publishRoute.DELETE, "function");

  const previous = {
    localStore: process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE,
    publishSecret: process.env.DROPS_PUBLISH_CAPABILITY_SECRET,
    vercel: process.env.VERCEL,
  };
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  process.env.DROPS_PUBLISH_CAPABILITY_SECRET = TEST_SECRET;
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_LOCAL_PROJECTS__ = new Map();
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map();
  context.after(() => {
    globalThis.__DROPS_STUDIO_LOCAL_PROJECTS__ = undefined;
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    if (previous.localStore === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = previous.localStore;
    if (previous.publishSecret === undefined) delete process.env.DROPS_PUBLISH_CAPABILITY_SECRET;
    else process.env.DROPS_PUBLISH_CAPABILITY_SECRET = previous.publishSecret;
    if (previous.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous.vercel;
  });

  const localEditedSpec = createBaseSpec("Build an edited source launch board");
  const localEditedHtml = compileProject(localEditedSpec).replace(
    "</body>",
    '<aside data-edited-before-publish="true">Edited before publish</aside></body>',
  );
  const editedCreateResponse = await publishRoute.POST(
    mutationRequest("POST", { spec: localEditedSpec, html: localEditedHtml }),
  );
  assert.equal(editedCreateResponse.status, 201);
  const editedCreated = await editedCreateResponse.json();
  assert.notEqual(editedCreated.slug, localEditedSpec.slug);
  const editedStored = globalThis.__DROPS_STUDIO_LOCAL_PROJECTS__.get(editedCreated.slug);
  assert.ok(editedStored);
  assert.match(editedStored.html, /data-edited-before-publish="true"/);
  const embeddedPayload = editedStored.html.match(
    /<script type="application\/json" id="projectSpec">([\s\S]*?)<\/script>/,
  );
  assert.ok(embeddedPayload);
  const publicRuntimeSpec = JSON.parse(embeddedPayload[1]);
  assert.equal(publicRuntimeSpec.slug, editedCreated.slug);
  assert.equal(publicRuntimeSpec.dataEndpoint, "https://drops.example/api/public-data");
  assert.match(
    editedStored.html,
    new RegExp(`var studioTelegramUrl="https://drops\\.example/\\?connections=1&provider=dropsbot&flow=telegram-channel&project=${editedCreated.slug}"`),
  );

  const createResponse = await publishRoute.POST(
    mutationRequest("POST", { spec: createBaseSpec() }),
  );
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.match(created.slug, /^[a-z0-9-]+-[a-f0-9]{24}$/);
  assert.match(created.capability, /^dsp1\./);
  assert.equal(created.url, `https://drops.example/p/${created.slug}`);

  const storedAfterCreate = globalThis.__DROPS_STUDIO_LOCAL_PROJECTS__.get(created.slug);
  assert.ok(storedAfterCreate);
  assert.doesNotMatch(JSON.stringify(storedAfterCreate), new RegExp(created.capability));

  const editedRuntime = storedAfterCreate.html.replace(
    "</body>",
    '<aside data-manual-source-proof="true">Owned source edit</aside></body>',
  );
  const editedSourceResponse = await publishRoute.PUT(
    mutationRequest(
      "PUT",
      { slug: created.slug, spec: storedAfterCreate.spec, html: editedRuntime },
      created.capability,
    ),
  );
  assert.equal(editedSourceResponse.status, 200);
  assert.match(
    globalThis.__DROPS_STUDIO_LOCAL_PROJECTS__.get(created.slug).html,
    /data-manual-source-proof="true"/,
  );

  const changedSpec = {
    ...createBaseSpec(),
    tagline: "Updated in place without changing the public URL",
  };
  const updateResponse = await publishRoute.PUT(
    mutationRequest("PUT", { slug: created.slug, spec: changedSpec }, created.capability),
  );
  assert.equal(updateResponse.status, 200);
  const updated = await updateResponse.json();
  assert.equal(updated.slug, created.slug);
  assert.equal(updated.url, created.url);
  assert.equal(Object.hasOwn(updated, "capability"), false);
  assert.equal(
    globalThis.__DROPS_STUDIO_LOCAL_PROJECTS__.get(created.slug).spec.tagline,
    changedSpec.tagline,
  );

  const crossSlugResponse = await publishRoute.PUT(
    mutationRequest(
      "PUT",
      { slug: `other-${created.slug}`, spec: changedSpec },
      created.capability,
    ),
  );
  assert.equal(crossSlugResponse.status, 403);

  const archiveAssets = {
    brand: {
      dropstabMarkSvg: new Uint8Array(
        await readFile(new URL("../public/brand/dropstab-mark.svg", import.meta.url)),
      ),
      dropsBotAvatarJpeg: new Uint8Array(
        await readFile(new URL("../public/brand/drops-bot-avatar.jpg", import.meta.url)),
      ),
    },
    game: {
      marketCatcherBackgroundPng: new Uint8Array(
        await readFile(new URL("../public/assets/market-catcher-retro.png", import.meta.url)),
      ),
      marketWolfSpritePng: new Uint8Array(
        await readFile(new URL("../public/assets/market-wolf-catcher.png", import.meta.url)),
      ),
    },
  };
  const archive = createProjectArchive(
    {
      id: "browser-project",
      spec: storedAfterCreate.spec,
      html: storedAfterCreate.html,
      createdAt: storedAfterCreate.createdAt,
      updatedAt: storedAfterCreate.createdAt,
      publishedUrl: created.url,
      publishedSlug: created.slug,
      publishCapability: created.capability,
    },
    created.quality,
    archiveAssets,
  );
  for (const bytes of Object.values(unzipSync(archive))) {
    assert.doesNotMatch(strFromU8(bytes), new RegExp(created.capability));
  }

  const deniedDelete = await publishRoute.DELETE(
    mutationRequest("DELETE", { slug: created.slug }, `${created.capability}x`),
  );
  assert.equal(deniedDelete.status, 403);
  assert.ok(globalThis.__DROPS_STUDIO_LOCAL_PROJECTS__.has(created.slug));

  const deleteResponse = await publishRoute.DELETE(
    mutationRequest("DELETE", { slug: created.slug }, created.capability),
  );
  assert.equal(deleteResponse.status, 204);
  assert.equal(globalThis.__DROPS_STUDIO_LOCAL_PROJECTS__.has(created.slug), false);
});

test("publish UI distinguishes managed updates, legacy versions and unpublish", async () => {
  const studio = await readFile(
    new URL("../components/project-studio.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    studio,
    /publishCapability:\s+publishMutation === "create"[\s\S]{0,100}\? payload\.capability/,
  );
  assert.match(studio, /Publish new version/);
  assert.match(studio, /Read-only legacy link/);
  assert.match(studio, /Unpublish public app/);
  assert.match(studio, /method: publishMutation === "update" \? "PUT" : "POST"/);
});
