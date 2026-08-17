import { formatCoordinate, type ScenePoint } from "../domain/scene";
import { detailRows, isDisabledShip } from "../domain/tacticalWorkspace";
import type { FleetMember, FleetOrderStatus, FleetStatus, SpeedReading } from "../types/telemetry";
import { FleetRoster, type FleetScope } from "../features/fleet/FleetRoster";
import type { ShipDossierMode } from "../features/telemetry/ShipDossierPanel";
import { RangeMeter, type RangeReading } from "../features/telemetry/RangeMeter";
import styles from "./App.module.css";
import { HyperspaceIcon } from "./TacticalIcons";

export function FleetScopeDrawer({
  label,
  fleet,
  fleetOrder,
  localName,
  scope,
  selectedMemberKeys,
  viewpointMemberId,
  allMembersSelected,
  onSelectAll,
  onClose,
  onToggleMember,
  onViewMember,
  onOpenDossier,
}: {
  label: string;
  fleet?: FleetStatus;
  fleetOrder?: FleetOrderStatus;
  localName: string;
  scope: FleetScope;
  selectedMemberKeys: Set<string>;
  viewpointMemberId: string | null;
  allMembersSelected: boolean;
  onSelectAll(): void;
  onClose(): void;
  onToggleMember(member: FleetMember): void;
  onViewMember(member: FleetMember): void;
  onOpenDossier(member: FleetMember, mode: ShipDossierMode): void;
}) {
  return (
    <aside
      className={`${styles.scopeDrawer} ${styles.panel}`}
      aria-label="Active command recipient roster"
    >
      <header>
        <div>
          <p className={styles.eyebrow}>COMMAND RECIPIENT</p>
          <h2>{label.toUpperCase()}</h2>
        </div>
        <div className={styles.scopeDrawerHeaderActions}>
          {fleet?.kind === "battlegroup" && scope !== "local" && !allMembersSelected && (
            <button
              type="button"
              className={styles.selectAllScope}
              aria-label="Select all fleet craft"
              title="Select all craft"
              onClick={onSelectAll}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="3" width="13" height="13" rx="1" />
                <path d="m7 9 3 3 8-8M8 20h12V8" />
              </svg>
            </button>
          )}
          <button
            type="button"
            className={styles.closeScopeDrawer}
            aria-label="Close command recipient roster"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>
      <FleetRoster
        fleet={fleet}
        fleetOrder={fleetOrder}
        localName={localName}
        scope={scope}
        selectedMemberKeys={selectedMemberKeys}
        viewpointMemberId={viewpointMemberId}
        onToggleMember={onToggleMember}
        onViewMember={onViewMember}
        onOpenDossier={onOpenDossier}
      />
    </aside>
  );
}

