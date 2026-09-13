import { createShipMesh } from "./mesh-primitives.mjs";

// Original Aurek interpretation. +Y up, +Z bow; wings in a fixed flight pose.
// Reference silhouette only: no third-party mesh or texture is incorporated.
export function createAurek() {
  const { parts, part, prism, lathe, box } = createShipMesh();
  const hull = [0.66, 0.68, 0.66];
  const armor = [0.79, 0.78, 0.71];
  const dark = [0.23, 0.26, 0.28];
  const red = [0.48, 0.13, 0.1];
  const glass = [0.08, 0.23, 0.29];

  // Elliptical sections: [z, half-width, half-height, vertical center].
  function loft(name, color, profile, segments = 12) {
    const ring = ([z, w, h, y], angle) => [w * Math.cos(angle), y - h * Math.sin(angle), z];
    part(name, color, (tri, quad) => {
      for (let i = 0; i < segments; i++) {
        const a = (i * Math.PI * 2) / segments;
        const b = ((i + 1) * Math.PI * 2) / segments;
        for (let j = 0; j < profile.length - 1; j++) {
          quad(
            ring(profile[j], a),
            ring(profile[j + 1], a),
            ring(profile[j + 1], b),
            ring(profile[j], b),
          );
        }
        const back = profile[0];
        const front = profile.at(-1);
        tri([0, back[3], back[0]], ring(back, a), ring(back, b));
        tri([0, front[3], front[0]], ring(front, b), ring(front, a));
      }
    });
  }
  function panel(name, color, outline, bottom, top, taper = 1) {
    // Preserve outward winding when mirroring a wing across the centerline.
    const area = outline.reduce((sum, p, i) => {
      const q = outline[(i + 1) % outline.length];
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0);
    prism(name, color, area < 0 ? [...outline].reverse() : outline, bottom, top, taper);
  }

  loft(
    "Spearhead fuselage",
    hull,
    [
      [-0.87, 0.13, 0.07, 0],
      [-0.73, 0.22, 0.1, 0],
      [-0.33, 0.22, 0.11, 0],
      [-0.05, 0.26, 0.09, 0],
      [0.38, 0.17, 0.065, -0.015],
      [0.91, 0.05, 0.028, -0.025],
      [1.06, 0.016, 0.015, -0.025],
    ],
    16,
  );
  loft(
    "Ventral keel",
    dark,
    [
      [-0.69, 0.105, 0.04, -0.09],
      [-0.03, 0.11, 0.035, -0.075],
      [0.8, 0.025, 0.012, -0.045],
    ],
    8,
  );
  // Cockpit sits behind the long nose, rather than at its tip.
  loft(
    "Cockpit surround",
    dark,
    [
      [-0.72, 0.125, 0.045, 0.075],
      [-0.48, 0.145, 0.11, 0.1],
      [-0.19, 0.106, 0.075, 0.1],
      [-0.08, 0.055, 0.025, 0.095],
    ],
    12,
  );
  loft(
    "Cockpit glazing",
    glass,
    [
      [-0.62, 0.09, 0.045, 0.155],
      [-0.47, 0.12, 0.1, 0.15],
      [-0.24, 0.086, 0.065, 0.14],
      [-0.13, 0.035, 0.018, 0.125],
    ],
    12,
  );
  loft(
    "Canopy rear fairing",
    armor,
    [
      [-0.77, 0.1, 0.035, 0.1],
      [-0.64, 0.12, 0.09, 0.135],
      [-0.57, 0.115, 0.105, 0.14],
    ],
    12,
  );
  box("Canopy spine", hull, 0, 0.24, -0.43, 0.015, 0.015, 0.15);
  loft(
    "Nose center ridge",
    armor,
    [
      [-0.08, 0.047, 0.028, 0.085],
      [0.3, 0.042, 0.022, 0.057],
      [0.85, 0.02, 0.009, 0.005],
    ],
    8,
  );

  for (const side of [-1, 1]) {
    const wing = (name, color, outline, bottom, top, taper = 1) =>
      panel(
        `${side} ${name}`,
        color,
        outline.map(([x, z]) => [side * x, z]),
        bottom,
        top,
        taper,
      );
    // The wing elbow and outer foil form a swept, cranked silhouette.
    wing(
      "wing spar",
      hull,
      [
        [0.17, -0.14],
        [0.6, -0.49],
        [0.58, -0.66],
        [0.18, -0.35],
      ],
      -0.025,
      0.033,
    );
    wing(
      "outer wing",
      armor,
      [
        [0.6, -0.49],
        [0.73, -0.66],
        [0.72, -0.94],
        [0.51, -0.88],
        [0.49, -0.67],
      ],
      -0.02,
      0.046,
      0.96,
    );
    wing(
      "wing red panel",
      red,
      [
        [0.61, -0.57],
        [0.69, -0.68],
        [0.68, -0.86],
        [0.56, -0.83],
        [0.54, -0.69],
      ],
      0.047,
      0.052,
    );
    wing(
      "nose armor",
      armor,
      [
        [0.068, 0.06],
        [0.225, -0.045],
        [0.15, 0.36],
        [0.04, 0.92],
      ],
      0.012,
      0.045,
      0.92,
    );
    wing(
      "nose stripe",
      red,
      [
        [0.087, 0.12],
        [0.115, 0.16],
        [0.054, 0.7],
        [0.04, 0.76],
      ],
      0.046,
      0.05,
    );
    // Mirrored engine housings are integrated into the compact rear fuselage.
    lathe(
      `${side} engine housing`,
      dark,
      [
        [0.076, -0.95],
        [0.09, -0.88],
        [0.075, -0.7],
      ],
      [side * 0.105, -0.015, 0],
      "z",
      24,
    );
    lathe(
      `${side} exhaust collar`,
      hull,
      [
        [0.079, -0.97],
        [0.087, -0.94],
        [0.087, -0.9],
      ],
      [side * 0.105, -0.015, 0],
      "z",
      24,
    );
    lathe(
      `${side} exhaust aperture`,
      [0.27, 0.54, 0.66],
      [
        [0.06, -0.972],
        [0.06, -0.971],
      ],
      [side * 0.105, -0.015, 0],
      "z",
      24,
    );
    // Cosmetic gun barrels; they do not define telemetry weapon counts.
    lathe(
      `${side} cannon breech`,
      dark,
      [
        [0.037, -0.72],
        [0.052, -0.64],
        [0.042, -0.48],
      ],
      [side * 0.6, 0.052, 0],
      "z",
      16,
    );
    lathe(
      `${side} cannon barrel`,
      hull,
      [
        [0.019, -0.49],
        [0.019, -0.25],
        [0.012, -0.16],
      ],
      [side * 0.6, 0.052, 0],
      "z",
      12,
    );
    lathe(
      `${side} cannon muzzle`,
      dark,
      [
        [0.017, -0.18],
        [0.017, -0.135],
      ],
      [side * 0.6, 0.052, 0],
      "z",
      12,
    );
    for (let i = 0; i < 4; i++)
      box(
        `${side} wing cooling slot ${i}`,
        dark,
        side * (0.56 + i * 0.035),
        0.055,
        -0.8,
        0.015,
        0.012,
        0.09,
      );
    for (let i = 0; i < 3; i++)
      box(
        `${side} nose vent ${i}`,
        dark,
        side * 0.115,
        0.058,
        0.02 + i * 0.037,
        0.06,
        0.012,
        0.016,
      );
    lathe(
      `${side} wing hinge`,
      dark,
      [
        [0.04, -0.36],
        [0.04, -0.2],
      ],
      [side * 0.235, 0.016, 0],
      "z",
      16,
    );
  }
  return parts;
}
