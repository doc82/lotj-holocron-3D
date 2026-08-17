import { useCallback, useEffect, useRef } from "react";

export function useTimeoutRegistry() {
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  const scheduleTimeout = useCallback((callback: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      callback();
    }, delay);
    timersRef.current.add(timer);
    return timer;
  }, []);

  useEffect(
    () => () => {
      for (const timer of timersRef.current) clearTimeout(timer);
      timersRef.current.clear();
    },
    [],
  );

  return scheduleTimeout;
}