export function SelectedTargetPanel({
  selection,
  selectedShip,
  onOpenDossier,
}: {
  selection: ScenePoint | null;
  selectedShip: ScenePoint | null;
  onOpenDossier(target: ScenePoint, mode: ShipDossierMode): void;
}) {
  return (
    <section
      className={styles.selectedVessel}
      aria-label="Selected target telemetry"
      data-disabled={Boolean(selection && isDisabledShip(selection))}
    >
      {selection ? (
        <>
          <p className={styles.eyebrow}>SELECTED TARGET</p>
          <div className={styles.vesselHeading}>
            <div>
              <h2>{selection.name}</h2>
              <p className={styles.muted}>
                {selection.class || selection.kind || "Unknown contact"}
              </p>
            </div>
            <div className={styles.vesselTags}>
              {isDisabledShip(selection) && <span className={styles.disabledTag}>DISABLED</span>}
              <span>{selection.shipCategory?.toUpperCase() || "UNCLASSIFIED"}</span>
              {selectedShip && (
                <span className={styles.dossierLaunchers}>
                  <button
                    type="button"
                    aria-label={`Show status card for ${selectedShip.name}`}
                    onClick={() => onOpenDossier(selectedShip, "status")}
                  >
                    S
                  </button>
                  <button
                    type="button"
                    aria-label={`Show info card for ${selectedShip.name}`}
                    onClick={() => onOpenDossier(selectedShip, "info")}
                  >
                    I
                  </button>
                </span>
              )}
            </div>
          </div>
          <div className={styles.vesselRanges}>
            <RangeMeter label="HULL" reading={selection.hull as RangeReading | undefined} />
            <RangeMeter
              label="SHIELD"
              reading={selection.shields as RangeReading | undefined}
              tone="shield"
            />
            <RangeMeter
              label="SPEED"
              reading={
                typeof selection.speed === "object" ? (selection.speed as RangeReading) : undefined
              }
              tone="speed"
            />
            <RangeMeter
              label="ENERGY"
              reading={selection.energy as RangeReading | undefined}
              tone="energy"
            />
          </div>
          <dl className={`${styles.readouts} ${styles.compactReadouts}`}>
            {detailRows(selection)
              .slice(0, 8)
              .map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
        </>
      ) : (
        <div className={styles.emptyTarget}>
          <span aria-hidden="true">◇</span>
          <strong>NO TARGET SELECTED</strong>
          <small>SELECT A CONTACT, CELESTIAL BODY, OR NAVIGATION OBJECT</small>
        </div>
      )}
    </section>
  );
}

export function CommandIssuerPanel({
  label,
  type,
  fleetScope,
  fleet,
  members,
  hull,
  shields,
  energy,
  localAutopilot,
  landed,
  routeActive,
  selectedScopeEmpty,
  onOpenHyperspace,
}: {
  label: string;
  type: string;
  fleetScope: FleetScope;
  fleet?: FleetStatus;
  members: FleetMember[];
  hull?: SpeedReading;
  shields?: SpeedReading;
  energy?: SpeedReading;
  localAutopilot?: boolean;
  landed: boolean;
  routeActive: boolean;
  selectedScopeEmpty: boolean;
  onOpenHyperspace(mode: "local" | "galactic"): void;
}) {
  return (
    <section className={styles.issuerBank} aria-label="Active command recipient">
      <p className={styles.eyebrow}>ISSUING TO</p>
      <div className={styles.issuerHeading}>
        <div>
          <h2>{label}</h2>
          <p>{type}</p>
        </div>
        <span>
          {fleetScope === "local" || !fleet?.active ? "LOCAL" : `${members.length} CRAFT`}
        </span>
      </div>
      <div className={styles.issuerRanges}>
        <RangeMeter label="HULL" reading={hull} />
        <RangeMeter label="SHIELD" reading={shields} tone="shield" />
        <RangeMeter label="ENERGY" reading={energy} tone="energy" />
      </div>
      <div className={styles.issuerStatus}>
        <span>STATUS // ACTIVE</span>
        <span>
          AUTOPILOT //{" "}
          {fleetScope === "local"
            ? localAutopilot === undefined
              ? "UNKNOWN"
              : localAutopilot
                ? "ON"
                : "OFF"
            : members.some((member) => member.autopilot)
              ? "PARTIAL / ON"
              : "OFF"}
        </span>
      </div>
      <div className={styles.hyperspaceActions}>
        <p>HYPERSPACE</p>
        <div>
          <button
            type="button"
            disabled={landed || routeActive || selectedScopeEmpty}
            onClick={() => onOpenHyperspace("local")}
          >
            <HyperspaceIcon />
            <span>LOCAL JUMP</span>
          </button>
          <button
            type="button"
            disabled={landed || routeActive || selectedScopeEmpty}
            onClick={() => onOpenHyperspace("galactic")}
          >
            <HyperspaceIcon galactic />
            <span>PLOT HYPERSPACE</span>
          </button>
        </div>
        <small>ROUTE APPLIES TO // {label.toUpperCase()}</small>
      </div>
    </section>
  );
}

export function ContactClusterPanel({
  cluster,
  selectedId,
  onHover,
  onSelect,
  onClose,
}: {
  cluster: ScenePoint;
  selectedId: string | null;
  onHover(id: string | null): void;
  onSelect(id: string): void;
  onClose(): void;
}) {
  if (!cluster.members) return null;
  return (
    <section className={`${styles.clusterPanel} ${styles.panel}`} aria-label="Grouped contacts">
      <header>
        <div>
          <p className={styles.eyebrow}>COLOCATED CONTACTS</p>
          <h2>
            {cluster.memberCount} CONTACTS AT{" "}
            {cluster.worldPosition.map(formatCoordinate).join(" / ")}
          </h2>
        </div>
        <button
          type="button"
          className={`${styles.closeCluster} ${styles.iconButton}`}
          aria-label="Close grouped contacts"
          data-tooltip="CLOSE CONTACT GROUP"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className={styles.memberGrid}>
        {cluster.members.map((member) => (
          <button
            key={member.id}
            type="button"
            className={selectedId === member.id ? styles.selectedMember : undefined}
            onMouseEnter={() => onHover(member.id)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(member.id)}
            onBlur={() => onHover(null)}
            onClick={() => onSelect(member.id)}
          >
            <strong>{member.name}</strong>
            <span>
              {member.class || (member.kind === "ship" ? "Unknown ship class" : member.kind)}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
