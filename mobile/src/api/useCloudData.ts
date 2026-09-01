import { useCallback, useEffect, useState } from 'react';
import { USE_MOCK_DATA } from './config';
import { ApiError } from './client';

interface CloudDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** 403 from the server's own entitlement gate (requireCapability) — render a LockedState, not an ErrorState. */
  locked: boolean;
  refetch: () => void;
}

/**
 * Loads real data from `fetcher` against the live XauCloud API, or returns
 * `mockValue` unchanged when USE_MOCK_DATA is true (local design-review
 * builds only — see api/config.ts). Every screen using this hook renders
 * through the identical loading/error/locked/data branches either way, so
 * flipping USE_MOCK_DATA is the only thing that changes at runtime.
 */
export function useCloudData<T>(fetcher: () => Promise<T>, mockValue: T, deps: unknown[] = []): CloudDataResult<T> {
  const [data, setData] = useState<T | null>(USE_MOCK_DATA ? mockValue : null);
  const [loading, setLoading] = useState(!USE_MOCK_DATA);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const load = useCallback(() => {
    if (USE_MOCK_DATA) {
      setData(mockValue);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setLocked(false);
    fetcher()
      .then((result) => setData(result))
      .catch((e: unknown) => {
        // A failed refetch must never leave a PRIOR successful result on
        // screen -- e.g. a trial/subscription that expired while a screen
        // stayed mounted must not keep rendering the signals/outlook it
        // fetched while still entitled. Every caller renders its locked
        // branch off `data == null`, so this is what actually enforces
        // that a lost entitlement removes content, not just the flag.
        setData(null);
        if (e instanceof ApiError && e.status === 403) {
          setLocked(true);
        } else {
          setError(e instanceof Error ? e.message : 'Something went wrong. Pull to retry.');
        }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, locked, refetch: load };
}
