import type { JobPhoto } from '@ogs/contracts';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/features/workspace/workspace-state';
import { t } from '@/i18n';
import { api } from '@/lib/api';

/**
 * Job photos as buttons that open through the API's authorised download
 * endpoint (never a stored link). Shared by the technician, staff and customer
 * screens; kept in its own module so no page pulls another page's chunk.
 */
export function PhotoGrid({
  photos,
  base,
  workspace,
  headers,
}: {
  photos: readonly JobPhoto[];
  /** e.g. `/jobs/:id`, `/platform/jobs/:id`, `/requests/:id/job`. */
  base: string;
  workspace?: string;
  headers?: Record<string, string>;
}) {
  const { selected } = useWorkspace();
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {photos.map((photo, index) => (
        <li key={photo.id}>
          <Button
            variant="secondary"
            className="h-auto min-h-11 w-full flex-col items-start whitespace-normal text-left"
            disabled={photo.status !== 'CLEAN'}
            onClick={() => {
              void api<{ url: string }>(`${base}/photos/${photo.id}/download`, {
                workspace: workspace ?? selected,
                ...(headers === undefined ? {} : { headers }),
              }).then(({ url }) => {
                window.open(url, '_blank', 'noopener');
              });
            }}
          >
            <span>{t('tracker.viewPhoto', { n: index + 1 })}</span>
            <span className="text-xs text-muted-foreground">
              {photo.status === 'QUARANTINED' ? t('jobs.scanning') : photo.caption}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
