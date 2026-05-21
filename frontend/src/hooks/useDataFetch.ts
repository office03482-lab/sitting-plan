import { useEffect, useMemo, useState } from 'react';

type UseDataFetchOptions<T> = {
  url: string;
  dependencies?: readonly unknown[];
  enabled?: boolean;
  initialData?: T | null;
  fetcher: (context: { signal: AbortSignal }) => Promise<T>;
};

type UseDataFetchResult<T> = {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
};

const inflightRequestsRegistry = new Map<string, Promise<unknown>>();

const buildFingerprint = (url: string, dependencies: readonly unknown[]) =>
  `${url}::${JSON.stringify(dependencies)}`;

export function useDataFetch<T>({
  url,
  dependencies = [],
  enabled = true,
  initialData = null,
  fetcher,
}: UseDataFetchOptions<T>): UseDataFetchResult<T> {
  const [data, setData] = useState<T | null>(initialData);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);

  const requestKey = useMemo(
    () => buildFingerprint(url, dependencies),
    [url, ...dependencies],
  );

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    const existingPromise = inflightRequestsRegistry.get(requestKey) as Promise<T> | undefined;
    const requestPromise =
      existingPromise ||
      fetcher({ signal: controller.signal }).finally(() => {
        inflightRequestsRegistry.delete(requestKey);
      });

    if (!existingPromise) {
      inflightRequestsRegistry.set(requestKey, requestPromise);
    }

    setIsLoading(true);
    setError(null);

    requestPromise
      .then((response) => {
        if (!isMounted || controller.signal.aborted) return;
        setData(response);
      })
      .catch((requestError: unknown) => {
        if (!isMounted || controller.signal.aborted) return;
        setError(requestError instanceof Error ? requestError : new Error('Failed to fetch data.'));
      })
      .finally(() => {
        if (!isMounted || controller.signal.aborted) return;
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
      controller.abort();
      inflightRequestsRegistry.delete(requestKey);
    };
  }, [enabled, fetcher, requestKey]);

  return {
    data,
    error,
    isLoading,
  };
}
