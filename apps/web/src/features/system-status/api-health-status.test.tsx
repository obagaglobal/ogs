import { render, screen } from '@testing-library/react';
import { ApiHealthStatus } from './api-health-status';

function mockFetch(response: Response | Error) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
    );
}

describe('ApiHealthStatus', () => {
  it('shows the API as online when the health payload is valid', async () => {
    const fetchSpy = mockFetch(
      Response.json({
        status: 'ok',
        service: 'ogs-api',
        version: '0.1.0',
        timestamp: '2026-01-01T00:00:00.000Z',
        uptimeSeconds: 5,
      }),
    );

    render(<ApiHealthStatus />);

    expect(await screen.findByText('Online')).toBeInTheDocument();
    expect(screen.getByText('ogs-api')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/health', expect.any(Object));
  });

  it('shows the API as unreachable when the request fails', async () => {
    mockFetch(new TypeError('Failed to fetch'));

    render(<ApiHealthStatus />);

    expect(await screen.findByText('Unreachable')).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
  });

  it('rejects a payload that violates the shared contract', async () => {
    mockFetch(Response.json({ status: 'maybe' }));

    render(<ApiHealthStatus />);

    expect(await screen.findByText('Unreachable')).toBeInTheDocument();
    expect(screen.getByText('API returned an unexpected health payload')).toBeInTheDocument();
  });
});
