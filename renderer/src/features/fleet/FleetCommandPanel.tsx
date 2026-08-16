import type { FleetMember, FleetOrderStatus, FleetStatus, WeaponType } from "../../types/telemetry";
import { WEAPONS, WeaponIcon } from "../weapons/WeaponsPanel";
import type { FleetScope } from "./FleetRoster";
import styles from "./FleetCommandPanel.module.css";

type FleetOrder = "target" | "fire" | "recharge" | "shields_on" | "chaff" | "autopilot" | "speed";

function Glyph({ kind }: { kind: string }) {
  const paths: Record<string, string> = {
    move: "M5 25 22 8m-8 0h8v8M5 25h16",
    to: "M4 16h21m-7-7 7 7-7 7",
    away: "M28 16H7m7-7-7 7 7 7",
    target: "M16 4v7m0 10v7M4 16h7m10 0h7M16 11a5 5 0 1 0 0 10 5 5 0 0 0 0-10",
    fire: "M5 22 20 7m-3 0h3v3M8 25l5-5m8-2 6 6",
    shield: "M16 4 27 9v7c0 7-5 10-11 12C10 26 5 23 5 16V9Z",
    recharge: "M16 4 27 9v7c0 7-5 10-11 12C10 26 5 23 5 16V9Zm2 5-7 9h6l-3 7 8-11h-6Z",
    chaff: "M16 16 5 7m11 9 11-9M16 16 7 27m9-11 9 11M16 5v22",
    speed: "M5 22a12 12 0 0 1 22 0M16 22l7-9",
    auto: "M6 23V9l10-5 10 5v14M11 23V13h10v10",
  };
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d={paths[kind] || paths.assist} />
    </svg>
  );
}

function OrderButton({
  label,
  glyph,
  state,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  state?: "on" | "off" | "mixed" | "awaiting" | "unknown";
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      data-tooltip={label}
      data-state={state}
      onClick={onClick}
    >
      <Glyph kind={glyph} />
    </button>
  );
}

function WeaponOrderButton({
  label,
  weapon,
  disabled,
  onClick,
}: {
  label: string;
  weapon: Exclude<WeaponType, "best"> | "all";
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className={styles.weaponButton}
      disabled={disabled}
      aria-label={label}
      data-tooltip={label}
      onClick={onClick}
    >
      <WeaponIcon type={weapon} />
    </button>
  );
}

export function FleetCommandPanel({
  fleet,
  fleetOrder,
  localAutopilot,
  scope,
  targetName,
  canTarget,
  disabled,
  onBeginMove,
  selectedMembers = [],
  onCourseTarget,
  onOrder,
}: {
  fleet: FleetStatus;
  fleetOrder?: FleetOrderStatus;
  localAutopilot?: boolean;
  scope: FleetScope;
  selectedMembers?: FleetMember[];
  targetName?: string;
  canTarget?: boolean;
  disabled?: boolean;
  onBeginMove(): void;
  onCourseTarget(mode: "target" | "away"): void;
  onOrder(order: FleetOrder, payload?: Record<string, unknown>): void;
}) {
  const scopeLabel =
    scope === "all"
      ? "ENTIRE FLEET"
      : scope === "selected"
        ? selectedMembers.length === 1
          ? selectedMembers[0].name.toUpperCase()
          : `${selectedMembers.length} SELECTED CRAFT`
        : scope.toUpperCase();
  const scopedMembers =
    scope === "wings"
      ? fleet.members.filter((member) => !member.leader)
      : scope === "local"
        ? []
        : scope === "selected"
          ? selectedMembers
          : fleet.members;
  const autopilotValues =
    scope === "local"
      ? localAutopilot === undefined
        ? []
        : [localAutopilot]
      : scopedMembers.flatMap((member) =>
          member.autopilot === undefined ? [] : [member.autopilot],
        );
  const autopilotAwaiting = fleetOrder?.order === "autopilot" && (fleetOrder.pendingCount || 0) > 0;
  const autopilotState = autopilotAwaiting
    ? "awaiting"
    : autopilotValues.length === 0
      ? "unknown"
      : autopilotValues.every(Boolean)
        ? "on"
        : autopilotValues.every((value) => !value)
          ? "off"
          : "mixed";
  const autopilotLabel = `AUTOPILOT // ${autopilotState.toUpperCase()}`;

  return (
    <div className={styles.panel}>
      <p>COMMAND // {scopeLabel}</p>
      <div className={styles.group}>
        <span>MOVEMENT</span>
        <div>
          <OrderButton label="MOVE VECTOR" glyph="move" disabled={disabled} onClick={onBeginMove} />
          <OrderButton
            label="COURSE TO SELECTED CONTACT"
            glyph="to"
            disabled={disabled || !targetName}
            onClick={() => onCourseTarget("target")}
          />
          <OrderButton
            label="COURSE AWAY FROM SELECTED CONTACT"
            glyph="away"
            disabled={disabled || !targetName}
            onClick={() => onCourseTarget("away")}
          />
          {[0, 1, 40].map((speed) => (
            <OrderButton
              key={speed}
              label={`SPEED ${speed}`}
              glyph="speed"
              disabled={disabled}
              onClick={() => onOrder("speed", { speed })}
            />
          ))}
        </div>
      </div>
      <div className={styles.group}>
        <span>DEFENSE</span>
        <div>
          <>
            <OrderButton
              label="RECHARGE SHIELDS"
              glyph="recharge"
              disabled={disabled}
              onClick={() => onOrder("recharge")}
            />
            <OrderButton
              label="SHIELDS ON"
              glyph="shield"
              disabled={disabled}
              onClick={() => onOrder("shields_on")}
            />
            <OrderButton
              label="DEPLOY CHAFF"
              glyph="chaff"
              disabled={disabled}
              onClick={() => onOrder("chaff")}
            />
            <OrderButton
              label={autopilotLabel}
              glyph="auto"
              state={autopilotState}
              disabled={disabled}
              onClick={() => onOrder("autopilot")}
            />
          </>
        </div>
      </div>
      <div className={`${styles.group} ${styles.weaponGroup}`}>
        <span>WEAPONS</span>
        <div>
          <OrderButton
            label="SYNCHRONIZE TARGET"
            glyph="target"
            disabled={disabled || !canTarget}
            onClick={() => onOrder("target")}
          />
          <WeaponOrderButton
            label="FIRE ALL AVAILABLE"
            weapon="all"
            disabled={disabled}
            onClick={() => onOrder("fire", { weapon: "all" })}
          />
          {WEAPONS.map((weapon) => (
            <WeaponOrderButton
              key={weapon.type}
              label={`FIRE ${weapon.label}`}
              weapon={weapon.type}
              disabled={disabled}
              onClick={() => onOrder("fire", { weapon: weapon.type })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
