import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the product heading', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => undefined));

    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'OGS – ObagaGlobal Services' }),
    ).toBeInTheDocument();
  });
});
