import type { StabilizerPatchWrite } from "../stabilizer/types.ts";

export const REPAIR_DATASET_V3_SCHEMA_VERSION = 3 as const;

export type RepairDatasetSource =
  | "synthetic"
  | "public"
  | "repository-owned"
  | "user-opt-in";

export interface RepairApplicabilityEvidence {
  required: boolean;
  evidenceIds: string[];
  notApplicableReason?: string;
}

export interface VerifiedRepairExampleV3 {
  schemaVersion: 3;
  datasetVersion: string;
  id: string;
  failureClass: string;
  frameworkVersions: Record<string, string>;
  sanitizedFailure: string;
  contextProvenanceIds: string[];
  beforeHashes: Record<string, string>;
  afterHashes: Record<string, string>;
  verifiedPatch: {
    schemaVersion: 1;
    writes: StabilizerPatchWrite[];
  };
  checksPassed: string[];
  build: RepairApplicabilityEvidence;
  browser: RepairApplicabilityEvidence;
  browserEvidenceIds: string[];
  source: RepairDatasetSource;
  license?: string;
  consentId?: string;
  reviewed: boolean;
  dedupeHash: string;
  verifiedAt: string;
  fixture: {
    files: Record<string, string>;
    failureMarker: string;
  };
}

export interface RepairDatasetValidationResult {
  accepted: VerifiedRepairExampleV3[];
  rejected: Array<{ id: string; reasons: string[] }>;
}
