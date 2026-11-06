import { useWorkspace } from '@/features/workspace/workspace-state';

export const ELEVATION_KEY = 'ogs.elevation';

interface StoredElevation {
  readonly id: string;
  readonly expiresAt: string;
}

export function currentElevation(): StoredElevation | undefined {
  const raw = sessionStorage.getItem(ELEVATION_KEY);
  if (raw === null) {
    return undefined;
  }
  const parsed = JSON.parse(raw) as StoredElevation;
  return new Date(parsed.expiresAt) > new Date() ? parsed : undefined;
}

/** Request options for elevated platform calls (review §6.3). */
export function useElevated() {
  const { selected } = useWorkspace();
  const elevation = currentElevation();
  return {
    elevation,
    options: {
      workspace: selected,
      headers: elevation ? { 'X-OGS-Elevation': elevation.id } : {},
    },
  };
}
