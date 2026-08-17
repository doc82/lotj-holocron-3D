import type { ScenePoint } from "../domain/scene";
import type {
  CombatEvent,
  FleetMember,
  FleetOrderStatus,
  FleetStatus,
  Observer,
  ShipDisposition,
  WeaponType,
} from "../types/telemetry";
import { FleetCommandPanel } from "../features/fleet/FleetCommandPanel";
import type { FleetScope } from "../features/fleet/FleetRoster";
import { SquadronCommandPanel } from "../features/fleet/SquadronCommandPanel";
import { ShipSpeedControl } from "../features/commands/ShipSpeedControl";
import type { NavigationCommandMode, NavigationMode } from "../features/commands/navigationReducer";
import type { ShipDossierMode } from "../features/telemetry/ShipDossierPanel";
import { WeaponsPanel } from "../features/weapons/WeaponsPanel";
import styles from "./App.module.css";
import { CommandIcon, MoveIcon } from "./TacticalIcons";

interface CommandActionPanelProps {
  navigationMode: NavigationMode;
  navigationCommandMode: NavigationCommandMode;
  navigationTarget: ScenePoint | null;
  commandIssuerLabel: string;
  fleetCommandMode: boolean;
  fleet?: FleetStatus;
  fleetOrder?: FleetOrderStatus;
  fleetScope: FleetScope;
  selectedFleetMembers: FleetMember[];
  selectedFleetScopeEmpty: boolean;
  formationCommandsEnabled: boolean;
  observer: Observer;
  combatTargetName: string | null;
  combatEvents: CombatEvent[];
  selectedShip: ScenePoint | null;
  navigableTarget: ScenePoint | null;
  landed: boolean;
  commandLocked: boolean;
  observerHasNoWeapons: boolean;
  autotrackObserved: boolean | null;
  autotrackDesired: boolean;
  autotrackPending: boolean;
  shieldRecharging: boolean;
  shieldStatusPending: boolean;
  shieldsFull: boolean;
  autoRechargeEnabled: boolean;
  requestedSpeed: number;
  maximumSpeed: number;
  localName: string;
  manualScanStatus: string;
  onCancelNavigation(): void;
  onBeginMove(): void;
  onCourseTarget(mode: "target" | "away"): void;
  onTarget(): void;
  onFire(weapon: WeaponType | "all"): Promise<string | null>;
  onFleetOrder(order: string, payload?: Record<string, unknown>): void;
  onOpenDossier(target: ScenePoint, mode: ShipDossierMode): void;
  onToggleAutotrack(): void;
  onRechargeShields(): void;
  onToggleAutoRecharge(): void;
  onSpeedChange(speed: number): void;
  onSpeedCommit(speed: number): void;
  onDisposition(ship: ScenePoint, disposition: ShipDisposition): void;
}

