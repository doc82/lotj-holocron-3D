import type { FleetMember, FleetOrderStatus, FleetStatus } from "../../types/telemetry";
import type { ShipDossierMode } from "../telemetry/ShipDossierPanel";
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

function isDisabled(member: FleetMember): boolean {
  return String(member.condition || "").trim().toLowerCase() === "disabled";
}

export type FleetScope = "local" | "all" | "wings" | "selected";

export function FleetRoster({ fleet, fleetOrder, localName, scope, onOpenDossier }: {
  fleet?: FleetStatus;
  fleetOrder?: FleetOrderStatus;
  localName: string;
  scope: FleetScope;
  onOpenDossier(member: FleetMember, mode: ShipDossierMode): void;
}) {
  if (!fleet?.active || fleet.members.length === 0) return <>
    <p className={styles.eyebrow}>YOUR SHIP // ROSTER</p>
    <div className={styles.status}><span className={styles.light} /><strong>NOT ASSIGNED</strong></div>
    <article className={`${styles.member} ${styles.activeMember}`}>
      <span className={styles.memberTop}><em>LOCAL ELEMENT</em><span className={styles.cardActions}>
        <button type="button" aria-label={`Show status card for ${localName}`}
          onClick={() => onOpenDossier({ id: "player-ship", name: localName }, "status")}>S</button>
        <button type="button" aria-label={`Show info card for ${localName}`}
          onClick={() => onOpenDossier({ id: "player-ship", name: localName }, "info")}>I</button>
      </span></span>
      <strong>{localName}</strong>
    </article>
  </>;

  const localMember = fleet.members.find((member) => member.name.trim().toLowerCase() === localName.trim().toLowerCase());
  const visibleMembers = scope === "local" ? localMember ? [localMember] : []
    : scope === "wings" ? fleet.members.filter((member) => !member.leader)
      : scope === "selected" ? fleet.members.filter((member) => member.id === localMember?.id)
        : fleet.members;
  const weakestHull = visibleMembers.reduce<number | null>((lowest, member) => {
    const value = percent(member, "hull");
    return value === null ? lowest : lowest === null ? value : Math.min(lowest, value);
  }, null);
  const weakestShield = visibleMembers.reduce<number | null>((lowest, member) => {
    const value = percent(member, "shields");
    return value === null ? lowest : lowest === null ? value : Math.min(lowest, value);
  }, null);
  const title = scope === "local" ? "YOUR SHIP"
    : fleet.kind === "squadron" ? "SQUADRON"
      : scope === "wings" ? "BATTLEGROUP // WINGS" : "BATTLEGROUP // FLEET";

  return <>
    <p className={styles.eyebrow}>FORMATION // {title}</p>
    <div className={styles.status}>
      <span className={`${styles.light} ${styles.active}`} />
      <strong>{visibleMembers.length} CRAFT</strong>
      {weakestShield !== null && <small>LOW S {Math.round(weakestShield)}%</small>}
      {weakestHull !== null && <small>H {Math.round(weakestHull)}%</small>}
    </div>
    {fleet.kind === "squadron" && <div className={styles.controls}>
      ASSIST {fleet.assist === undefined ? "UNKNOWN" : fleet.assist ? "ACTIVE" : "OFF"}
      {" // "}AIM {(fleet.aimSystem || "NONE").toUpperCase()}
    </div>}
    <div className={styles.list}>
      {visibleMembers.map((member) => {
        const disabled = isDisabled(member);
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
        return <article key={member.id} className={styles.member} aria-label={member.name}
          data-disabled={disabled}>
          <span className={styles.memberTop}>
            <em>{roleLabel(member)}{member.position ? ` // ${member.position.toUpperCase()}` : ""}</em>
            <span className={styles.memberTools}>
              {member.crew !== undefined && <em>CREW {member.crew}</em>}
              <span className={styles.cardActions}>
                <button type="button" aria-label={`Show status card for ${member.name}`}
                  onClick={() => onOpenDossier(member, "status")}>S</button>
                <button type="button" aria-label={`Show info card for ${member.name}`}
                  onClick={() => onOpenDossier(member, "info")}>I</button>
              </span>
            </span>
          </span>
          <strong>{member.name}</strong>
          <small>{member.shipCategory || member.class || "UNKNOWN CLASS"} // {location}</small>
          {disabled && <small className={styles.disabledState}>DISABLED // SYSTEMS FAILURE</small>}
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
        </article>;
      })}
    </div>
  </>;
}
