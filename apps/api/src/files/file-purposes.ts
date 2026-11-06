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
}

const MB = 1024 * 1024;

export const FILE_PURPOSES = {
  /** Provider KYC and company documents (Phase 5). */
  'provider.document': {
    owners: ['tenant', 'user'],
    maxBytes: 10 * MB,
    allowedTypes: ['application/pdf', 'image/jpeg', 'image/png'],
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

export function isFilePurpose(value: string): value is FilePurposeName {
  return Object.hasOwn(FILE_PURPOSES, value);
}
