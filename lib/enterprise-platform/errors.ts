export type EnterprisePlatformErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "PERMISSION_DENIED"
  | "TENANT_MISMATCH"
  | "CONFIRMATION_REQUIRED"
  | "INVITATION_EXPIRED"
  | "INVITATION_REVOKED"
  | "INVITATION_REPLAY"
  | "INVITATION_EMAIL_MISMATCH"
  | "COLLABORATION_OPERATION_INVALID"
  | "ROOM_ACCESS_DENIED"
  | "ROOM_CAPACITY_EXCEEDED"
  | "REVISION_CONFLICT"
  | "BRANCH_SCOPE_DENIED"
  | "OIDC_SETUP_REQUIRED"
  | "OIDC_STATE_INVALID"
  | "OIDC_NONCE_INVALID"
  | "OIDC_PKCE_INVALID"
  | "OIDC_CODE_INVALID"
  | "OIDC_REPLAY"
  | "OIDC_DOMAIN_DENIED"
  | "DOMAIN_CLAIMED"
  | "DOMAIN_CHALLENGE_EXPIRED"
  | "DOMAIN_VERIFICATION_FAILED"
  | "TOKEN_INVALID"
  | "TOKEN_REVOKED"
  | "TOKEN_EXPIRED"
  | "TOKEN_SCOPE_DENIED"
  | "TOKEN_PROJECT_DENIED"
  | "TOKEN_ENVIRONMENT_DENIED"
  | "TOKEN_IP_DENIED"
  | "AUDIT_SECRET_REJECTED"
  | "RETENTION_INVALID"
  | "EXPORT_NOT_PENDING"
  | "DELETION_NOT_PENDING"
  | "DELETION_DEPENDENCIES"
  | "BACKUP_EVIDENCE_REQUIRED"
  | "PRODUCTION_APPROVAL_REQUIRED"
  | "RESTORE_EVIDENCE_REQUIRED";

export class EnterprisePlatformError extends Error {
  readonly code: EnterprisePlatformErrorCode;

  constructor(code: EnterprisePlatformErrorCode, message: string) {
    super(message);
    this.name = "EnterprisePlatformError";
    this.code = code;
  }
}

export function enterpriseError(code: EnterprisePlatformErrorCode, message: string): never {
  throw new EnterprisePlatformError(code, message);
}
