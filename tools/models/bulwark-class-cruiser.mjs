import { createShipMesh } from "./mesh-primitives.mjs";

// Original Holocron interpretation from visual references, not imported geometry.
// +Y up, +Z bow. Cosmetic armament does not determine telemetry weapon counts.
export function createBulwark() {
  const { parts, part, lathe, box, prism } = createShipMesh();
  const hull = [0.43, 0.49, 0.53];
  const armor = [0.63, 0.67, 0.68];
  const dark = [0.17, 0.22, 0.25];
  const stripe = [0.2, 0.34, 0.43];
  const glow = [0.3, 0.67, 0.8];
  // [z, half-width, half-height, center y]; broad forebody and tapered tail.
  const profile = [
    [-1.0, 0.047, 0.028, 0.018],
    [-0.8, 0.083, 0.046, 0.016],
    [-0.52, 0.15, 0.087, 0.01],
    [-0.22, 0.24, 0.145, 0],
    [0.12, 0.285, 0.175, 0],
    [0.43, 0.27, 0.167, 0],
    [0.71, 0.21, 0.135, -0.008],
    [0.92, 0.14, 0.095, -0.017],
    [1.0, 0.098, 0.07, -0.023],
  ];
  function point([z, w, h, y], angle, offset = 0) {
    return [offset + w * Math.cos(angle), y - h * Math.sin(angle), z];
  }
  function loft(name, color, sections, offset = 0, segments = 24) {
    part(name, color, (tri, quad) => {
      for (let i = 0; i < segments; i++) {
        const a = (i * Math.PI * 2) / segments;
        const b = ((i + 1) * Math.PI * 2) / segments;
        for (let j = 0; j < sections.length - 1; j++) {
          quad(
            point(sections[j], a, offset),
            point(sections[j + 1], a, offset),
            point(sections[j + 1], b, offset),
            point(sections[j], b, offset),
          );
        }
        const back = sections[0],
          front = sections.at(-1);
        tri([offset, back[3], back[0]], point(back, a, offset), point(back, b, offset));
        tri([offset, front[3], front[0]], point(front, b, offset), point(front, a, offset));
      }
    });
  }
  loft("Armored pressure hull", hull, profile);
  // Individual panels give the ship readable relief with tactical flat shading.
  for (let j = 0; j < profile.length - 1; j++) {
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6 + 0.018,
        b = ((i + 1) * Math.PI) / 6 - 0.018;
      const interpolate = (t) => profile[j].map((v, k) => v + (profile[j + 1][k] - v) * t);
      const back = interpolate(0.045),
        front = interpolate(0.955);
      for (const section of [back, front]) {
        section[1] += 0.004;
        section[2] += 0.004;
      }
      part(
        `Armor panel ${j}/${i}`,
        j === 4 ? stripe : (i + j) % 3 === 0 ? armor : hull,
        (_tri, quad) => {
          quad(point(back, a), point(front, a), point(front, b), point(back, b));
        },
      );
    }
  }
  loft(
    "Ventral armored keel",
    dark,
    [
      [-0.75, 0.04, 0.02, -0.043],
      [-0.23, 0.12, 0.04, -0.1],
      [0.4, 0.14, 0.046, -0.135],
      [0.89, 0.07, 0.02, -0.084],
    ],
    0,
    16,
  );
  loft(
    "Command deck fairing",
    armor,
    [
      [0.14, 0.065, 0.018, 0.176],
      [0.24, 0.085, 0.04, 0.183],
      [0.42, 0.075, 0.04, 0.173],
      [0.54, 0.045, 0.016, 0.15],
    ],
    0,
    16,
  );
  box("Bridge observation band", dark, 0, 0.211, 0.33, 0.125, 0.022, 0.18);
  box("Bridge roof", armor, 0, 0.227, 0.31, 0.105, 0.015, 0.14);
  box("Sensor mast", hull, 0, 0.256, 0.27, 0.016, 0.058, 0.019);
  box("Sensor crossbar", armor, 0, 0.281, 0.27, 0.069, 0.012, 0.018);
  // Dark fore-hangar with raised frame, visible at the rounded bow.
  box("Forward hangar recess", dark, 0, -0.026, 1.004, 0.128, 0.069, 0.012);
  for (const side of [-1, 1])
    box(`${side} hangar jamb`, armor, side * 0.069, -0.026, 1.01, 0.014, 0.086, 0.023);
  box("Hangar lintel", armor, 0, 0.02, 1.01, 0.151, 0.014, 0.023);
  box("Hangar floor", hull, 0, -0.072, 1.015, 0.151, 0.015, 0.036);
  for (const side of [-1, 1]) {
    // Broadside armored oval emplacements along the widest part of the hull.
    for (const [i, z] of [-0.17, 0.02, 0.21, 0.4, 0.59].entries()) {
      const width = z > 0.5 ? 0.238 : z < 0 ? 0.251 : 0.282;
      loft(
        `${side} broadside mount ${i}`,
        dark,
        [
          [z - 0.06, 0.013, 0.016, -0.015],
          [z - 0.04, 0.029, 0.035, -0.015],
          [z + 0.04, 0.029, 0.035, -0.015],
          [z + 0.06, 0.013, 0.016, -0.015],
        ],
        side * width,
        12,
      );
      box(`${side} mount cap ${i}`, armor, side * (width + 0.013), 0.013, z, 0.046, 0.016, 0.068);
    }
    const fin = [
      [0.13, -0.39],
      [0.245, -0.47],
      [0.235, -0.78],
      [0.095, -0.67],
    ].map(([x, z]) => [side * x, z]);
    if (side > 0) fin.reverse();
    prism(`${side} aft stabilizer`, hull, fin, -0.036, 0.015);
    loft(
      `${side} engine nacelle`,
      hull,
      [
        [-0.86, 0.048, 0.044, -0.055],
        [-0.79, 0.063, 0.06, -0.055],
        [-0.48, 0.063, 0.06, -0.055],
        [-0.38, 0.029, 0.029, -0.045],
      ],
      side * 0.19,
      16,
    );
    lathe(
      `${side} engine collar`,
      dark,
      [
        [0.047, -0.88],
        [0.052, -0.84],
      ],
      [side * 0.19, -0.055, 0],
      "z",
      24,
    );
    lathe(
      `${side} engine aperture`,
      glow,
      [
        [0.036, -0.883],
        [0.036, -0.882],
      ],
      [side * 0.19, -0.055, 0],
      "z",
      24,
    );
    for (let i = 0; i < 6; i++)
      box(
        `${side} radiator ${i}`,
        dark,
        side * 0.185,
        0.013,
        -0.72 + i * 0.037,
        0.065,
        0.012,
        0.016,
      );
  }
  lathe(
    "Axial engine collar",
    dark,
    [
      [0.037, -1.019],
      [0.037, -0.99],
    ],
    [0, 0.017, 0],
    "z",
    24,
  );
  lathe(
    "Axial engine aperture",
    glow,
    [
      [0.026, -1.021],
      [0.026, -1.02],
    ],
    [0, 0.017, 0],
    "z",
    24,
  );
  for (const [index, z, y] of [
    [0, 0.66, 0.142],
    [1, -0.15, 0.155],
  ]) {
    lathe(
      `Dorsal turret ${index}`,
      dark,
      [
        [0.034, y],
        [0.029, y + 0.028],
      ],
      [0, 0, z],
      "y",
      16,
    );
    for (const side of [-1, 1])
      lathe(
        `${index}/${side} turret barrel`,
        armor,
        [
          [0.005, z + 0.01],
          [0.005, z + 0.085],
        ],
        [side * 0.012, y + 0.025, 0],
        "z",
        8,
      );
  }
  return parts;
}