export function CommandActionPanel(props: CommandActionPanelProps) {
  const {
    navigationMode,
    navigationCommandMode,
    navigationTarget,
    commandIssuerLabel,
    fleetCommandMode,
    fleet,
    fleetOrder,
    fleetScope,
    selectedFleetMembers,
    selectedFleetScopeEmpty,
    formationCommandsEnabled,
    observer,
    combatTargetName,
    combatEvents,
    selectedShip,
    navigableTarget,
    landed,
    commandLocked,
    observerHasNoWeapons,
    autotrackObserved,
    autotrackDesired,
    autotrackPending,
    shieldRecharging,
    shieldStatusPending,
    shieldsFull,
    autoRechargeEnabled,
    requestedSpeed,
    maximumSpeed,
    localName,
    manualScanStatus,
    onCancelNavigation,
    onBeginMove,
    onCourseTarget,
    onTarget,
    onFire,
    onFleetOrder,
    onOpenDossier,
    onToggleAutotrack,
    onRechargeShields,
    onToggleAutoRecharge,
    onSpeedChange,
    onSpeedCommit,
    onDisposition,
  } = props;

  return (
    <section className={styles.commandBank} aria-label="Context-sensitive actions">
      {navigationMode !== "idle" ? (
        <>
          <p className={styles.eyebrow}>COMMAND // NAVIGATION</p>
          <div className={styles.actionPending} role="status">
            <span className={styles.pendingSignal} aria-hidden="true" />
            <strong>WAITING FOR CONFIRMATION</strong>
            <small>
              {navigationCommandMode === "relative"
                ? "COURSE VECTOR"
                : `${navigationCommandMode === "away" ? "COURSE AWAY" : "COURSE TO"} // ${(navigationTarget?.name || "TARGET LOST").toUpperCase()}`}
            </small>
            <button type="button" onClick={onCancelNavigation}>
              <CommandIcon type="cancel" />
              <span>CANCEL COMMAND</span>
            </button>
          </div>
        </>
      ) : fleetCommandMode && fleet ? (
        fleet.kind === "squadron" ? (
          <SquadronCommandPanel
            fleet={fleet}
            observer={observer}
            targetName={combatTargetName || undefined}
            events={combatEvents}
            canTarget={selectedShip !== null}
            disabled={landed || commandLocked || !formationCommandsEnabled}
            weaponsDisabled={landed}
            onTarget={onTarget}
            onFire={onFire}
            onOrder={onFleetOrder}
          />
        ) : (
          <FleetCommandPanel
            fleet={fleet}
            fleetOrder={fleetOrder}
            localAutopilot={observer.autopilot}
            scope={fleetScope}
            selectedMembers={selectedFleetMembers}
            targetName={navigableTarget?.name}
            canTarget={selectedShip !== null}
            disabled={landed || commandLocked || selectedFleetScopeEmpty}
            onBeginMove={onBeginMove}
            onCourseTarget={onCourseTarget}
            onOrder={onFleetOrder}
          />
        )
      ) : (
        <>
          <p className={styles.eyebrow}>ACTIONS // {commandIssuerLabel.toUpperCase()}</p>
          <div className={styles.orderActions}>
            {navigableTarget ? (
              <>
                {selectedShip && (
                  <>
                    <button
                      type="button"
                      className={`${styles.iconButton} ${styles.aggressiveOrder}`}
                      disabled={landed || commandLocked || observerHasNoWeapons}
                      aria-label="Target selected ship"
                      data-tooltip={
                        observerHasNoWeapons
                          ? "This ship has no weapons"
                          : "TARGET // AGGRESSIVE ACT"
                      }
                      onClick={onTarget}
                    >
                      <CommandIcon type="target" />
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label="Show selected ship status card"
                      data-tooltip="STATUS CARD"
                      onClick={() => onOpenDossier(selectedShip, "status")}
                    >
                      <CommandIcon type="scan" />
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label="Show selected ship information card"
                      data-tooltip="INFO CARD"
                      onClick={() => onOpenDossier(selectedShip, "info")}
                    >
                      <CommandIcon type="info" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={styles.iconButton}
                  disabled={landed || commandLocked}
                  aria-label="Course toward selected contact"
                  data-tooltip="TO"
                  onClick={() => onCourseTarget("target")}
                >
                  <CommandIcon type="to" />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  disabled={landed || commandLocked}
                  aria-label="Course away from selected contact"
                  data-tooltip="AWAY"
                  onClick={() => onCourseTarget("away")}
                >
                  <CommandIcon type="away" />
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={landed || commandLocked}
                className={styles.iconButton}
                aria-label="Set relative course"
                data-tooltip="MOVE / M"
                onClick={onBeginMove}
              >
                <MoveIcon />
              </button>
            )}
            <button
              type="button"
              className={`${styles.iconButton} ${autotrackObserved === true ? styles.activeOrder : ""}`}
              disabled={landed || autotrackPending}
              aria-label={`${autotrackDesired ? "Disable" : "Enable"} autotrack`}
              aria-pressed={autotrackObserved === true}
              data-tooltip={`AUTOTRACK ${autotrackPending ? "AWAITING CONFIRMATION" : autotrackDesired ? "ON" : "OFF"}`}
              onClick={onToggleAutotrack}
            >
              <CommandIcon type="track" />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              disabled={
                landed || commandLocked || shieldRecharging || shieldStatusPending || shieldsFull
              }
              aria-label="Recharge shields to full"
              data-tooltip={
                shieldsFull
                  ? "SHIELDS AT PEAK POWER"
                  : shieldRecharging
                    ? "SHIELD RECHARGE RUNNING"
                    : "RECHARGE SHIELDS TO FULL"
              }
              onClick={onRechargeShields}
            >
              <CommandIcon type="recharge" />
            </button>
            <button
              type="button"
              className={`${styles.iconButton} ${autoRechargeEnabled ? styles.activeOrder : ""}`}
              disabled={landed}
              aria-label={`${autoRechargeEnabled ? "Disable" : "Enable"} automatic shield recharge`}
              aria-pressed={autoRechargeEnabled}
              data-tooltip={`AUTO RECHARGE ${autoRechargeEnabled ? "ON" : "OFF"}`}
              onClick={onToggleAutoRecharge}
            >
              <CommandIcon type="autoRecharge" />
            </button>
          </div>
          {selectedShip && (
            <div className={styles.aggressiveWarning}>
              TARGET // WEAPON LOCK IS AN AGGRESSIVE ACT
            </div>
          )}
          <ShipSpeedControl
            id="ship-speed"
            label={`PLAYER SPEED // ${localName.toUpperCase()}`}
            value={requestedSpeed}
            maximum={maximumSpeed}
            disabled={landed || commandLocked}
            onChange={onSpeedChange}
            onCommit={onSpeedCommit}
          />
          {combatTargetName ? (
            <WeaponsPanel
              observer={observer}
              targetName={combatTargetName}
              events={combatEvents}
              disabled={landed}
              onFire={onFire}
            />
          ) : selectedShip ? (
            <>
              <div className={styles.dispositions} aria-label="Ship disposition">
                {(["neutral", "ally", "enemy"] as ShipDisposition[]).map((disposition) => (
                  <button
                    key={disposition}
                    type="button"
                    className={styles.iconButton}
                    aria-pressed={(selectedShip.disposition || "neutral") === disposition}
                    aria-label={`Mark ship ${disposition === "ally" ? "friendly" : disposition}`}
                    data-tooltip={disposition === "ally" ? "FRIENDLY" : disposition.toUpperCase()}
                    onClick={() => onDisposition(selectedShip, disposition)}
                  >
                    <CommandIcon type={disposition === "ally" ? "friendly" : disposition} />
                  </button>
                ))}
              </div>
              {manualScanStatus && (
                <div className={styles.manualScanStatus} role="status">
                  {manualScanStatus}
                </div>
              )}
            </>
          ) : navigableTarget ? (
            <div className={styles.commandStandby}>
              SELECT TO OR AWAY // {navigableTarget.name.toUpperCase()}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
