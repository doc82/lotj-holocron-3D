import { createShipMesh } from "./mesh-primitives.mjs";

// Original Republic scout interpretation. +Y up, +Z bow; fixed flight pose.
export function createFlashfire() {
  const { parts, part, prism, box, lathe } = createShipMesh();
  const hull = [0.74, 0.77, 0.75],
    armor = [0.87, 0.86, 0.78],
    dark = [0.17, 0.23, 0.27];
  const blue = [0.06, 0.28, 0.52],
    gold = [0.81, 0.64, 0.18],
    glass = [0.04, 0.17, 0.24],
    glow = [0.27, 0.72, 0.9];
  prism(
    "Pointed fuselage",
    hull,
    [
      [-0.12, -0.79],
      [0.12, -0.79],
      [0.22, -0.2],
      [0.15, 0.48],
      [0.035, 1.02],
      [-0.035, 1.02],
      [-0.15, 0.48],
      [-0.22, -0.2],
    ],
    -0.085,
    0.09,
    0.84,
  );
  prism(
    "Fore armor deck",
    armor,
    [
      [-0.13, -0.03],
      [0.13, -0.03],
      [0.115, 0.4],
      [0.025, 0.78],
      [-0.025, 0.78],
      [-0.115, 0.4],
    ],
    0.07,
    0.125,
    0.83,
  );
  prism(
    "Blue nose cap",
    blue,
    [
      [-0.07, 0.73],
      [0.07, 0.73],
      [0.038, 1.025],
      [-0.038, 1.025],
    ],
    -0.055,
    0.05,
  );
  box("Nose sensor aperture", dark, 0, 0.005, 1.028, 0.05, 0.038, 0.012);
  // Raised faceted canopy, glazing slightly outside its structural shell.
  const low = [
    [-0.145, 0.09, -0.2],
    [0.145, 0.09, -0.2],
    [0.12, 0.09, 0.27],
    [-0.12, 0.09, 0.27],
  ];
  const high = [
    [-0.105, 0.24, -0.14],
    [0.105, 0.24, -0.14],
    [0.084, 0.215, 0.14],
    [-0.084, 0.215, 0.14],
  ];
  part("Canopy frame", armor, (_tri, quad) => {
    for (let i = 0; i < 4; i++) {
      const n = (i + 1) % 4;
      quad(low[i], high[i], high[n], low[n]);
    }
    quad(high[3], high[2], high[1], high[0]);
    quad(low[0], low[1], low[2], low[3]);
  });
  part("Forward windscreen", glass, (_tri, quad) =>
    quad(
      [-0.078, 0.211, 0.148],
      [0.078, 0.211, 0.148],
      [0.108, 0.111, 0.252],
      [-0.108, 0.111, 0.252],
    ),
  );
  box("Canopy roof", glass, 0, 0.244, -0.045, 0.17, 0.008, 0.16);
  box("Aft equipment spine", dark, 0, 0.08, -0.52, 0.2, 0.15, 0.37);
  for (let i = 0; i < 6; i++)
    box(`Spine cooling fin ${i}`, hull, 0, 0.163, -0.66 + i * 0.047, 0.18, 0.02, 0.012);
  lathe(
    "Axial engine housing",
    dark,
    [
      [0.095, -0.89],
      [0.112, -0.76],
      [0.09, -0.48],
    ],
    [0, -0.015, 0],
    "z",
    24,
  );
  lathe(
    "Axial engine rim",
    hull,
    [
      [0.1, -0.925],
      [0.1, -0.865],
    ],
    [0, -0.015, 0],
    "z",
    24,
  );
  lathe(
    "Axial engine aperture",
    glow,
    [
      [0.076, -0.929],
      [0.076, -0.926],
    ],
    [0, -0.015, 0],
    "z",
    24,
  );
  for (const side of [-1, 1]) {
    const panel = (name, color, outline, bottom, top, taper = 1) => {
      const mirrored = outline.map(([x, z]) => [side * x, z]);
      if (side < 0) mirrored.reverse();
      prism(`${side} ${name}`, color, mirrored, bottom, top, taper);
    };
    panel(
      "swept wing",
      hull,
      [
        [0.14, -0.53],
        [1.02, -0.49],
        [0.98, -0.31],
        [0.31, 0.14],
        [0.16, 0.09],
      ],
      -0.05,
      0.022,
      0.97,
    );
    panel(
      "blue wing tip",
      blue,
      [
        [0.7, -0.49],
        [1.025, -0.49],
        [0.98, -0.31],
        [0.73, -0.18],
      ],
      0.022,
      0.038,
    );
    panel(
      "wing armor",
      armor,
      [
        [0.4, -0.42],
        [0.73, -0.42],
        [0.7, -0.21],
        [0.4, -0.02],
      ],
      0.025,
      0.045,
    );
    panel(
      "wing stripe",
      gold,
      [
        [0.68, -0.39],
        [0.715, -0.4],
        [0.7, -0.225],
        [0.668, -0.2],
      ],
      0.046,
      0.053,
    );
    panel(
      "pod fairing",
      armor,
      [
        [0.24, -0.64],
        [0.4, -0.64],
        [0.435, -0.25],
        [0.37, 0.19],
        [0.25, 0.19],
        [0.215, -0.23],
      ],
      -0.025,
      0.145,
      0.78,
    );
    box(`${side} pod stripe`, blue, side * 0.325, 0.15, -0.39, 0.052, 0.025, 0.31);
    box(`${side} intake`, dark, side * 0.32, 0.09, 0.19, 0.094, 0.069, 0.017);
    box(`${side} cannon mount`, dark, side * 0.41, -0.055, -0.035, 0.08, 0.075, 0.24);
    lathe(
      `${side} laser housing`,
      hull,
      [
        [0.043, -0.03],
        [0.043, 0.28],
        [0.025, 0.33],
      ],
      [side * 0.41, -0.065, 0],
      "z",
      12,
    );
    lathe(
      `${side} laser muzzle`,
      dark,
      [
        [0.016, 0.33],
        [0.016, 0.41],
      ],
      [side * 0.41, -0.065, 0],
      "z",
      12,
    );
    lathe(
      `${side} pod exhaust`,
      glow,
      [
        [0.033, -0.662],
        [0.033, -0.659],
      ],
      [side * 0.32, 0.035, 0],
      "z",
      16,
    );
    lathe(
      `${side} pod nozzle`,
      dark,
      [
        [0.046, -0.657],
        [0.046, -0.62],
      ],
      [side * 0.32, 0.035, 0],
      "z",
      16,
    );
    // Canted tail fins, mirrored with corrected triangle winding.
    const before = parts.length;
    prism(
      `${side} tail fin`,
      blue,
      [
        [0.05, -0.88],
        [0.23, -0.98],
        [0.19, -0.72],
        [0.06, -0.61],
      ],
      -0.012,
      0.012,
    );
    for (const p of parts.slice(before))
      for (let i = 0; i < p.positions.length; i += 3) {
        const x = p.positions[i],
          y = p.positions[i + 1];
        p.positions[i] = side * x;
        p.positions[i + 1] = y + x * 0.85 + 0.07;
      }
    if (side < 0)
      for (const p of parts.slice(before))
        for (let i = 0; i < p.positions.length; i += 9) {
          const a = p.positions.slice(i, i + 3);
          p.positions.splice(i, 3, ...p.positions.slice(i + 3, i + 6));
          p.positions.splice(i + 3, 3, ...a);
        }
    box(`${side} wing relief rib`, dark, side * 0.59, 0.051, -0.34, 0.16, 0.016, 0.023);
  }
  return parts;
}
