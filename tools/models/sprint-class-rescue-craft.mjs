import { createShipMesh } from "./mesh-primitives.mjs";

// Original interpretation of the documented flat, wide, unarmed Med Runner.
// +Y up, +Z bow. No downloaded mesh or texture is used.
export function createSprint() {
  const { parts, part, prism, box, lathe } = createShipMesh();
  const hull = [0.73, 0.76, 0.74];
  const white = [0.88, 0.89, 0.82];
  const dark = [0.19, 0.25, 0.28];
  const orange = [0.85, 0.33, 0.08];
  const glass = [0.07, 0.26, 0.34];
  const exhaust = [0.27, 0.66, 0.8];
  const outline = [
    [-0.48, -0.8],
    [0.48, -0.8],
    [0.6, -0.59],
    [0.52, 0.68],
    [0.36, 1.0],
    [-0.36, 1.0],
    [-0.52, 0.68],
    [-0.6, -0.59],
  ];
  prism("Wide rescue pressure hull", hull, outline, -0.12, 0.12, 0.94);
  prism(
    "Ventral impact belt",
    dark,
    outline.map(([x, z]) => [x * 1.01, z * 1.002]),
    -0.09,
    -0.045,
  );
  prism(
    "Medical cabin",
    white,
    [
      [-0.38, -0.55],
      [0.38, -0.55],
      [0.42, -0.3],
      [0.38, 0.37],
      [-0.38, 0.37],
      [-0.42, -0.3],
    ],
    0.1,
    0.265,
    0.87,
  );
  box("Medical cabin roof", hull, 0, 0.273, -0.105, 0.58, 0.024, 0.62);
  // Faceted forward cockpit with a broad, slanted windscreen.
  const low = [
    [-0.32, 0.105, 0.4],
    [0.32, 0.105, 0.4],
    [0.3, 0.105, 0.89],
    [-0.3, 0.105, 0.89],
  ];
  const high = [
    [-0.265, 0.27, 0.41],
    [0.265, 0.27, 0.41],
    [0.235, 0.245, 0.73],
    [-0.235, 0.245, 0.73],
  ];
  part("Cockpit shell", white, (_tri, quad) => {
    for (let i = 0; i < 4; i++) {
      const n = (i + 1) % 4;
      quad(low[i], high[i], high[n], low[n]);
    }
    quad(high[3], high[2], high[1], high[0]);
    quad(low[0], low[1], low[2], low[3]);
  });
  part("Panoramic windscreen", glass, (_tri, quad) => {
    quad(
      [-0.224, 0.238, 0.739],
      [0.224, 0.238, 0.739],
      [0.279, 0.132, 0.862],
      [-0.279, 0.132, 0.862],
    );
    for (const side of [-1, 1]) {
      quad(
        [side * 0.246, 0.24, 0.68],
        [side * 0.273, 0.256, 0.45],
        [side * 0.314, 0.132, 0.46],
        [side * 0.3, 0.132, 0.72],
      );
    }
  });
  part("Windscreen center frame", hull, (_tri, quad) => {
    quad([-0.01, 0.242, 0.738], [0.01, 0.242, 0.738], [0.01, 0.13, 0.869], [-0.01, 0.13, 0.869]);
  });
  box("Fore rescue bay door", dark, 0, -0.01, 1.005, 0.3, 0.072, 0.014);
  box("Rescue bay sill", orange, 0, -0.057, 1.011, 0.35, 0.02, 0.037);
  box("Rescue bay header", white, 0, 0.04, 1.006, 0.35, 0.023, 0.02);
  box("Door center seam", hull, 0, -0.01, 1.018, 0.013, 0.073, 0.013);
  // Clearly visible roof stripe, with no real-world protected medical emblems.
  box("Dorsal rescue stripe", orange, 0, 0.29, -0.105, 0.13, 0.012, 0.58);
  lathe(
    "Life-form sensor base",
    dark,
    [
      [0.067, 0.288],
      [0.052, 0.33],
    ],
    [0, 0, -0.38],
    "y",
    20,
  );
  lathe(
    "Life-form sensor dome",
    white,
    [
      [0.072, 0.33],
      [0.065, 0.36],
      [0.025, 0.389],
    ],
    [0, 0, -0.38],
    "y",
    20,
  );
  for (const side of [-1, 1]) {
    const panel = (name, color, points, bottom, top, taper = 1) => {
      const p = points.map(([x, z]) => [x * side, z]);
      if (side < 0) p.reverse();
      prism(`${side} ${name}`, color, p, bottom, top, taper);
    };
    panel(
      "rescue shoulder",
      white,
      [
        [0.41, -0.53],
        [0.565, -0.48],
        [0.49, 0.64],
        [0.4, 0.7],
      ],
      0.075,
      0.14,
      0.95,
    );
    panel(
      "shoulder stripe",
      orange,
      [
        [0.455, -0.42],
        [0.51, -0.4],
        [0.459, 0.53],
        [0.414, 0.58],
      ],
      0.141,
      0.15,
    );
    // Symmetric engine nacelles join the aft hull instead of fighter wings.
    box(`${side} engine mount`, hull, side * 0.48, -0.005, -0.57, 0.26, 0.15, 0.43);
    lathe(
      `${side} engine housing`,
      hull,
      [
        [0.108, -0.94],
        [0.137, -0.8],
        [0.137, -0.43],
        [0.09, -0.28],
      ],
      [side * 0.47, 0.005, 0],
      "z",
      24,
    );
    lathe(
      `${side} exhaust collar`,
      dark,
      [
        [0.116, -0.977],
        [0.126, -0.94],
        [0.126, -0.88],
      ],
      [side * 0.47, 0.005, 0],
      "z",
      24,
    );
    lathe(
      `${side} exhaust aperture`,
      exhaust,
      [
        [0.088, -0.98],
        [0.088, -0.979],
      ],
      [side * 0.47, 0.005, 0],
      "z",
      24,
    );
    for (let i = 0; i < 5; i++)
      box(
        `${side} engine louvre ${i}`,
        dark,
        side * 0.47,
        0.143,
        -0.77 + i * 0.055,
        0.16,
        0.016,
        0.022,
      );
    // Side airlocks connect to casualty ships; collars lie along the X axis.
    const before = parts.length;
    lathe(
      `${side} docking collar`,
      white,
      [
        [0.093, 0.57],
        [0.11, 0.61],
        [0.1, 0.65],
      ],
      [0, 0, 0],
      "z",
      20,
    );
    lathe(
      `${side} docking seal`,
      dark,
      [
        [0.076, 0.651],
        [0.076, 0.656],
      ],
      [0, 0, 0],
      "z",
      20,
    );
    for (const p of parts.slice(before)) {
      for (let i = 0; i < p.positions.length; i += 3) {
        const [x, y, z] = p.positions.slice(i, i + 3);
        // Proper rotations (not reflections) preserve outward winding.
        p.positions.splice(i, 3, side * z, y, -side * x - 0.06);
      }
    }
    box(`${side} patient cabin viewport`, glass, side * 0.371, 0.209, 0.085, 0.028, 0.038, 0.15);
    lathe(
      `${side} dorsal status beacon`,
      orange,
      [
        [0.028, 0.283],
        [0.025, 0.32],
      ],
      [side * 0.22, 0, -0.24],
      "y",
      12,
    );
    // Recessed maneuvering jets and folded landing skids, not gun barrels.
    box(`${side} fore maneuvering recess`, dark, side * 0.39, -0.011, 0.83, 0.073, 0.046, 0.06);
    box(`${side} stowed landing skid`, dark, side * 0.31, -0.147, -0.13, 0.085, 0.047, 0.92);
    box(
      `${side} fore work light`,
      [0.87, 0.84, 0.56],
      side * 0.238,
      0.04,
      0.99,
      0.055,
      0.025,
      0.02,
    );
  }
  return parts;
}
