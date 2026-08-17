import { formatCoordinate } from "../../domain/scene";
import type {
  FleetMember,
  FleetOrderStatus,
  FleetStatus,
  SpeedReading,
} from "../../types/telemetry";
import type { ShipDossierMode } from "../telemetry/ShipDossierPanel";
import { fleetMemberSelectionKey } from "../../domain/fleet";
import styles from "./FleetRoster.module.css";

function RosterActionIcon({ type }: { type: "view" | "status" | "info" }) {
  if (type === "view")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 8h4l2-2h4l2 2h4v10H4Z" />
        <circle cx="12" cy="13" r="3.5" />
        <path d="M12 2v3M2 12h3M19 12h3" />
      </svg>
    );
  if (type === "status")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 19A15 15 0 0 1 19 4M8 19A11 11 0 0 1 19 8M12 19a7 7 0 0 1 7-7" />
        <circle cx="18" cy="18" r="2" />
        <path d="m12 12 6 6" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v7M12 7v1" />
    </svg>
  );
}

function readingPercent(reading?: SpeedReading): number | null {
  if (
    !Number.isFinite(reading?.current) ||
    !Number.isFinite(reading?.maximum) ||
    Number(reading?.maximum) <= 0
  )
    return null;
  return Math.max(0, Math.min(100, (Number(reading?.current) / Number(reading?.maximum)) * 100));
}

function percent(member: FleetMember, field: "hull" | "shields" | "energy"): number | null {
  return readingPercent(member[field]);
}

export function FleetMeter({
  label,
  reading,
  tone,
}: {
  label: string;
  reading?: SpeedReading;
  tone: "hull" | "shield" | "energy";
}) {
  const value = readingPercent(reading);
  const tooltip =
    value === null
      ? `${label.toUpperCase()} // CURRENT UNKNOWN // MAX UNKNOWN`
      : `${label.toUpperCase()} // CURRENT ${formatCoordinate(reading?.current)} // MAX ${formatCoordinate(reading?.maximum)}`;
  return (
    <span className={styles.meter} data-tone={tone} title={tooltip} aria-label={tooltip}>
      <span>{label.slice(0, 1)}</span>
      <i>
        <b className={styles[tone]} style={{ width: `${value ?? 0}%` }} />
      </i>
    </span>
  );
}

function roleLabel(member: FleetMember): string {
  if (member.leader || member.role === "leader") return "FLAGSHIP";
  if (member.role === "lead") return "LEAD";
  if (member.slot !== undefined) return `SLOT ${String(member.slot).padStart(3, "0")}`;
  return "WING";
}

function isDisabled(member: FleetMember): boolean {
  return (
    String(member.condition || "")
      .trim()
      .toLowerCase() === "disabled"
  );
}

export type FleetScope = "local" | "all" | "wings" | "selected";

