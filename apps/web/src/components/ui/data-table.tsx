import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { Skeleton } from './feedback';
import { Pagination } from './navigation';

export interface Column<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Value used for sorting; the column is sortable when present. */
  sortValue?: (row: Row) => string | number;
  /** Right-align numbers and money. */
  numeric?: boolean;
  className?: string;
}

/**
 * Data table (Phase 6b): client-side sorting and pagination, loading and empty
 * rows, horizontal scroll on small screens. Sortable headers are buttons and
 * expose aria-sort. No motif in tables (rule 4.4).
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  loading = false,
  empty,
  pageSize = 10,
  card,
}: {
  columns: Column<Row>[];
  rows: readonly Row[] | undefined;
  rowKey: (row: Row) => string;
  caption: string;
  loading?: boolean;
  empty?: ReactNode;
  pageSize?: number;
  /**
   * Optional phone layout: below `sm` each row renders as this card instead of
   * a table row (the table is hidden there, and the cards from `sm` up).
   */
  card?: (row: Row) => ReactNode;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const list = [...(rows ?? [])];
    const column = sort ? columns.find((c) => c.key === sort.key) : undefined;
    if (sort && column?.sortValue) {
      const value = column.sortValue;
      list.sort((a, b) => {
        const x = value(a);
        const y = value(b);
        const order =
          typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x).localeCompare(String(y));
        return sort.dir === 'asc' ? order : -order;
      });
    }
    return list;
  }, [rows, columns, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages);
  const visible = sorted.slice((current - 1) * pageSize, current * pageSize);

  function toggle(key: string) {
    setSort((previous) =>
      previous?.key === key
        ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
    setPage(1);
  }

  return (
    <div className="min-w-0">
      {card && !loading && visible.length > 0 ? (
        <ul aria-label={caption} className="space-y-3 sm:hidden">
          {visible.map((row) => (
            <li key={rowKey(row)} className="rounded-md border border-border bg-surface p-4">
              {card(row)}
            </li>
          ))}
        </ul>
      ) : null}
      <div
        className={cn(
          'overflow-x-auto rounded-md border border-border',
          card && !loading && visible.length > 0 && 'hidden sm:block',
        )}
      >
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-muted">
            <tr>
              {columns.map((column) => {
                const direction = sort?.key === column.key ? sort.dir : null;
                const Icon =
                  direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowUpDown;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      direction === 'asc'
                        ? 'ascending'
                        : direction === 'desc'
                          ? 'descending'
                          : undefined
                    }
                    className={cn(
                      'border-b border-border px-3 py-2 text-left font-display text-xs font-medium uppercase tracking-wider text-muted-foreground',
                      column.numeric && 'text-right',
                      column.className,
                    )}
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        onClick={() => {
                          toggle(column.key);
                        }}
                        className="inline-flex min-h-11 cursor-pointer md:min-h-8 items-center gap-1 uppercase hover:text-ink"
                      >
                        {column.header}
                        <Icon aria-hidden="true" className="size-3.5" />
                        {direction ? (
                          <span className="sr-only">
                            {t(
                              direction === 'asc'
                                ? 'common.sortAscending'
                                : 'common.sortDescending',
                            )}
                          </span>
                        ) : null}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="bg-surface">
            {loading ? (
              Array.from({ length: 3 }, (_, index) => (
                <tr key={`loading-${String(index)}`} aria-hidden="true">
                  {columns.map((column) => (
                    <td key={column.key} className="border-b border-border px-3 py-3">
                      <Skeleton className="h-4 w-full max-w-40" />
                    </td>
                  ))}
                </tr>
              ))
            ) : visible.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  {empty ?? t('common.noData')}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={rowKey(row)} className="hover:bg-surface-muted/60">
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        'border-b border-border px-3 py-2.5 align-top last:border-b-0',
                        column.numeric && 'tabular text-right',
                        column.className,
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {loading ? (
        <p role="status" className="sr-only">
          {t('common.loading')}
        </p>
      ) : (
        <Pagination page={current} pages={pages} onPage={setPage} />
      )}
    </div>
  );
}
