import { useCallback, useEffect, useRef, useState } from "react";

interface PollingControllerOptions {
  connected: boolean;
  paused: boolean;
  starting: boolean;
  setAlert(message: string): void;
}

export function usePollingController({
  connected,
  paused,
  starting,
  setAlert,
}: PollingControllerOptions) {
  const [pausePending, setPausePending] = useState(false);
  const [probeAttempt, setProbeAttempt] = useState(0);
  const probeSentRef = useRef(false);
  const probeIntentIdsRef = useRef(new Set<string>());
  const probeRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleProbeRetry = useCallback(() => {
    if (probeRetryTimerRef.current) clearTimeout(probeRetryTimerRef.current);
    probeRetryTimerRef.current = setTimeout(() => {
      probeRetryTimerRef.current = null;
      probeSentRef.current = false;
      setProbeAttempt((attempt) => attempt + 1);
    }, 1_500);
  }, []);

  const changePause = useCallback(
    async (nextPaused: boolean) => {
      if (!connected || pausePending) return;
      setPausePending(true);
      const result = await window.holocron?.sendIntent("set_polling_paused", {
        paused: nextPaused,
      });
      setPausePending(false);
      if (result?.accepted === false) {
        setAlert(`POLLING CONTROL REJECTED // ${result.reason || "UNKNOWN"}`);
        return;
      }
      setAlert(nextPaused ? "AUTOMATIC POLLING PAUSED" : "AUTOMATIC POLLING RESUMED");
    },
    [connected, pausePending, setAlert],
  );

  useEffect(() => {
    if (!connected) {
      probeSentRef.current = false;
      probeIntentIdsRef.current.clear();
      if (probeRetryTimerRef.current) clearTimeout(probeRetryTimerRef.current);
      probeRetryTimerRef.current = null;
      return;
    }
    if (starting || paused || probeSentRef.current) return;

    probeSentRef.current = true;
    void window.holocron?.sendIntent("probe_space").then((result) => {
      if (result?.accepted === false) {
        scheduleProbeRetry();
        return;
      }
      if (result?.id) {
        probeIntentIdsRef.current.add(result.id);
        setTimeout(() => probeIntentIdsRef.current.delete(result.id!), 60_000);
      }
    });
  }, [connected, paused, probeAttempt, scheduleProbeRetry, starting]);

  useEffect(
    () =>
      window.holocron?.onIntentAck((ack) => {
        if (!ack.id || !probeIntentIdsRef.current.has(ack.id)) return;
        if (ack.status === "accepted") return;
        probeIntentIdsRef.current.delete(ack.id);
        const reason = String(ack.reason || "").toLowerCase();
        if (
          ack.status === "rejected" &&
          (reason.includes("target lock") ||
            reason.includes("another ship command") ||
            reason.includes("manual telemetry capture"))
        ) {
          scheduleProbeRetry();
        }
      }),
    [scheduleProbeRetry],
  );

  useEffect(
    () => () => {
      if (probeRetryTimerRef.current) clearTimeout(probeRetryTimerRef.current);
    },
    [],
  );

  return { pausePending, changePause } as const;
}
