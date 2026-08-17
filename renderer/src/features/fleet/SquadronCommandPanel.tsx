import { useState } from "react";

import type { CombatEvent, FleetStatus, Observer, WeaponType } from "../../types/telemetry";
import { WeaponsPanel } from "../weapons/WeaponsPanel";
import styles from "./SquadronCommandPanel.module.css";

const AIM_SYSTEMS = ["laser", "ion", "launcher", "tractor", "turret"] as const;

type SquadronOrder = "roll" | "chaff" | "assist" | "aim";

function SquadronIcon({ type }: { type: SquadronOrder | "target" | "clear" }) {
  const paths = {
    roll: <path d="M7 11a11 11 0 0 1 18 1m0 0V6m0 6h-6M25 21a11 11 0 0 1-18-1m0 0v6m0-6h6" />,
    chaff: <path d="M16 16 5 7m11 9 11-9M16 16 7 27m9-11 9 11M16 5v22" />,
    assist: (
      <>
        <path d="M7 16h18M16 7v18" />
        <circle cx="16" cy="16" r="10" />
      </>
    ),
    aim: (
      <>
        <path d="M6 7h20l-8 9v8l-4 2V16Z" />
        <circle cx="24" cy="24" r="4" />
      </>
    ),
    target: (
      <>
        <circle cx="16" cy="16" r="8" />
        <path d="M16 3v7M16 22v7M3 16h7M22 16h7" />
      </>
    ),
    clear: <path d="M8 8l16 16M24 8 8 24" />,
  };
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      {paths[type]}
    </svg>
  );
}

export function SquadronCommandPanel({
  fleet,
  observer,
  targetName,
  events,
  canTarget,
  disabled,
  weaponsDisabled,
  onTarget,
  onFire,
  onOrder,
}: {
  fleet: FleetStatus;
  observer: Observer;
  targetName?: string;
  events?: CombatEvent[];
  canTarget: boolean;
  disabled?: boolean;
  weaponsDisabled?: boolean;
  onTarget(): void;
  onFire(weapon: WeaponType | "all"): Promise<string | null>;
  onOrder(order: SquadronOrder, payload?: Record<string, unknown>): void;
}) {
  const [aimOpen, setAimOpen] = useState(false);
  const aimSystem = String(fleet.aimSystem || "")
    .trim()
    .toLowerCase();
  const aimActive = aimSystem !== "" && aimSystem !== "none";
  const assistState = fleet.assist === undefined ? "unknown" : fleet.assist ? "on" : "off";

  const chooseAim = (system: string) => {
    setAimOpen(false);
    onOrder("aim", { system });
  };

  return (
    <div className={styles.panel}>
      <header>
        <div>
          <p>COMMAND // SQUADRON</p>
          <strong>{fleet.members.length} CRAFT // LEAD SHIP CONTROL</strong>
        </div>
        <span>WINGMEN MIRROR MOVEMENT AND FIRE</span>
      </header>
      <p className={styles.flow}>
        1 SELECT AND TARGET // 2 FIRE FROM THE LEAD // ASSIST MIRRORS THE VOLLEY
      </p>

      <div className={styles.tacticalGrid}>
        <button
          type="button"
          disabled={disabled}
          data-state={assistState}
          aria-label={`Squadron fire assist ${assistState}`}
          aria-pressed={fleet.assist === true}
          data-tooltip={`FIRE ASSIST // ${assistState.toUpperCase()}`}
          onClick={() => onOrder("assist")}
        >
          <SquadronIcon type="assist" />
          <span>ASSIST</span>
          <small>{assistState.toUpperCase()}</small>
        </button>
        <div className={styles.aimControl}>
          <button
            type="button"
            disabled={disabled}
            data-active={aimActive}
            aria-expanded={aimOpen}
            aria-haspopup="menu"
            data-tooltip={aimActive ? `AIM // ${aimSystem.toUpperCase()}` : "SET SQUADRON AIM"}
            onClick={() => setAimOpen((open) => !open)}
          >
            <SquadronIcon type="aim" />
            <span>AIM</span>
            <small>{aimActive ? aimSystem.toUpperCase() : "NONE"}</small>
          </button>
          {aimActive && (
            <button
              type="button"
              className={styles.clearAim}
              disabled={disabled}
              aria-label="Clear squadron aim"
              data-tooltip="CLEAR SQUADRON AIM"
              onClick={() => chooseAim("none")}
            >
              <SquadronIcon type="clear" />
            </button>
          )}
          {aimOpen && (
            <div className={styles.aimMenu} role="menu" aria-label="Squadron aim system">
              {AIM_SYSTEMS.map((system) => (
                <button
                  key={system}
                  type="button"
                  role="menuitemradio"
                  aria-checked={aimSystem === system}
                  onClick={() => chooseAim(system)}
                >
                  {system.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={disabled}
          data-tooltip="SQUADRON ROLL"
          onClick={() => onOrder("roll")}
        >
          <SquadronIcon type="roll" />
          <span>ROLL</span>
          <small>WINGMEN</small>
        </button>
        <button
          type="button"
          disabled={disabled}
          data-tooltip="SQUADRON CHAFF"
          onClick={() => onOrder("chaff")}
        >
          <SquadronIcon type="chaff" />
          <span>CHAFF</span>
          <small>WINGMEN</small>
        </button>
        <button
          type="button"
          disabled={disabled || !canTarget}
          data-tooltip="TARGET SELECTED SHIP"
          onClick={onTarget}
        >
          <SquadronIcon type="target" />
          <span>TARGET</span>
          <small>{canTarget ? "SELECTED" : "NONE"}</small>
        </button>
      </div>

      {targetName ? (
        <WeaponsPanel
          observer={observer}
          targetName={targetName}
          events={events}
          disabled={weaponsDisabled}
          onFire={onFire}
        />
      ) : (
        <p className={styles.standby}>
          LOCK A TARGET TO ARM LEAD-SHIP WEAPONS // FIRE ASSIST MIRRORS THE VOLLEY
        </p>
      )}
    </div>
  );
}
