import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusPill } from './badge';
import { DataTable, type Column } from './data-table';
import { Money } from './data-display';
import { EmptyState } from './feedback';
import { FormField } from './form-field';
import { Input } from './input';
import { KitengeMotif } from './kitenge-motif';

describe('design-system components', () => {
  it('StatusPill says its status in words, not only in colour', () => {
    render(<StatusPill status="overdue" />);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('Money renders KES in mono with tabular figures', () => {
    render(<Money minor={8_450_000} />);
    const money = screen.getByText(/KES/);
    expect(money).toHaveTextContent('KES 84,500');
    expect(money).toHaveClass('tabular');
  });

  it('FormField links the label, help and error to the control', () => {
    render(
      <FormField label="Phone" help="Safaricom or Airtel" error="Enter a valid number">
        {(ids) => <Input {...ids} />}
      </FormField>,
    );
    const input = screen.getByLabelText('Phone');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a valid number Safaricom or Airtel');
  });

  it('KitengeMotif is decorative and marked for the motif count', () => {
    const { container } = render(<KitengeMotif variant="band" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('data-motif', 'band');
  });

  it('EmptyState carries exactly one motif', () => {
    const { container } = render(<EmptyState title="No requests yet" />);
    expect(container.querySelectorAll('[data-motif]')).toHaveLength(1);
  });

  describe('DataTable', () => {
    interface Row {
      id: string;
      name: string;
      total: number;
    }
    const columns: Column<Row>[] = [
      { key: 'name', header: 'Name', cell: (r) => r.name, sortValue: (r) => r.name },
      {
        key: 'total',
        header: 'Total',
        cell: (r) => r.total,
        sortValue: (r) => r.total,
        numeric: true,
      },
    ];
    const rows: Row[] = [
      { id: '1', name: 'Bravo', total: 20 },
      { id: '2', name: 'Alpha', total: 30 },
      { id: '3', name: 'Charlie', total: 10 },
    ];
    const names = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[0]?.textContent);

    it('sorts by a column and exposes aria-sort', async () => {
      render(<DataTable caption="Orders" columns={columns} rows={rows} rowKey={(r) => r.id} />);
      await userEvent.click(screen.getByRole('button', { name: /Total/ }));
      expect(names()).toEqual(['Charlie', 'Bravo', 'Alpha']);
      expect(screen.getByRole('columnheader', { name: /Total/ })).toHaveAttribute(
        'aria-sort',
        'ascending',
      );
      await userEvent.click(screen.getByRole('button', { name: /Total/ }));
      expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    it('paginates', async () => {
      render(
        <DataTable
          caption="Orders"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          pageSize={2}
        />,
      );
      expect(names()).toHaveLength(2);
      expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /Next/ }));
      expect(names()).toEqual(['Charlie']);
    });

    it('shows an empty row and loading rows', () => {
      const { rerender } = render(
        <DataTable
          caption="Orders"
          columns={columns}
          rows={[]}
          rowKey={(r) => r.id}
          empty="No orders"
        />,
      );
      expect(screen.getByText('No orders')).toBeInTheDocument();
      rerender(
        <DataTable
          caption="Orders"
          columns={columns}
          rows={undefined}
          rowKey={(r) => r.id}
          loading
        />,
      );
      expect(screen.getByRole('status')).toHaveTextContent('Loading');
    });
  });
});
