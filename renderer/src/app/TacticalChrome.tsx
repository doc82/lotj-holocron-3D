import type { TacticalCameraMode } from "../features/tactical/TacticalEngine";
import styles from "./App.module.css";
import { CameraIcon, PollingControlIcon, ViewIcon } from "./TacticalIcons";

interface TacticalHeaderProps {
  connected: boolean;
  identity: string;
  systemName: string;
  radarBubbleEnabled: boolean;
  originGridEnabled: boolean;
  navigationActive: boolean;
  cameraMode: TacticalCameraMode;
  cameraFocusName?: string;
  pollingPaused: boolean;
  pollingPausePending: boolean;
  connectionLabel: string;
  onToggleRadar(): void;
  onToggleGrid(): void;
  onCameraMode(mode: TacticalCameraMode): void;
  onSectorView(): void;
  onPollingPaused(paused: boolean): void;
}

export function TacticalHeader({
  connected,
  identity,
  systemName,
  radarBubbleEnabled,
  originGridEnabled,
  navigationActive,
  cameraMode,
  cameraFocusName,
  pollingPaused,
  pollingPausePending,
  connectionLabel,
  onToggleRadar,
  onToggleGrid,
  onCameraMode,
  onSectorView,
  onPollingPaused,
}: TacticalHeaderProps) {
  return (
    <header className={`${styles.topbar} ${styles.panel}`}>
      <div className={styles.systemIdentity}>
        <p className={styles.eyebrow}>{identity}</p>
        <h1 id="system-name">{systemName}</h1>
      </div>
      {connected && (
        <div className={styles.controlStack}>
          <nav className={styles.viewControls} aria-label="Tactical view controls">
            <button
              type="button"
              className={`${styles.iconButton} ${radarBubbleEnabled ? styles.activeViewControl : ""}`}
              aria-label={`${radarBubbleEnabled ? "Hide" : "Show"} radar bubble`}
              aria-pressed={radarBubbleEnabled}
              data-tooltip={`${radarBubbleEnabled ? "HIDE" : "SHOW"} RADAR BUBBLE`}
              onClick={onToggleRadar}
            >
              <ViewIcon type="radar" />
            </button>
            <button
              type="button"
              className={`${styles.iconButton} ${originGridEnabled ? styles.activeViewControl : ""}`}
              aria-label={`${originGridEnabled ? "Hide" : "Show"} origin grid`}
              aria-pressed={originGridEnabled}
              data-tooltip={`${originGridEnabled ? "HIDE" : "SHOW"} ORIGIN GRID`}
              onClick={onToggleGrid}
            >
              <ViewIcon type="grid" />
            </button>
          </nav>
          <nav
            className={`${styles.viewControls} ${styles.cameraControls}`}
            aria-label="Camera controls"
          >
            <button
              type="button"
              disabled={navigationActive}
              className={`${styles.iconButton} ${cameraMode === "player" ? styles.activeViewControl : ""}`}
              aria-label="Follow player ship"
              aria-pressed={cameraMode === "player"}
              data-tooltip="CAMERA // FOLLOW YOUR SHIP"
              onClick={() => onCameraMode("player")}
            >
              <CameraIcon type="player" />
            </button>
            <button
              type="button"
              disabled={navigationActive}
              className={`${styles.iconButton} ${cameraMode === "rts" ? styles.activeViewControl : ""}`}
              aria-label="Enable free RTS camera"
              aria-pressed={cameraMode === "rts"}
              data-tooltip="RTS CAMERA // WASD PAN // Q/E ELEVATION"
              onClick={() => onCameraMode("rts")}
            >
              <CameraIcon type="rts" />
            </button>
            <button
              type="button"
              disabled={navigationActive || !cameraFocusName}
              className={`${styles.iconButton} ${cameraMode === "selection" ? styles.activeViewControl : ""}`}
              aria-label="Focus camera on selected ship"
              aria-pressed={cameraMode === "selection"}
              data-tooltip={
                cameraFocusName
                  ? `CAMERA // FOLLOW ${cameraFocusName.toUpperCase()}`
                  : "SELECT A SHIP TO FOCUS"
              }
              onClick={() => onCameraMode("selection")}
            >
              <CameraIcon type="selection" />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Open strategic sector view"
              data-tooltip="STRATEGIC SECTOR VIEW"
              onClick={onSectorView}
            >
              <ViewIcon type="sector" />
            </button>
          </nav>
        </div>
      )}
      <div className={styles.connectionControls}>
        <button
          type="button"
          className={`${styles.pollingControl} ${pollingPaused ? styles.pollingControlPaused : ""}`}
          disabled={pollingPausePending}
          aria-label={pollingPaused ? "Resume automatic polling" : "Pause automatic polling"}
          aria-pressed={pollingPaused}
          onClick={() => onPollingPaused(!pollingPaused)}
        >
          <PollingControlIcon paused={pollingPaused} />
          <span>{pollingPaused ? "RESUME" : "PAUSE"}</span>
        </button>
        <div className={styles.connection}>
          <span className={`${styles.light} ${connected ? styles.live : ""}`} />
          <span>{connectionLabel}</span>
        </div>
      </div>
    </header>
  );
}

export function PollingPausedOverlay({
  pending,
  onResume,
}: {
  pending: boolean;
  onResume(): void;
}) {
  return (
    <section className={styles.pollingPausedOverlay} role="status" aria-live="assertive">
      <div className={styles.pollingPausedIndicator}>
        <span className={styles.pauseGlyph} aria-hidden="true">
          II
        </span>
        <p>AUTOMATIC COMMAND OUTPUT SUSPENDED</p>
        <h2>POLLING PAUSED</h2>
        <span>TACTICAL TELEMETRY MAY BE STALE // MUDLET COMMAND WINDOW IS CLEAR</span>
        <button type="button" disabled={pending} onClick={onResume}>
          <PollingControlIcon paused />
          {pending ? "RESUMING..." : "RESUME POLLING"}
        </button>
      </div>
    </section>
  );
}
