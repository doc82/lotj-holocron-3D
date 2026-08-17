import type { ShipCardSection, ShipTelemetryCard } from "../types/telemetry";

const INFO_CARD_SCHEMA: Array<{ title: string; labels: string[] }> = [
  { title: "OVERVIEW", labels: ["Quota", "Value", "Owner", "Pilot", "Copilot", "Crew"] },
  {
    title: "WEAPONS",
    labels: [
      "Autoblasters",
      "Laser Cannons",
      "Turbolasers",
      "Ion Cannons",
      "Maximum Missiles",
      "Maximum Torpedoes",
      "Maximum Rockets",
      "Maximum Pulses",
      "Maximum Chaff",
      "Missile Tubes",
      "Tractor Beams",
      "Escape Pods",
    ],
  },
  { title: "ACCESS CODES", labels: ["Hatchway", "Hangar Bays", "Docking", "Self-destruct"] },
  {
    title: "SYSTEMS",
    labels: [
      "Maximum Hull",
      "Maximum Shields",
      "Maximum Energy (fuel)",
      "Maximum Speed",
      "Hyperspeed",
      "Maneuver",
      "Sensor Array",
      "Shield Boosters",
      "Communications",
      "Cloaking Device",
    ],
  },
];

export function validatedInfoSections(sections: ShipCardSection[] = []): ShipCardSection[] {
  return INFO_CARD_SCHEMA.flatMap((definition) => {
    const source = sections.find(
      (section) => section.title?.trim().toUpperCase() === definition.title,
    );
    if (!source) return [];
    const rows = new Map(
      source.rows.flatMap((row) => {
        const label = String(row.label || "").trim();
        const value = String(row.value || "")
          .replace(/\s+/g, " ")
          .trim();
        return definition.labels.includes(label) &&
          value !== "" &&
          value.length <= 100 &&
          !/[{}\r\n]/.test(value)
          ? [[label, { label, value }] as const]
          : [];
      }),
    );
    const orderedRows = definition.labels.flatMap((label) => {
      const row = rows.get(label);
      return row ? [row] : [];
    });
    return orderedRows.length > 0 ? [{ title: definition.title, rows: orderedRows }] : [];
  });
}

export function sanitizedStatusSections(sections: ShipCardSection[] = []): ShipCardSection[] {
  return sections.flatMap((section) => {
    const rows = section.rows.flatMap((row) => {
      const label = String(row.label || "")
        .replace(/\s+/g, " ")
        .trim();
      const value = String(row.value || "")
        .replace(/\s+/g, " ")
        .trim();
      if (
        !label ||
        !value ||
        label.length > 80 ||
        value.length > 300 ||
        /[{}\r\n]/.test(label) ||
        /[{}\r\n]/.test(value)
      )
        return [];

      // Older snapshots may contain the period-delimited turret summary as one
      // row. Split it here as well so cached telemetry heals without a rescan.
      if (label.toLowerCase() === "total turrets") {
        const turretSummary = value.match(/^(.+?)\.\s+Damaged Turrets:\s*(.+)$/i);
        if (turretSummary)
          return [
            { label: "Total Turrets", value: turretSummary[1].trim() },
            { label: "Damaged Turrets", value: turretSummary[2].trim() },
          ];
      }
      return [{ label, value }];
    });
    const title = String(section.title || "")
      .replace(/\s+/g, " ")
      .trim();
    return title && rows.length > 0 ? [{ title, rows }] : [];
  });
}

export function normalizeShipDescription(description: ShipTelemetryCard["description"]): string {
  return (Array.isArray(description) ? description.filter(Boolean).join(" ") : description || "")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
