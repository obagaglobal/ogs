/**
 * What may be uploaded, by whom, and how big (Phase 3 plan §3.3). A purpose is
 * the only way to upload: it fixes the allowed content types (detected from the
 * bytes, never trusted from the name or the client) and the size limit.
 */
export interface FilePurpose {
  /** Who may own such a file: the acting tenant workspace, or the person themself. */
  readonly owners: readonly ('tenant' | 'user')[];
  readonly maxBytes: number;
  /** MIME types as detected by magic bytes (file-type). */
  readonly allowedTypes: readonly string[];
  /** For tenant-owned files: the permission the uploader needs in that workspace. */
  readonly permission?: string;
}

const MB = 1024 * 1024;

export const FILE_PURPOSES = {
  /** Organisation application evidence: incorporation and KRA PIN certificates (Phase 4). */
  'organisation.document': {
    owners: ['tenant'],
    maxBytes: 10 * MB,
    allowedTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    permission: 'organisation.profile.manage',
  },
  /**
   * Government ID of an individual provider (Phase 5, P5-5). Personal data:
   * visible to its owner and to staff with platform.provider.approve or
   * platform.compliance.review under an elevation, never anywhere else.
   */
  'provider.identity': {
    owners: ['user'],
    maxBytes: 10 * MB,
    allowedTypes: ['application/pdf', 'image/jpeg', 'image/png'],
  },
  /** Skills evidence (certificates) of a provider company or an individual. */
  'provider.certificate': {
    owners: ['tenant', 'user'],
    maxBytes: 10 * MB,
    allowedTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    permission: 'provider.profile.manage',
  },
  /** Registration and tax documents of a provider company. */
  'provider.company_document': {
    owners: ['tenant'],
    maxBytes: 10 * MB,
    allowedTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    permission: 'provider.profile.manage',
  },
  /** Ticket attachments (Phase 8). */
  'ticket.attachment': {
    owners: ['tenant', 'user'],
    maxBytes: 10 * MB,
    allowedTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  },
  'user.avatar': {
    owners: ['user'],
    maxBytes: 2 * MB,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
} as const satisfies Record<string, FilePurpose>;

export type FilePurposeName = keyof typeof FILE_PURPOSES;

/** Uploads a restricted (not yet approved) workspace may still make: application evidence. */
export const APPLICATION_EVIDENCE_PURPOSES: ReadonlySet<string> = new Set([
  'organisation.document',
  'provider.identity',
  'provider.certificate',
  'provider.company_document',
]);

export function isFilePurpose(value: string): value is FilePurposeName {
  return Object.hasOwn(FILE_PURPOSES, value);
}
