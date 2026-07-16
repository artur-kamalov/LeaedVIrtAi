import { useCallback, useEffect, useState } from "react";

export type ApiResourceStatus = "loading" | "success" | "error";

type UseApiResourceOptions<T> = {
  initialData?: T | null;
  enabled?: boolean;
};

export function useApiResource<T>(
  load: () => Promise<T>,
  { initialData = null, enabled = true }: UseApiResourceOptions<T> = {},
) {
  const [data, setData] = useState<T | null>(initialData);
  const [status, setStatus] = useState<ApiResourceStatus>(enabled ? "loading" : "success");
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    if (!enabled) {
      setData(initialData);
      setError(null);
      setStatus("success");
      return;
    }

    let active = true;

    setStatus("loading");
    setError(null);

    void load()
      .then((nextData) => {
        if (!active) return;
        setData(nextData);
        setStatus("success");
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught);
        setStatus("error");
      });

    return () => {
      active = false;
    };
  }, [enabled, initialData, load, revision]);

  return {
    data,
    error,
    status,
    isLoading: status === "loading",
    isError: status === "error",
    isSuccess: status === "success",
    reload,
  };
}
