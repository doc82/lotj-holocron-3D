import { useCallback, useEffect, useRef, useState } from "react";

import { useTimeoutRegistry } from "../../hooks/useTimeoutRegistry";
import type { FleetOrderStatus } from "../../types/telemetry";

export interface CommandToast {
  id: number;
  message: string;
  tone: "info" | "success" | "warning" | "error";
}

export function commandToastTone(message: string): CommandToast["tone"] {
  if (/REJECT|BLOCK|FAIL|TIMED OUT|LOST|REQUIRES|SELECT A|CANNOT/.test(message)) return "error";
  if (/WAIT|AWAIT|TRANSMITTING|TARGETING|TRACKING/.test(message)) return "warning";
  if (/ACCEPT|COMPLETE|TRANSMITTED|UPDATED|\bON\b|\bOFF\b/.test(message)) return "success";
  return "info";
}

export function useCommandFeedback(fleetOrder?: FleetOrderStatus) {
  const [alert, setAlertValue] = useState("");
  const [toasts, setToasts] = useState<CommandToast[]>([]);
  const toastIdRef = useRef(0);
  const lastFleetToastKeyRef = useRef("");
  const scheduleTimeout = useTimeoutRegistry();

  const pushToast = useCallback(
    (message: string, tone = commandToastTone(message)) => {
      if (!message) return;
      const id = ++toastIdRef.current;
      setToasts((current) => [...current, { id, message, tone }].slice(-4));
      scheduleTimeout(
        () => setToasts((current) => current.filter((toast) => toast.id !== id)),
        5_000,
      );
    },
    [scheduleTimeout],
  );

  const setAlert = useCallback(
    (message: string) => {
      setAlertValue(message);
      if (message) pushToast(message);
    },
    [pushToast],
  );

  useEffect(() => {
    if (!fleetOrder || !["accepted", "partial", "rejected"].includes(fleetOrder.status || "")) {
      return;
    }
    const reason =
      fleetOrder.reason ||
      Object.values(fleetOrder.results || {}).find((result) => result.reason)?.reason;
    const key = [
      fleetOrder.id,
      fleetOrder.order,
      fleetOrder.status,
      fleetOrder.acceptedCount,
      fleetOrder.rejectedCount,
      reason,
    ].join(":");
    if (lastFleetToastKeyRef.current === key) return;
    lastFleetToastKeyRef.current = key;
    const message =
      `${(fleetOrder.order || "ORDER").toUpperCase()} // ${(fleetOrder.status || "TRANSMITTED").toUpperCase()}` +
      ` // ${fleetOrder.acceptedCount || 0} ACCEPTED // ${fleetOrder.rejectedCount || 0} REJECTED` +
      (reason ? ` // ${reason.toUpperCase()}` : "");
    pushToast(message, fleetOrder.status === "accepted" ? "success" : "error");
  }, [fleetOrder, pushToast]);

  useEffect(() => {
    if (!alert) return;
    const timer = setTimeout(() => setAlertValue(""), 5_000);
    return () => clearTimeout(timer);
  }, [alert]);

  return { alert, toasts, setAlert, pushToast } as const;
}
