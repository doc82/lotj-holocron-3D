import type { TelemetryEntity } from "../../types/telemetry";
import type { TacticalTargetShortcut } from "../../domain/tacticalTargets";
import { FleetMeter } from "../fleet/FleetRoster";
import type { ShipDossierMode } from "../telemetry/ShipDossierPanel";
import rosterStyles from "../fleet/FleetRoster.module.css";
import styles from "./TargetShortcutRail.module.css";

function TargetGlyph() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="8" />
      <path d="M16 3v7m0 12v7M3 16h7m12 0h7" />
      <circle cx="16" cy="16" r="2" />
    </svg>
  );
}

function TargetCard({
  target,
  onFocus,
  onClear,
  onOpenDossier,
}: {
  target: TacticalTargetShortcut;
  onFocus(target: TacticalTargetShortcut): void;
  onClear(target: TacticalTargetShortcut): void;
  onOpenDossier(ship: TelemetryEntity, mode: ShipDossierMode): void;
}) {
  const ship = target.ship;
  const available = Boolean(ship?.id);
  const disabled =
    String(ship?.condition || "")
      .trim()
      .toLowerCase() === "disabled";
  const activate = () => {
    if (available) onFocus(target);
  };
  return (
    <article
      className={`${rosterStyles.member} ${styles.targetCard}`}
      data-disabled={disabled}
      data-available={available}
      aria-label={`${target.ownerLabels.join(", ")}: ${target.targetName}`}
      role="button"
      tabIndex={available ? 0 : -1}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
    >
      <span className={rosterStyles.memberTop}>
        <em>{target.ownerLabels.join(" // ")}</em>
        <span className={rosterStyles.cardActions}>
          {ship && (
            <button
              type="button"
              aria-label={`Show status card for ${target.targetName}`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenDossier(ship, "status");
              }}
            >
              S
            </button>
          )}
          {ship && (
            <button
              type="button"
              aria-label={`Show info card for ${target.targetName}`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenDossier(ship, "info");
              }}
            >
              I
            </button>
          )}
          <button
            type="button"
            className={styles.clearTarget}
            aria-label={`Clear target shortcut for ${target.targetName}`}
            onClick={(event) => {
              event.stopPropagation();
              onClear(target);
            }}
          >
            ×
          </button>
        </span>
      </span>
      <strong>{target.targetName}</strong>
      <small>
        {ship
          ? `${String(ship.shipCategory || ship.class || "UNKNOWN CLASS")} // ${String(ship.system || ship.location || "TACTICAL CONTACT")}`
          : "CONTACT NOT PRESENT IN CURRENT SENSOR PICTURE"}
      </small>
      {disabled && (
        <small className={rosterStyles.disabledState}>DISABLED // SYSTEMS FAILURE</small>
      )}
      {ship && (
        <span className={rosterStyles.meters}>
          <FleetMeter label="Hull" reading={ship.hull} tone="hull" />
          <FleetMeter label="Shield" reading={ship.shields} tone="shield" />
          <FleetMeter label="Energy" reading={ship.energy} tone="energy" />
        </span>
      )}
    </article>
  );
}

export function TargetShortcutRail({
  targets,
  drawerOpen,
  onToggle,
  onFocus,
  onClear,
  onOpenDossier,
}: {
  targets: TacticalTargetShortcut[];
  drawerOpen: boolean;
  onToggle(): void;
  onFocus(target: TacticalTargetShortcut): void;
  onClear(target: TacticalTargetShortcut): void;
  onOpenDossier(ship: TelemetryEntity, mode: ShipDossierMode): void;
}) {
  if (targets.length === 0) return null;
  const directTarget = targets.length === 1 ? targets[0] : null;
  return (
    <>
      <nav className={styles.rail} aria-label="Active combat targets">
        <p>TARGETS</p>
        <button
          type="button"
          aria-pressed={drawerOpen}
          aria-expanded={targets.length > 1 && drawerOpen}
          aria-label={
            directTarget
              ? `Select ${directTarget.targetName}`
              : `Choose from ${targets.length} active targets`
          }
          onClick={() => (directTarget ? onFocus(directTarget) : onToggle())}
        >
          <TargetGlyph />
          <strong>{directTarget ? "TARGET" : "TARGETS"}</strong>
          <small>{targets.length}</small>
        </button>
        {directTarget && (
          <button
            type="button"
            className={styles.clearDirectTarget}
            aria-label={`Clear target shortcut for ${directTarget.targetName}`}
            onClick={() => onClear(directTarget)}
          >
            ×
          </button>
        )}
      </nav>
      {targets.length > 1 && drawerOpen && (
        <aside className={styles.drawer} aria-label="Active target shortcuts">
          <header>
            <div>
              <p>TARGET MEMORY</p>
              <h2>{targets.length} ACTIVE TARGETS</h2>
            </div>
            <button
              type="button"
              className={styles.close}
              aria-label="Close active target shortcuts"
              onClick={onToggle}
            >
              ×
            </button>
          </header>
          <div className={styles.list}>
            {targets.map((target) => (
              <TargetCard
                key={target.id}
                target={target}
                onFocus={onFocus}
                onClear={onClear}
                onOpenDossier={onOpenDossier}
              />
            ))}
          </div>
        </aside>
      )}
    </>
  );
}
