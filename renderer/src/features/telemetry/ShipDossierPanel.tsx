import type {
  ShipCardSection,
  ShipTelemetryCard,
  SpeedReading,
  TelemetryEntity,
} from "../../types/telemetry";
import { normalizeShipDescription, validatedInfoSections } from "../../domain/shipDossier";
import styles from "./ShipDossierPanel.module.css";

export type ShipDossierMode = "status" | "info";

function reading(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (!value || typeof value !== "object") return null;
  const amount = value as SpeedReading;
  if (!Number.isFinite(amount.current) && !Number.isFinite(amount.maximum)) return null;
  return `${Number.isFinite(amount.current) ? amount.current : "?"}/${Number.isFinite(amount.maximum) ? amount.maximum : "?"}`;
}

function vector(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const coordinates = value as { x?: number; y?: number; z?: number };
  if (![coordinates.x, coordinates.y, coordinates.z].some(Number.isFinite)) return null;
  return [coordinates.x, coordinates.y, coordinates.z]
    .map((coordinate) => Number.isFinite(coordinate) ? coordinate : "?").join("  ");
}

function fallbackSections(ship: TelemetryEntity, mode: ShipDossierMode): ShipCardSection[] {
  if (mode === "status") {
    const flight = [
      { label: "Current Coordinates", value: vector(ship.coordinates)
        || ([ship.x, ship.y, ship.z].some(Number.isFinite)
          ? [ship.x, ship.y, ship.z].map((value) => Number.isFinite(value) ? value : "?").join("  ")
          : "UNKNOWN") },
      { label: "Current Heading", value: vector(ship.heading) || "UNKNOWN" },
      { label: "Current Speed", value: reading(ship.speed) || "UNKNOWN" },
    ];
    const systems = ["hull", "shields", "energy"].map((key) => ({
      label: key === "energy" ? "Energy (fuel)" : key[0].toUpperCase() + key.slice(1),
      value: reading(ship[key]) || "UNKNOWN",
    }));
    return [{ title: "FLIGHT", rows: flight }, { title: "SYSTEMS", rows: systems }];
  }

  const overview = [
    { label: "Class", value: String(ship.shipCategory || ship.class || "UNKNOWN") },
    { label: "Maximum Speed", value: String(ship.maximumSpeed ?? "UNKNOWN") },
    { label: "Sensor Array", value: String(ship.sensorArray ?? "UNKNOWN") },
  ];
  const weaponRows = Object.entries(
    ship.weapons && typeof ship.weapons === "object" ? ship.weapons as Record<string, unknown> : {},
  ).map(([label, value]) => ({
    label: label.replace(/([a-z])([A-Z])/g, "$1 $2"),
    value: String(value),
  }));
  return [
    { title: "OVERVIEW", rows: overview },
    ...(weaponRows.length > 0 ? [{ title: "WEAPONS", rows: weaponRows }] : []),
  ];
}

function cardFor(ship: TelemetryEntity, mode: ShipDossierMode): ShipTelemetryCard | undefined {
  const card = mode === "status" ? ship.statusCard : ship.infoCard;
  return card && typeof card === "object" ? card : undefined;
}

export function ShipDossierPanel({ ship, mode, loading, message, onModeChange, onRefresh, onClose }: {
  ship: TelemetryEntity;
  mode: ShipDossierMode;
  loading: boolean;
  message?: string;
  onModeChange(mode: ShipDossierMode): void;
  onRefresh(): void;
  onClose(): void;
}) {
  const card = cardFor(ship, mode);
  const cardSections = mode === "info"
    ? validatedInfoSections(card?.sections)
    : card?.sections?.filter((section) => section.rows?.length) ?? [];
  const sections = cardSections.length > 0 ? cardSections : fallbackSections(ship, mode);
  const description = normalizeShipDescription(card?.description);
  const notices = card?.notices?.filter(Boolean) ?? [];

  return <aside className={styles.dossier} aria-label={`${mode} card for ${ship.name || "ship"}`}>
    <header className={styles.header}>
      <div>
        <p>SHIP DOSSIER // {mode.toUpperCase()}</p>
        <h2>{ship.name || "UNKNOWN SHIP"}</h2>
        <small>{ship.class || ship.shipCategory || "UNCLASSIFIED CRAFT"}</small>
      </div>
      <button type="button" className={styles.close} aria-label="Close ship dossier" onClick={onClose}>×</button>
    </header>

    <nav className={styles.tabs} aria-label="Ship dossier view">
      <button type="button" aria-pressed={mode === "status"} onClick={() => onModeChange("status")}>
        <b>S</b><span>STATUS</span>
      </button>
      <button type="button" aria-pressed={mode === "info"} onClick={() => onModeChange("info")}>
        <b>I</b><span>INFO</span>
      </button>
      <button type="button" className={styles.refresh} disabled={loading} onClick={onRefresh}>
        {loading ? "RECEIVING…" : "REFRESH"}
      </button>
    </nav>

    <div className={styles.body}>
      {!card && <div className={styles.pending} data-loading={loading}>
        {loading ? "REQUESTING LIVE TELEMETRY…" : "NO LIVE CARD CACHED // SELECT REFRESH"}
      </div>}
      {description && <div className={styles.description}>
        <p>{description}</p>
      </div>}
      {notices.map((notice) => <p key={notice} className={styles.notice}>{notice}</p>)}
      {sections.map((section) => <section key={section.title} className={styles.section}>
        <h3>{section.title}</h3>
        <dl>
          {section.rows.map((row, index) => <div key={`${row.label}:${index}`}>
            <dt>{row.label || "—"}</dt><dd>{row.value || "—"}</dd>
          </div>)}
        </dl>
      </section>)}
    </div>

    {message && <footer data-loading={loading}>{message}</footer>}
  </aside>;
}