export function FleetRoster({
  fleet,
  fleetOrder,
  localName,
  scope,
  selectedMemberId,
  selectedMemberKeys,
  viewpointMemberId,
  onToggleMember,
  onViewMember,
  onOpenDossier,
}: {
  fleet?: FleetStatus;
  fleetOrder?: FleetOrderStatus;
  localName: string;
  scope: FleetScope;
  selectedMemberId?: string | null;
  selectedMemberKeys?: ReadonlySet<string>;
  viewpointMemberId?: string | null;
  onToggleMember?(member: FleetMember): void;
  onViewMember?(member: FleetMember): void;
  onOpenDossier(member: FleetMember, mode: ShipDossierMode): void;
}) {
  if (!fleet?.active || fleet.members.length === 0)
    return (
      <>
        <p className={styles.eyebrow}>YOUR SHIP // ROSTER</p>
        <div className={styles.status}>
          <span className={styles.light} />
          <strong>NOT ASSIGNED</strong>
        </div>
        <article className={`${styles.member} ${styles.activeMember}`}>
          <span className={styles.memberTop}>
            <em>LOCAL ELEMENT</em>
            <span className={styles.cardActions}>
              <button
                type="button"
                aria-label={`Show status card for ${localName}`}
                title="Ship Status"
                onClick={() => onOpenDossier({ id: "player-ship", name: localName }, "status")}
              >
                <RosterActionIcon type="status" />
              </button>
              <button
                type="button"
                aria-label={`Show info card for ${localName}`}
                title="Ship information"
                onClick={() => onOpenDossier({ id: "player-ship", name: localName }, "info")}
              >
                <RosterActionIcon type="info" />
              </button>
            </span>
          </span>
          <strong>{localName}</strong>
        </article>
      </>
    );

  const localMember = fleet.members.find(
    (member) => member.name.trim().toLowerCase() === localName.trim().toLowerCase(),
  );
  const visibleMembers =
    scope === "local"
      ? localMember
        ? [localMember]
        : []
      : scope === "wings"
        ? fleet.members.filter((member) => !member.leader)
        : fleet.members;
  const selectedMembers = selectedMemberKeys
    ? fleet.members.filter((member) => selectedMemberKeys.has(fleetMemberSelectionKey(member)))
    : selectedMemberId
      ? fleet.members.filter((member) => member.id === selectedMemberId)
      : visibleMembers;
  const summarizedMembers = scope === "local" ? visibleMembers : selectedMembers;
  const weakestHull = summarizedMembers.reduce<number | null>((lowest, member) => {
    const value = percent(member, "hull");
    return value === null ? lowest : lowest === null ? value : Math.min(lowest, value);
  }, null);
  const weakestShield = summarizedMembers.reduce<number | null>((lowest, member) => {
    const value = percent(member, "shields");
    return value === null ? lowest : lowest === null ? value : Math.min(lowest, value);
  }, null);
  const title =
    scope === "local"
      ? "YOUR SHIP"
      : fleet.kind === "squadron"
        ? "SQUADRON"
        : scope === "wings"
          ? "BATTLEGROUP // WINGS"
          : "BATTLEGROUP // FLEET";

  return (
    <>
      <p className={styles.eyebrow}>FORMATION // {title}</p>
      <div className={styles.status}>
        <span className={`${styles.light} ${styles.active}`} />
        <strong>{summarizedMembers.length} SELECTED</strong>
        {weakestShield !== null && <small>LOW S {Math.round(weakestShield)}%</small>}
        {weakestHull !== null && <small>H {Math.round(weakestHull)}%</small>}
      </div>
      {fleet.kind === "squadron" && (
        <div className={styles.controls}>
          ASSIST {fleet.assist === undefined ? "UNKNOWN" : fleet.assist ? "ACTIVE" : "OFF"}
          {" // "}AIM {(fleet.aimSystem || "NONE").toUpperCase()}
        </div>
      )}
      <div className={styles.list}>
        {visibleMembers.map((member) => {
          const disabled = isDisabled(member);
          const location = member.system || member.location || "Location unknown";
          const orderResult = fleetOrder?.results?.[member.name];
          const autopilotOrder =
            fleet.kind === "battlegroup" && fleetOrder?.order === "autopilot"
              ? orderResult
              : undefined;
          const autopilot =
            fleet.kind === "battlegroup"
              ? (autopilotOrder?.autopilot ?? member.autopilot)
              : undefined;
          const autopilotLabel =
            autopilotOrder?.status === "awaiting"
              ? "AWAITING"
              : `${autopilot === undefined ? "UNKNOWN" : autopilot ? "ON" : "OFF"}` +
                (autopilotOrder?.status === "rejected" ? " // REJECTED" : "");
          const selectedForCommand =
            selectedMemberKeys?.has(fleetMemberSelectionKey(member)) ??
            member.id === selectedMemberId;
          const selectable = Boolean(
            fleet.kind === "battlegroup" && scope !== "local" && onToggleMember,
          );
          const toggle = () => {
            if (selectable) onToggleMember?.(member);
          };
          return (
            <article
              key={fleetMemberSelectionKey(member)}
              className={`${styles.member} ${selectedForCommand ? styles.activeMember : ""}`}
              aria-label={member.name}
              aria-checked={selectable ? selectedForCommand : undefined}
              role={selectable ? "checkbox" : undefined}
              tabIndex={selectable ? 0 : undefined}
              onClick={selectable ? toggle : undefined}
              onKeyDown={
                selectable
                  ? (event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      toggle();
                    }
                  : undefined
              }
              data-viewing={member.id === viewpointMemberId}
              data-selectable={Boolean(selectable)}
              data-disabled={disabled}
            >
              <span className={styles.memberTop}>
                <em>
                  {roleLabel(member)}
                  {member.position ? ` // ${member.position.toUpperCase()}` : ""}
                </em>
                <span className={styles.memberTools}>
                  {member.crew !== undefined && <em>CREW {member.crew}</em>}
                  <span className={styles.cardActions}>
                    {fleet.kind === "battlegroup" && onViewMember && (
                      <button
                        type="button"
                        aria-label={`Lock tactical camera to ${member.name}`}
                        title="Camera lock"
                        onClick={(event) => {
                          event.stopPropagation();
                          onViewMember(member);
                        }}
                      >
                        <RosterActionIcon type="view" />
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Show status card for ${member.name}`}
                      title="Ship Status"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenDossier(member, "status");
                      }}
                    >
                      <RosterActionIcon type="status" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Show info card for ${member.name}`}
                      title="Ship information"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenDossier(member, "info");
                      }}
                    >
                      <RosterActionIcon type="info" />
                    </button>
                  </span>
                </span>
              </span>
              <strong>{member.name}</strong>
              <small>
                {member.shipCategory || member.class || "UNKNOWN CLASS"} // {location}
              </small>
              {disabled && (
                <small className={styles.disabledState}>DISABLED // SYSTEMS FAILURE</small>
              )}
              {(autopilot !== undefined || autopilotOrder) && (
                <small
                  className={styles.autopilotState}
                  data-enabled={autopilot}
                  data-status={autopilotOrder?.status}
                  title={autopilotOrder?.reason}
                >
                  AUTOPILOT // {autopilotLabel}
                </small>
              )}
              {orderResult && fleetOrder?.order !== "autopilot" && (
                <small
                  className={styles.orderResult}
                  data-status={orderResult.status}
                  title={orderResult.reason}
                >
                  {(fleetOrder?.order || "ORDER").toUpperCase()} //{" "}
                  {orderResult.status.toUpperCase()}
                  {orderResult.reason ? ` // ${orderResult.reason}` : ""}
                </small>
              )}
              <span className={styles.meters}>
                <FleetMeter label="Hull" reading={member.hull} tone="hull" />
                <FleetMeter label="Shield" reading={member.shields} tone="shield" />
                <FleetMeter label="Energy" reading={member.energy} tone="energy" />
              </span>
            </article>
          );
        })}
      </div>
    </>
  );
}
