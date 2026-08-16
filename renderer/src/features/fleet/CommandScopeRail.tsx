import type { FleetStatus } from "../../types/telemetry";
import { canCommandFormation } from "../../domain/fleet";
import type { FleetScope } from "./FleetRoster";
import styles from "./CommandScopeRail.module.css";

function ScopeGlyph({ scope, squadron }: { scope: FleetScope; squadron: boolean }) {
  if (scope === "local") return <svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M16 4 27 25l-11-5-11 5Z" /><path d="M16 9v11" />
  </svg>;
  if (scope === "wings") return <svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M5 10 14 5v22l-9-5Zm22 0-9-5v22l9-5Z" /><path d="M14 16h4" />
  </svg>;
  return <svg viewBox="0 0 32 32" aria-hidden="true">
    {squadron
      ? <><path d="M16 4 23 17l-7-3-7 3Z" /><path d="m8 17 4 8-4-2-4 2Zm16 0 4 8-4-2-4 2Z" /></>
      : <><path d="M16 4 23 17l-7-3-7 3Z" /><path d="M5 15 11 26l-6-3-3 3Zm22 0-6 11 6-3 3 3Z" /></>}
  </svg>;
}

export function CommandScopeRail({ fleet, localName, scope, drawerOpen, onSelect }: {
  fleet?: FleetStatus;
  localName: string;
  scope: FleetScope;
  drawerOpen: boolean;
  onSelect(scope: FleetScope): void;
}) {
  const squadron = fleet?.kind === "squadron";
  const formationEnabled = fleet?.active === true && canCommandFormation(fleet, localName);
  const choices: Array<{ scope: FleetScope; label: string; count?: number }> = [
    { scope: "local", label: "YOUR SHIP", count: 1 },
  ];
  if (fleet?.active) {
    choices.push({ scope: "all", label: squadron ? "SQUADRON" : "FLEET", count: fleet.members.length });
    if (!squadron) choices.push({ scope: "wings", label: "WINGS", count: fleet.members.filter((member) => !member.leader).length });
  }

  return <nav className={styles.rail} aria-label="Command recipient">
    <p>ISSUE TO</p>
    {choices.map((choice) => {
      const active = scope === choice.scope || scope === "selected" && choice.scope === "wings";
      return <button key={choice.scope} type="button"
        disabled={choice.scope !== "local" && !formationEnabled}
        aria-pressed={active}
        aria-expanded={active && drawerOpen}
        aria-label={`Issue commands to ${choice.label.toLowerCase()}`}
        onClick={() => onSelect(choice.scope)}>
        <ScopeGlyph scope={choice.scope} squadron={squadron} />
        <strong>{choice.label}</strong>
        {choice.count !== undefined && <small>{choice.count}</small>}
      </button>;
    })}
  </nav>;
}
