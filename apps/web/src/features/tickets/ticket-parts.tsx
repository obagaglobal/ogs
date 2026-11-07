import { MAX_TICKET_ATTACHMENTS, type TicketAttachment } from '@ogs/contracts';
import { FileText, Lock, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileUpload } from '@/components/ui/file-upload';
import { t } from '@/i18n';
import { describeError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatWhen, priorityTone } from './tickets-data';

const sizeLabel = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${String(Math.max(1, Math.round(bytes / 1024)))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Files on a message. Only clean files get a download button. */
export function AttachmentList({
  attachments,
  download,
}: {
  attachments: readonly TicketAttachment[];
  /** Returns the short-lived URL for one attachment. */
  download: (attachmentId: string) => Promise<{ url: string }>;
}) {
  const [error, setError] = useState<string | null>(null);
  if (attachments.length === 0) {
    return null;
  }
  return (
    <div className="mt-3 space-y-2">
      <ul className="flex flex-wrap gap-2">
        {attachments.map((file) => (
          <li
            key={file.id}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-surface px-3 py-1 text-sm md:min-h-9"
          >
            <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
            {file.status === 'CLEAN' ? (
              <button
                type="button"
                className="inline-flex min-h-11 cursor-pointer items-center underline underline-offset-4 md:min-h-9"
                onClick={() => {
                  setError(null);
                  download(file.id)
                    .then(({ url }) => {
                      window.location.assign(url);
                    })
                    .catch((caught: unknown) => {
                      setError(describeError(caught));
                    });
                }}
              >
                {file.name}
              </button>
            ) : (
              <span>{file.name}</span>
            )}
            <span className="tabular text-xs text-muted-foreground">
              {sizeLabel(file.sizeBytes)}
            </span>
            {file.status === 'QUARANTINED' ? (
              <Badge>{t('tickets.scanning')}</Badge>
            ) : file.status === 'REJECTED' ? (
              <Badge tone="danger">{t('tickets.fileBlocked')}</Badge>
            ) : null}
          </li>
        ))}
      </ul>
      {error === null ? null : (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export interface Picked {
  readonly id: string;
  readonly name: string;
}

/**
 * Upload up to MAX_TICKET_ATTACHMENTS files before sending. `upload` stores a
 * file and returns its id; the ids are sent with the ticket or the reply.
 */
export function AttachmentPicker({
  files,
  onChange,
  upload,
  label = t('tickets.attachments'),
}: {
  files: readonly Picked[];
  onChange: (files: Picked[]) => void;
  upload: (file: File) => Promise<{ id: string }>;
  label?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {files.length < MAX_TICKET_ATTACHMENTS ? (
        <FileUpload
          // A fresh picker after each upload, so the next file starts clean.
          key={files.length}
          label={label}
          accept="application/pdf,image/jpeg,image/png,image/webp"
          help={t('tickets.attachHelp', { max: MAX_TICKET_ATTACHMENTS })}
          upload={async (file, onProgress) => {
            setError(null);
            try {
              const stored = await upload(file);
              onProgress(1);
              onChange([...files, { id: stored.id, name: file.name }]);
            } catch (caught) {
              setError(describeError(caught));
              throw caught;
            }
          }}
        />
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {files.length === 0 ? null : (
        <ul className="flex flex-wrap gap-2">
          {files.map((file) => (
            <li
              key={file.id}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-muted py-0.5 pr-0.5 pl-3 text-sm"
            >
              {file.name}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('tickets.removeFile', { name: file.name })}
                onClick={() => {
                  onChange(files.filter((other) => other.id !== file.id));
                }}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PriorityBadge({ priority }: { priority: string | null }) {
  return (
    <Badge tone={priorityTone(priority)} className="whitespace-nowrap">
      {priority ?? t('tickets.priority.none')}
    </Badge>
  );
}

/**
 * One message in a conversation. `internal` notes are unmistakable: a dashed
 * border, a lock and an "Internal" badge, so staff never confuse them with
 * what the customer sees. Customer pages never render internal messages
 * (their API has no internal data at all).
 */
export function Message({
  author,
  side,
  internal = false,
  when,
  children,
  footer,
}: {
  author: ReactNode;
  side: 'CUSTOMER' | 'STAFF';
  internal?: boolean;
  when: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <article
      data-internal={internal ? 'true' : undefined}
      className={cn(
        'rounded-md border p-4',
        internal
          ? 'border-dashed border-control-border bg-surface-muted'
          : side === 'STAFF'
            ? 'border-border bg-surface-muted'
            : 'border-border bg-surface',
        side === 'STAFF' ? 'sm:ml-8' : 'sm:mr-8',
      )}
    >
      <header className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        {internal ? <Lock aria-hidden="true" className="size-4 text-muted-foreground" /> : null}
        <span className="font-display font-medium">{author}</span>
        {internal ? <Badge tone="warning">{t('tickets.internal')}</Badge> : null}
        <span className="text-xs text-muted-foreground">{formatWhen(when)}</span>
      </header>
      <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{children}</p>
      {footer}
    </article>
  );
}
