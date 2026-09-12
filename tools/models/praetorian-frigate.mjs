import { createShipMesh } from "./mesh-primitives.mjs";

// Original reference-informed Praetorian, not the similarly named Praetor.
// +Y up, +Z bow. Decorative armament does not set gameplay weapon counts.
export function createPraetorian() {
  const { parts, part, box, lathe, prism } = createShipMesh();
  const hull = [0.69, 0.7, 0.66],
    armor = [0.84, 0.83, 0.76],
    dark = [0.18, 0.23, 0.26];
  const stripe = [0.42, 0.18, 0.13],
    glass = [0.19, 0.48, 0.59],
    glow = [0.4, 0.72, 0.87];
  lathe(
    "Axial pressure hull",
    hull,
    [
      [0.09, -0.85],
      [0.14, -0.64],
      [0.15, -0.36],
      [0.205, -0.21],
      [0.225, 0.03],
      [0.2, 0.26],
      [0.145, 0.35],
      [0.105, 0.69],
      [0.065, 0.99],
    ],
    [0, 0, 0],
    "z",
    32,
  );
  // Modular collars and raised cladding give relief in geometry-only rendering.
  for (const [i, z, r, len] of [
    [0, -0.39, 0.164, 0.065],
    [1, -0.2, 0.216, 0.045],
    [2, 0.25, 0.212, 0.06],
    [3, 0.43, 0.144, 0.045],
    [4, 0.68, 0.109, 0.038],
  ])
    lathe(
      `Hull collar ${i}`,
      i === 1 || i === 3 ? stripe : armor,
      [
        [r, z - len / 2],
        [r, z + len / 2],
      ],
      [0, 0, 0],
      "z",
      24,
    );
  for (let band = 0; band < 4; band++) {
    const z0 = -0.16 + band * 0.092,
      z1 = z0 + 0.078;
    const radius = (z) =>
      z < 0.03 ? 0.205 + ((z + 0.21) / 0.24) * 0.02 : 0.225 - ((z - 0.03) / 0.23) * 0.025;
    for (let segment = 0; segment < 16; segment++) {
      const a = (segment * Math.PI) / 8 + 0.014,
        b = ((segment + 1) * Math.PI) / 8 - 0.014;
      const p = (z, angle) => [
        (radius(z) + 0.004) * Math.cos(angle),
        -(radius(z) + 0.004) * Math.sin(angle),
        z,
      ];
      part(
        `Pressure hull panel ${band}/${segment}`,
        segment % 4 === 0 ? armor : hull,
        (_tri, quad) => quad(p(z0, a), p(z1, a), p(z1, b), p(z0, b)),
      );
    }
  }
  // Stacked bow pods and their visible connecting neck.
  box("Forward vertical support", dark, 0, 0, 0.85, 0.09, 0.43, 0.12);
  for (const side of [-1, 1]) {
    const y = side * 0.25;
    lathe(
      `${side} forward command pod`,
      armor,
      [
        [0.088, -0.13],
        [0.115, -0.08],
        [0.105, 0.095],
        [0.077, 0.14],
      ],
      [0, y, 0.86],
      "y",
      16,
    );
    box(`${side} forward observation band`, glass, 0, y + 0.005, 0.967, 0.1, 0.025, 0.009);
    box(`${side} pod armor spine`, hull, 0, y, 0.973, 0.018, 0.18, 0.018);
    box(`${side} fore strut`, armor, 0, side * 0.15, 0.69, 0.055, 0.04, 0.32);
  }
  // Four large circular emplacements encircle the aft engineering neck.
  for (let i = 0; i < 4; i++) {
    const first = parts.length;
    lathe(
      `Engineering drum ${i}`,
      hull,
      [
        [0.11, 0.09],
        [0.12, 0.16],
        [0.1, 0.245],
      ],
      [0, 0, -0.53],
      "y",
      20,
    );
    lathe(
      `Drum rim ${i}`,
      armor,
      [
        [0.11, 0.234],
        [0.11, 0.259],
      ],
      [0, 0, -0.53],
      "y",
      20,
    );
    lathe(
      `Drum inset ${i}`,
      dark,
      [
        [0.075, 0.26],
        [0.075, 0.264],
      ],
      [0, 0, -0.53],
      "y",
      20,
    );
    // Rotate around the longitudinal axis, preserving winding.
    const a = (i * Math.PI) / 2;
    for (const p of parts.slice(first))
      for (let k = 0; k < p.positions.length; k += 3) {
        const x = p.positions[k],
          y = p.positions[k + 1];
        p.positions[k] = x * Math.cos(a) - y * Math.sin(a);
        p.positions[k + 1] = x * Math.sin(a) + y * Math.cos(a);
      }
  }
  for (const side of [-1, 1]) {
    const outline = [
      [0.07, -0.98],
      [0.27, -1.0],
      [0.3, -0.7],
      [0.14, -0.6],
    ].map(([x, z]) => [side * x, z]);
    if (side < 0) outline.reverse();
    prism(`${side} stern armored fairing`, armor, outline, -0.1, 0.1, 0.88);
    box(`${side} stern marking`, stripe, side * 0.195, 0.103, -0.81, 0.065, 0.015, 0.21);
    for (const tier of [-1, 1]) {
      const x = side * 0.18,
        y = tier * 0.15;
      box(`${side}/${tier} engine support`, dark, x, tier * 0.08, -0.79, 0.07, 0.18, 0.2);
      lathe(
        `${side}/${tier} engine housing`,
        hull,
        [
          [0.06, -0.99],
          [0.071, -0.92],
          [0.065, -0.67],
          [0.04, -0.61],
        ],
        [x, y, 0],
        "z",
        20,
      );
      lathe(
        `${side}/${tier} engine rim`,
        dark,
        [
          [0.065, -1.015],
          [0.065, -0.975],
        ],
        [x, y, 0],
        "z",
        20,
      );
      lathe(
        `${side}/${tier} engine aperture`,
        glow,
        [
          [0.047, -1.02],
          [0.047, -1.017],
        ],
        [x, y, 0],
        "z",
        20,
      );
    }
    for (let i = 0; i < 5; i++)
      box(`${side} radiator ${i}`, dark, side * 0.2, 0.117, -0.92 + i * 0.047, 0.085, 0.018, 0.009);
    box(`${side} service airlock`, dark, side * 0.228, 0, 0.02, 0.012, 0.065, 0.09);
    box(`${side} service light`, glass, side * 0.236, 0.02, 0.02, 0.006, 0.009, 0.055);
  }
  for (const [i, z, y] of [
    [0, 0.09, 0.228],
    [1, 0.51, 0.132],
  ]) {
    lathe(
      `Dorsal turret ${i}`,
      dark,
      [
        [0.033, y],
        [0.027, y + 0.024],
      ],
      [0, 0, z],
      "y",
      16,
    );
    for (const side of [-1, 1])
      box(
        `${i}/${side} gun barrel`,
        armor,
        side * 0.012,
        y + 0.022,
        z + 0.041,
        0.007,
        0.008,
        0.085,
      );
  }
  return parts;
}
