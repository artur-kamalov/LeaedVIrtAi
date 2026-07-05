import { useEffect, useState } from "react";

export type ApiResourceStatus = "loading" | "success" | "error";

type UseApiResourceOptions<T> = {
  initialData?: T | null;
  errorData?: T | null;
  enabled?: boolean;
};

export function useApiResource<T>(
  load: () => Promise<T>,
  { initialData = null, errorData = initialData, enabled = true }: UseApiResourceOptions<T> = {}
) {
  const [data, setData] = useState<T | null>(initialData);
  const [status, setStatus] = useState<ApiResourceStatus>(enabled ? "loading" : "success");
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!enabled) {
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
        setData(errorData);
        setError(caught);
        setStatus("error");
      });

    return () => {
      active = false;
    };
  }, [enabled, errorData, load]);

  return {
    data,
    error,
    status,
    isLoading: status === "loading",
    isError: status === "error",
    isSuccess: status === "success",
  };
}
