export interface WorkspaceRunReceiptIdentity {
  workspaceId: string;
  workspaceRevision: number;
  workspaceDigest: string;
  task: string;
}

export interface CurrentWorkspaceRunIdentity {
  workspaceId: string;
  workspaceRevision: number;
  workspaceDigest: string | null;
  task: string | null;
}

export function workspaceRunReceiptMatchesRevision(
  receipt: WorkspaceRunReceiptIdentity | null,
  workspaceId: string,
  workspaceRevision: number,
): boolean {
  return Boolean(
    receipt
      && receipt.workspaceId === workspaceId
      && Number.isSafeInteger(receipt.workspaceRevision)
      && receipt.workspaceRevision === workspaceRevision,
  );
}

export function workspaceRunReceiptMatchesWorkspace(
  receipt: WorkspaceRunReceiptIdentity | null,
  current: CurrentWorkspaceRunIdentity,
): boolean {
  return Boolean(
    receipt
      && workspaceRunReceiptMatchesRevision(
        receipt,
        current.workspaceId,
        current.workspaceRevision,
      )
      && current.workspaceDigest
      && /^[a-f0-9]{64}$/.test(receipt.workspaceDigest)
      && receipt.workspaceDigest === current.workspaceDigest
      && current.task
      && receipt.task === current.task,
  );
}

export type WorkspaceRunReceiptStatus =
  | "none"
  | "verified"
  | "previous"
  | "historical";

export function workspaceRunReceiptStatus(
  receipt: WorkspaceRunReceiptIdentity | null,
  current: CurrentWorkspaceRunIdentity,
  currentAttempt: { running: boolean; error: string },
): WorkspaceRunReceiptStatus {
  if (!receipt) return "none";
  if (!workspaceRunReceiptMatchesWorkspace(receipt, current)) {
    return "historical";
  }
  if (currentAttempt.running || currentAttempt.error.trim()) return "previous";
  return "verified";
}
