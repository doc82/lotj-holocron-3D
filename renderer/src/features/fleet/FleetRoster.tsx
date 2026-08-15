import type { FleetMember, FleetOrderStatus, FleetStatus } from "../../types/telemetry";
import { canCommandFormation } from "../../domain/fleet";
import styles from "./FleetRoster.module.css";

function percent(member: FleetMember, field: "hull" | "shields" | "energy"): number | null {
  const reading = member[field];
  if (!Number.isFinite(reading?.current) || !Number.isFinite(reading?.maximum)
      || Number(reading?.maximum) <= 0) return null;
  return Math.max(0, Math.min(100, Number(reading?.current) / Number(reading?.maximum) * 100));
}

function FleetMeter({ label, value, tone }: {
  label: string;
  value: number | null;
  tone: "hull" | "shield" | "energy";
}) {
  const tooltip = `${label} // ${value === null ? "UNKNOWN" : `${Math.round(value)}%`}`;
  return <div className={styles.meter} title={tooltip} aria-label={tooltip}>
    <span>{label.slice(0, 1)}</span>
    <i><b className={styles[tone]} style={{ width: `${value ?? 0}%` }} /></i>
  </div>;
}

function roleLabel(member: FleetMember): string {
  if (member.leader || member.role === "leader") return "FLAGSHIP";
  if (member.role === "lead") return "LEAD";
  if (member.slot !== undefined) return `SLOT ${String(member.slot).padStart(3, "0")}`;
  return "WING";
}

export type FleetScope = "local" | "all" | "wings" | "selected";

export function FleetRoster({ fleet, fleetOrder, localName, selectedId, scope, onScopeChange,
  onSelectMember, onSelectLocal }: {
  fleet?: FleetStatus;
  fleetOrder?: FleetOrderStatus;
  localName: string;
  selectedId: string;
  scope: FleetScope;
  onScopeChange(scope: FleetScope): void;
  onSelectMember(member: FleetMember): void;
  onSelectLocal(): void;
}) {
  if (!fleet?.active || fleet.members.length === 0) return <>
    <p className={styles.eyebrow}>FORMATION // ROSTER</p>
    <div className={styles.status}><span className={styles.light} /><strong>NOT ASSIGNED</strong></div>
    <button type="button" className={styles.member} aria-label={`Select ${localName}`}
      aria-pressed={selectedId === "player-ship"} onClick={onSelectLocal}>
      <span className={styles.memberTop}><em>LOCAL ELEMENT</em></span>
      <strong>{localName}</strong>
    </button>
  </>;

  const weakestHull = fleet.members.reduce<number | null>((lowest, member) => {
    const value = percent(member, "hull");
    return value === null ? lowest : lowest === null ? value : Math.min(lowest, value);
  }, null);
  const weakestShield = fleet.members.reduce<number | null>((lowest, member) => {
    const value = percent(member, "shields");
    return value === null ? lowest : lowest === null ? value : Math.min(lowest, value);
  }, null);
  const title = fleet.kind === "battlegroup" ? "BATTLEGROUP" : "SQUADRON";
  const formationCommandsEnabled = canCommandFormation(fleet, localName);

  return <>
    <p className={styles.eyebrow}>FORMATION // {title}</p>
    <div className={styles.status}>
      <span className={`${styles.light} ${styles.active}`} />
      <strong>{fleet.members.length} CRAFT</strong>
      {weakestShield !== null && <small>LOW S {Math.round(weakestShield)}%</small>}
      {weakestHull !== null && <small>H {Math.round(weakestHull)}%</small>}
    </div>
    {fleet.kind === "squadron" && <div className={styles.controls}>
      ASSIST {fleet.assist === undefined ? "UNKNOWN" : fleet.assist ? "ACTIVE" : "OFF"}
      {" // "}AIM {(fleet.aimSystem || "NONE").toUpperCase()}
    </div>}
    <div className={styles.scopes} aria-label="Formation command scope">
      {(fleet.kind === "squadron" ? ["local", "all"] as const : ["local", "all", "wings"] as const)
        .map((value) => <button key={value}
        type="button" disabled={value !== "local" && !formationCommandsEnabled}
        aria-pressed={scope === value} onClick={() => onScopeChange(value)}>
        {value === "local" ? "LOCAL" : value === "all"
          ? fleet.kind === "squadron" ? "SQUADRON" : "ALL FLEET" : "WINGS"}
      </button>)}
      {fleet.kind !== "squadron" && scope === "selected"
        && <button type="button" aria-pressed="true">SELECTED</button>}
    </div>
    <div className={styles.list}>
      {fleet.members.map((member) => {
        const location = member.system || member.location || "Location unknown";
        const orderResult = fleetOrder?.results?.[member.name];
        const autopilotOrder = fleet.kind === "battlegroup" && fleetOrder?.order === "autopilot"
          ? orderResult : undefined;
        const autopilot = fleet.kind === "battlegroup"
          ? autopilotOrder?.autopilot ?? member.autopilot
          : undefined;
        const autopilotLabel = autopilotOrder?.status === "awaiting" ? "AWAITING"
          : `${autopilot === undefined ? "UNKNOWN" : autopilot ? "ON" : "OFF"}`
            + (autopilotOrder?.status === "rejected" ? " // REJECTED" : "");
        return <button key={member.id} type="button" className={styles.member}
          aria-label={`Select ${member.name}`} aria-pressed={selectedId === member.id}
          onClick={() => onSelectMember(member)}>
          <span className={styles.memberTop}>
            <em>{roleLabel(member)}{member.position ? ` // ${member.position.toUpperCase()}` : ""}</em>
            {member.crew !== undefined && <em>CREW {member.crew}</em>}
          </span>
          <strong>{member.name}</strong>
          <small>{member.shipCategory || member.class || "UNKNOWN CLASS"} // {location}</small>
          {(autopilot !== undefined || autopilotOrder) && <small className={styles.autopilotState}
            data-enabled={autopilot} data-status={autopilotOrder?.status}
            title={autopilotOrder?.reason}>AUTOPILOT // {autopilotLabel}</small>}
          {orderResult && fleetOrder?.order !== "autopilot" && <small className={styles.orderResult}
            data-status={orderResult.status} title={orderResult.reason}>
            {(fleetOrder?.order || "ORDER").toUpperCase()} // {orderResult.status.toUpperCase()}
            {orderResult.reason ? ` // ${orderResult.reason}` : ""}
          </small>}
          <span className={styles.meters}>
            <FleetMeter label="Hull" value={percent(member, "hull")} tone="hull" />
            <FleetMeter label="Shield" value={percent(member, "shields")} tone="shield" />
            <FleetMeter label="Energy" value={percent(member, "energy")} tone="energy" />
          </span>
        </button>;
      })}
    </div>
  </>;
}
