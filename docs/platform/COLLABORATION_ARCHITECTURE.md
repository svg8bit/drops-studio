# Collaboration Architecture

`lib/enterprise-platform/collaboration.ts` provides deterministic concurrent text operations, authenticated bounded presence, comments, replies and resolve/reopen permissions. `AiBranchManager` isolates AI task branches, detects stale canonical revisions, returns explicit conflicts and creates checkpoints on successful merge.

The two-actor tests prove convergence without lost edits, viewer mutation denial, presence expiry and stale AI work not overwriting canonical files.

The shipped runtime is local/test. A durable collaboration release still needs an authorized realtime transport and shared append-only operation storage. The UI reports that boundary directly.
