import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { CombatEvent, Observer, WeaponType } from "../../types/telemetry";
import styles from "./WeaponsPanel.module.css";

export interface WeaponDefinition {
  type: Exclude<WeaponType, "best">;
  label: string;
  field: string;
  launcher?: boolean;
  ammoField?: string;
  description: string;
}

export const WEAPONS: WeaponDefinition[] = [
  { type: "autoblaster", label: "AUTOBLASTER", field: "autoblasters", description: "Rapid close-range energy fire" },
  { type: "laser", label: "LASER", field: "laserCannons", description: "Focused general-purpose energy fire" },
  { type: "turbolaser", label: "TURBOLASER", field: "turbolasers", description: "Heavy capital-ship energy fire" },
  { type: "ion", label: "ION", field: "ionCannons", description: "Ion fire against shields and systems" },
  { type: "missile", label: "MISSILE", field: "maximumMissiles", launcher: true, ammoField: "missiles", description: "Guided explosive projectile" },
  { type: "torpedo", label: "TORPEDO", field: "maximumTorpedoes", launcher: true, ammoField: "torpedoes", description: "Heavy guided projectile" },
  { type: "rocket", label: "ROCKET", field: "maximumRockets", launcher: true, ammoField: "rockets", description: "Fast unguided projectile" },
  { type: "burst", label: "BURST", field: "maximumPulses", launcher: true, description: "Pulse launcher burst" },
];

export function WeaponIcon({ type }: { type: WeaponType | "all" }) {
  const paths = {
    all: <><path d="M5 7h22M5 16h22M5 25h22" /><path d="m21 3 6 4-6 4M21 12l6 4-6 4M21 21l6 4-6 4" /></>,
    best: <><circle cx="16" cy="16" r="10" /><path d="M16 3v8M16 21v8M3 16h8M21 16h8" /><circle cx="16" cy="16" r="2" /></>,
    autoblaster: <><path d="M5 9h13M5 16h18M5 23h13" /><path d="m18 6 7 3-7 3M23 13l6 3-6 3M18 20l7 3-7 3" /></>,
    laser: <><path d="M4 22 22 8" /><path d="m18 6 8-1-2 8M7 25l-2 2" /></>,
    turbolaser: <><path d="M4 11h20M4 21h20" /><path d="m20 6 8 5-8 5M20 16l8 5-8 5" /></>,
    ion: <><circle cx="16" cy="16" r="10" /><path d="m18 5-7 11h6l-3 11 8-14h-6z" /></>,
    missile: <><path d="M7 24 20 7l5 1 1 5-17 13z" /><path d="m9 20-5 1 3-5M13 24l-1 5-4-3" /></>,
    torpedo: <><path d="M5 16 14 7h8l6 9-6 9h-8z" /><path d="M5 11v10M14 7l3 9-3 9" /></>,
    rocket: <><path d="M9 22 19 6l6 1 1 6-16 10z" /><path d="m11 19-6 7M15 22l-3 6" /></>,
    burst: <><circle cx="16" cy="16" r="4" /><path d="M16 2v8M16 22v8M2 16h8M22 16h8M6 6l6 6M20 20l6 6M26 6l-6 6M12 20l-6 6" /></>,
  } satisfies Record<WeaponType | "all", ReactNode>;
  return <svg viewBox="0 0 32 32" aria-hidden="true">{paths[type]}</svg>;
}

interface WeaponsPanelProps {
  observer: Observer;
  targetName: string;
  events?: CombatEvent[];
  disabled?: boolean;
  onFire(weapon: WeaponType | "all"): Promise<string | null>;
}

