import { createShipMesh } from "./mesh-primitives.mjs";

// Original, deterministic Holocron mesh. +Y is up, +Z is the bow.
// First-pass interpretation, not a traced or converted third-party model.
export function createYt1000() {
  const { parts, part, lathe, prism, box } = createShipMesh();
  const hull = [0.57, 0.6, 0.62];
  const armor = [0.72, 0.73, 0.69];
  const machinery = [0.24, 0.28, 0.3];
  const glass = [0.08, 0.25, 0.32];
  lathe(
    "Saucer pressure hull",
    hull,
    [
      [0.38, -0.16],
      [0.69, -0.1],
      [0.82, -0.045],
      [0.82, 0.045],
      [0.69, 0.12],
      [0.37, 0.19],
    ],
    [0, 0, -0.08],
  );
  lathe(
    "Equatorial armor band",
    machinery,
    [
      [0.823, -0.029],
      [0.823, 0.029],
    ],
    [0, 0, -0.08],
  );
  lathe(
    "Dorsal access hub",
    armor,
    [
      [0.24, 0.18],
      [0.22, 0.225],
    ],
    [0, 0, -0.08],
    "y",
    32,
  );
  lathe(
    "Ventral access hub",
    machinery,
    [
      [0.21, -0.19],
      [0.24, -0.155],
    ],
    [0, 0, -0.08],
    "y",
    32,
  );

  for (const side of [-1, 1]) {
    // Short forward cargo shoulders; the cockpit stays above the central gap.
    const outline = [
      [0.18, 0.48],
      [0.49, 0.39],
      [0.43, 0.88],
      [0.2, 0.98],
    ].map(([x, z]) => [x * side, z]);
    if (side < 0) outline.reverse();
    prism(`${side} cargo mandible`, armor, outline, -0.07, 0.09, 0.88);
    box(`${side} mandible inset`, machinery, side * 0.3, 0.095, 0.74, 0.09, 0.015, 0.26);
    // Distinct two-engine configuration, with inset exhaust and outer rim.
    lathe(
      `${side} engine housing`,
      hull,
      [
        [0.13, -1.01],
        [0.17, -0.92],
        [0.17, -0.64],
        [0.12, -0.5],
      ],
      [side * 0.39, 0.015, 0],
      "z",
      32,
    );
    lathe(
      `${side} exhaust rim`,
      machinery,
      [
        [0.14, -1.035],
        [0.16, -1.015],
        [0.16, -0.955],
      ],
      [side * 0.39, 0.015, 0],
      "z",
      32,
    );
    lathe(
      `${side} exhaust aperture`,
      [0.2, 0.53, 0.64],
      [
        [0.111, -1.037],
        [0.111, -1.036],
      ],
      [side * 0.39, 0.015, 0],
      "z",
      32,
    );
    for (let i = 0; i < 5; i++)
      box(
        `${side} cooling louvre ${i}`,
        machinery,
        side * 0.39,
        0.185,
        -0.83 + i * 0.041,
        0.21,
        0.018,
        0.018,
      );
    box(`${side} docking collar`, hull, side * 0.8, 0, -0.05, 0.15, 0.11, 0.21);
    box(`${side} docking hatch`, machinery, side * 0.884, 0, -0.05, 0.02, 0.08, 0.14);
  }
  // Centerline raised corridor and faceted forward cockpit canopy.
  box("Raised cockpit corridor", hull, 0, 0.21, 0.3, 0.22, 0.14, 0.7);
  lathe(
    "Cockpit shell",
    armor,
    [
      [0.14, 0.45],
      [0.145, 0.65],
      [0.1, 0.85],
    ],
    [0, 0.26, 0],
    "z",
    12,
  );
  lathe(
    "Cockpit glazing",
    glass,
    [
      [0.144, 0.665],
      [0.101, 0.862],
    ],
    [0, 0.26, 0],
    "z",
    12,
  );
  lathe(
    "Canopy front frame",
    hull,
    [
      [0.098, 0.852],
      [0.098, 0.873],
    ],
    [0, 0.26, 0],
    "z",
    12,
  );
  box("Canopy central frame", hull, 0, 0.375, 0.745, 0.018, 0.018, 0.19);
  lathe(
    "Forward viewport",
    glass,
    [
      [0.082, 0.874],
      [0.082, 0.875],
    ],
    [0, 0.26, 0],
    "z",
    12,
  );
  // Separated radial plates create real relief even in geometry-only rendering.
  for (let i = 0; i < 24; i++) {
    const angle = (i * Math.PI * 2) / 24;
    if (Math.sin(angle) > 0.7 || Math.sin(angle) < -0.8) continue;
    const a = angle + 0.026;
    const b = angle + (Math.PI * 2) / 24 - 0.026;
    part(`Radial hull plate ${i}`, i % 4 === 0 ? hull : armor, (_tri, quad) => {
      const p = (r, h, t) => [r * Math.cos(t), h, r * Math.sin(t) - 0.08];
      quad(p(0.39, 0.193, a), p(0.39, 0.193, b), p(0.7, 0.123, b), p(0.7, 0.123, a));
    });
  }
  lathe(
    "Sensor pedestal",
    machinery,
    [
      [0.045, 0.15],
      [0.035, 0.26],
    ],
    [-0.32, 0, -0.26],
    "y",
    16,
  );
  lathe(
    "Sensor radome",
    armor,
    [
      [0.09, 0.26],
      [0.075, 0.28],
      [0.03, 0.31],
    ],
    [-0.32, 0, -0.26],
    "y",
    24,
  );
  // No installed weapons inferred: individual ships carry different loadouts.
  return parts;
}
