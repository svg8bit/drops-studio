export const MAX_PUBLISH_SLUG_ATTEMPTS = 5;

export type PublishMutation = "create" | "update";

type PublishedProjectCapability = {
  publishedAt?: string;
  publishedSlug?: string;
  publishedUrl?: string;
  publishCapability?: string;
};

export function publishMutationForProject(
  project: PublishedProjectCapability,
): PublishMutation {
  return project.publishedSlug &&
    project.publishedUrl &&
    /^dsp1\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(
      project.publishCapability ?? "",
    )
    ? "update"
    : "create";
}

export function mergePublicationState<T extends PublishedProjectCapability>(
  latest: T,
  publication: PublishedProjectCapability,
): T {
  return {
    ...latest,
    publishedUrl: publication.publishedUrl,
    publishedSlug: publication.publishedSlug,
    publishedAt: publication.publishedAt,
    publishCapability: publication.publishCapability,
  };
}

export function createPublishSlug(baseSlug: string, entropy: string): string {
  if (!/^[a-f0-9]{24}$/.test(entropy)) {
    throw new Error("Publish slug entropy must contain 24 lowercase hex characters.");
  }
  const normalized =
    baseSlug
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
  return `${normalized.slice(0, 47)}-${entropy}`;
}

export class PublishSlugAttemptsExhaustedError extends Error {
  constructor() {
    super("Could not reserve a unique published project URL.");
    this.name = "PublishSlugAttemptsExhaustedError";
  }
}

export async function insertWithUniquePublishSlug<T>(options: {
  baseSlug: string;
  createEntropy: () => string;
  createRecord: (slug: string) => T;
  insert: (record: T) => Promise<boolean>;
  maxAttempts?: number;
}): Promise<T> {
  const maxAttempts = Math.min(
    8,
    Math.max(
      1,
      Math.floor(options.maxAttempts ?? MAX_PUBLISH_SLUG_ATTEMPTS),
    ),
  );
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const slug = createPublishSlug(options.baseSlug, options.createEntropy());
    const record = options.createRecord(slug);
    if (await options.insert(record)) return record;
  }
  throw new PublishSlugAttemptsExhaustedError();
}