export function WeaponsPanel({ observer, targetName, events, disabled, onFire }: WeaponsPanelProps) {
  const [charging, setCharging] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("WEAPONS HOT // AWAITING FIRE ORDER");
  const [rumbleToken, setRumbleToken] = useState(0);
  const lastEventIdRef = useRef(0);
  const installed = useMemo(() => WEAPONS.filter((weapon) => {
    const count = Number(observer.weapons?.[weapon.field] || 0);
    return count > 0 && (!weapon.launcher || Number(observer.weapons?.missileTubes || 0) > 0);
  }), [observer.weapons]);

  useEffect(() => {
    for (const event of events ?? []) {
      if (event.id <= lastEventIdRef.current) continue;
      lastEventIdRef.current = event.id;
      if (event.type === "launch") {
        if (event.weapon !== "best") {
          setCharging((current) => new Set(current).add(event.weapon));
        }
        setStatus(`${event.count || 1} ${event.weapon.toUpperCase()} // FIRED`);
      } else if (event.type === "impact") {
        const count = Math.max(1, Number(event.count) || 1);
        setStatus(`${event.weapon.toUpperCase()} // ${event.outcome === "hit"
          ? `${count} TARGET HIT${count === 1 ? "" : "S"}` : "SHOT MISSED"}`);
      } else if (event.type === "charged") {
        setCharging((current) => {
          const next = new Set(current);
          next.delete(event.weapon);
          return next;
        });
        const launcher = WEAPONS.find((weapon) => weapon.type === event.weapon)?.launcher;
        setStatus(`${event.weapon.toUpperCase()} // ${launcher ? "LAUNCHER RELOADED" : "FULLY CHARGED"}`);
      } else if (event.type === "failure") {
        if (event.weapon !== "best") {
          setCharging((current) => {
            const next = new Set(current);
            next.delete(event.weapon);
            return next;
          });
        }
        setStatus(`${event.weapon.toUpperCase()} // ${(event.reason || "FIRE CONTROL LOCK FAILED").toUpperCase()}`);
        setRumbleToken((token) => token + 1);
      }
    }
  }, [events]);

  const fire = async (weapon: WeaponType | "all") => {
    setStatus(`${weapon.toUpperCase()} // TRANSMITTING FIRE ORDER`);
    const error = await onFire(weapon);
    if (error) setStatus(`FIRE ORDER REJECTED // ${error.toUpperCase()}`);
  };

  return (
    <section className={`${styles.panel} ${rumbleToken > 0
      ? rumbleToken % 2 === 0 ? styles.rumbleEven : styles.rumbleOdd
      : ""}`} aria-label="Weapons control">
      <header>
        <strong>WEAPONS // {targetName.toUpperCase()}</strong>
        <span>{status}</span>
      </header>
      <div className={styles.weaponGrid}>
        <button type="button" disabled={disabled || installed.length === 0}
          aria-label="Fire all installed weapons" data-tooltip="FIRE ALL // Cycle every installed weapon"
          onClick={() => void fire("all")}>
          <WeaponIcon type="all" />
        </button>
        <button type="button" disabled={disabled || installed.length === 0}
          aria-label="Fire best available weapon" data-tooltip="BEST WEAPON // Let LotJ select the best available weapon"
          onClick={() => void fire("best")}>
          <WeaponIcon type="best" />
        </button>
        {installed.map((weapon) => {
          const count = Number(observer.weapons?.[weapon.field] || 0);
          const recharging = charging.has(weapon.type);
          const ammunition = weapon.ammoField && typeof observer[weapon.ammoField] === "object"
            ? Number((observer[weapon.ammoField] as { current?: number }).current)
            : null;
          const depleted = ammunition === 0;
          return <button
            key={weapon.type}
            type="button"
            disabled={disabled || recharging || depleted}
            className={recharging ? styles.charging : ""}
            data-tooltip={`${weapon.label} // ${depleted ? "AMMUNITION DEPLETED" : weapon.description} // Installed: ${count}`}
            aria-label={`Fire ${weapon.label.toLowerCase()}`}
            onClick={() => void fire(weapon.type)}
          >
            <WeaponIcon type={weapon.type} /><span>{recharging ? weapon.launcher ? "RELOADING" : "CHARGING" : count}</span>
          </button>;
        })}
      </div>
    </section>
  );
}
