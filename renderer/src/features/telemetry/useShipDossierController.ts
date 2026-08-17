import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveDossierShip } from "../../domain/tacticalWorkspace";
import type { ScenePoint } from "../../domain/scene";
import { useTimeoutRegistry } from "../../hooks/useTimeoutRegistry";
import type { FleetMember, Observer, SystemSnapshot, TelemetryEntity } from "../../types/telemetry";
import type { ShipDossierMode } from "./ShipDossierPanel";

export interface ShipDossierRequest {
  id: string;
  name: string;
  mode: ShipDossierMode;
  seed: TelemetryEntity;
}

interface DossierControllerOptions {
  connected: boolean;
  landed: boolean;
  commandLocked: boolean;
  snapshot: SystemSnapshot | null;
  localName: string;
  localObserver?: Observer;
  fleetMembers?: FleetMember[];
  scenePoints: ScenePoint[];
  setAlert(message: string): void;
  onOpen(): void;
}

export function useShipDossierController({
  connected,
  landed,
  commandLocked,
  snapshot,
  localName,
  localObserver,
  fleetMembers,
  scenePoints,
  setAlert,
  onOpen,
}: DossierControllerOptions) {
  const [request, setRequest] = useState<ShipDossierRequest | null>(null);
  const [scanSource, setScanSource] = useState<ShipDossierMode | null>(null);
  const [scanStatus, setScanStatus] = useState("");
  const scanIntentIdsRef = useRef(new Set<string>());
  const scanStartSequenceRef = useRef(0);
  const scanRequestTokenRef = useRef(0);
  const scanTargetIdRef = useRef<string | null>(null);
  const scheduleTimeout = useTimeoutRegistry();

  const ship = useMemo(
    () =>
      resolveDossierShip({
        request,
        localName,
        localObserver,
        fleetMembers,
        scenePoints,
      }),
    [fleetMembers, localName, localObserver, request, scenePoints],
  );

  const requestScan = useCallback(
    async (target: TelemetryEntity, source: ShipDossierMode) => {
      const shipName = String(target.name || "").trim();
      if (!shipName || !connected || landed || commandLocked || scanTargetIdRef.current) return;
      const token = scanRequestTokenRef.current + 1;
      scanRequestTokenRef.current = token;
      scanStartSequenceRef.current = snapshot?.sequence ?? 0;
      scanTargetIdRef.current = target.id;
      setScanSource(source);
      setScanStatus(`${source.toUpperCase()} SCAN TRANSMITTING...`);
      const result = await window.holocron?.sendIntent("scan_ship", {
        targetId: target.id,
        targetName: shipName,
        source,
      });
      if (scanRequestTokenRef.current !== token) return;
      if (result?.accepted === false) {
        const message = `${source.toUpperCase()} SCAN REJECTED // ${result.reason || "UNKNOWN"}`;
        setAlert(message);
        scanTargetIdRef.current = null;
        setScanSource(null);
        setScanStatus(message);
        return;
      }
      if (result?.id) {
        scanIntentIdsRef.current.add(result.id);
        scheduleTimeout(() => scanIntentIdsRef.current.delete(result.id!), 12_000);
      }
      setScanStatus(`${source.toUpperCase()} SCAN REQUESTED // ${shipName.toUpperCase()}`);
      scheduleTimeout(() => {
        if (scanRequestTokenRef.current !== token) return;
        scanRequestTokenRef.current += 1;
        scanTargetIdRef.current = null;
        setScanSource(null);
        setScanStatus(`${source.toUpperCase()} SCAN TIMED OUT`);
      }, 10_000);
    },
    [commandLocked, connected, landed, scheduleTimeout, setAlert, snapshot?.sequence],
  );

  const cancelScan = useCallback(() => {
    scanRequestTokenRef.current += 1;
    scanIntentIdsRef.current.clear();
    scanTargetIdRef.current = null;
    setScanSource(null);
    setScanStatus("");
  }, []);

  const open = useCallback(
    (target: TelemetryEntity | FleetMember, mode: ShipDossierMode) => {
      const name = String(target.name || "").trim();
      if (!name) return;
      const seed = { ...target, kind: "ship" } as TelemetryEntity;
      cancelScan();
      onOpen();
      setRequest({ id: target.id, name, mode, seed });
      void requestScan(seed, mode);
    },
    [cancelScan, onOpen, requestScan],
  );

  const changeMode = useCallback(
    (mode: ShipDossierMode) => {
      if (!request || !ship) return;
      cancelScan();
      setRequest((current) => (current ? { ...current, mode } : current));
      void requestScan(ship, mode);
    },
    [cancelScan, request, requestScan, ship],
  );

  useEffect(
    () =>
      window.holocron?.onIntentAck((ack) => {
        if (!ack.id || !scanIntentIdsRef.current.has(ack.id)) return;
        if (ack.status === "accepted") return;
        scanIntentIdsRef.current.delete(ack.id);
        if (ack.status !== "rejected") return;
        scanRequestTokenRef.current += 1;
        scanTargetIdRef.current = null;
        setScanSource(null);
        setScanStatus(String(ack.reason || "SHIP SCAN REJECTED").toUpperCase());
      }),
    [],
  );

  useEffect(() => {
    if (!scanSource || !snapshot) return;
    if (
      (snapshot.sequence ?? 0) <= scanStartSequenceRef.current ||
      snapshot.metadata?.lastSource !== scanSource
    ) {
      return;
    }
    scanRequestTokenRef.current += 1;
    scanTargetIdRef.current = null;
    setScanSource(null);
    setScanStatus(`${scanSource.toUpperCase()} TELEMETRY UPDATED`);
  }, [scanSource, snapshot]);

  useEffect(() => {
    if (!scanStatus || scanSource) return;
    const timer = setTimeout(() => setScanStatus(""), 5_000);
    return () => clearTimeout(timer);
  }, [scanSource, scanStatus]);

  const close = useCallback(() => {
    cancelScan();
    setRequest(null);
  }, [cancelScan]);

  const refresh = useCallback(() => {
    if (ship && request) void requestScan(ship, request.mode);
  }, [request, requestScan, ship]);

  return {
    request,
    ship,
    scanSource,
    scanStatus,
    loading: Boolean(scanSource === request?.mode && scanTargetIdRef.current === ship?.id),
    open,
    close,
    changeMode,
    refresh,
  } as const;
}
