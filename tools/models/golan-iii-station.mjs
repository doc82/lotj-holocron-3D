import { createShipMesh } from "./mesh-primitives.mjs";

// Original Golan III interpretation; +Y up, +Z docking approach.
// Visual weapons do not change telemetry or station capabilities.
export function createGolanIII() {
  const { parts, box, prism, lathe } = createShipMesh();
  const hull = [0.37, 0.42, 0.46],
    armor = [0.57, 0.61, 0.63],
    dark = [0.13, 0.18, 0.22];
  const light = [0.45, 0.77, 0.86],
    trim = [0.27, 0.35, 0.4];
  box("Central structural bridge", hull, 0, 0, 0, 1.8, 0.19, 0.49);
  for (const side of [-1, 1]) {
    const x = side * 0.52;
    const outline = [
      [-0.43, -0.5],
      [0.32, -0.5],
      [0.48, -0.32],
      [0.48, 0.32],
      [0.32, 0.5],
      [-0.43, 0.5],
      [-0.49, 0.31],
      [-0.49, -0.31],
    ].map(([a, z]) => [x + side * a, z]);
    if (side < 0) outline.reverse();
    prism(`${side} armored lower lobe`, hull, outline, -0.14, -0.06, 0.96);
    prism(`${side} window machinery belt`, dark, outline, -0.055, 0.025, 0.98);
    prism(`${side} armored upper lobe`, armor, outline, 0.025, 0.14, 0.92);
    for (const zSide of [-1, 1]) {
      box(`${side}/${zSide} deck stripe`, trim, x, 0.143, zSide * 0.35, 0.58, 0.015, 0.045);
      box(`${side}/${zSide} gallery windows`, light, x, -0.005, zSide * 0.497, 0.52, 0.015, 0.006);
      box(`${side}/${zSide} battery foundation`, dark, x, 0.17, zSide * 0.27, 0.32, 0.075, 0.15);
      for (let i = 0; i < 4; i++) {
        const tx = x - 0.12 + i * 0.08,
          z = zSide * 0.27;
        lathe(
          `${side}/${zSide}/${i} gun cupola`,
          hull,
          [
            [0.028, 0.202],
            [0.022, 0.232],
          ],
          [tx, 0, z],
          "y",
          12,
        );
        for (const barrel of [-1, 1])
          box(
            `${side}/${zSide}/${i}/${barrel} barrel`,
            armor,
            tx + barrel * 0.009,
            0.228,
            z + zSide * 0.042,
            0.008,
            0.008,
            0.07,
          );
      }
      for (let i = 0; i < 5; i++)
        box(
          `${side}/${zSide} armor rib ${i}`,
          hull,
          x - 0.24 + i * 0.12,
          0.139,
          zSide * 0.41,
          0.009,
          0.035,
          0.12,
        );
    }
    // Twin broad towers, octagonal crowns and outer docking armatures.
    lathe(
      `${side} tower plinth`,
      trim,
      [
        [0.21, 0.135],
        [0.19, 0.19],
        [0.145, 0.235],
      ],
      [x, 0, 0],
      "y",
      8,
    );
    lathe(
      `${side} tower shaft`,
      hull,
      [
        [0.14, 0.2],
        [0.13, 0.32],
        [0.13, 0.51],
        [0.155, 0.54],
      ],
      [x, 0, 0],
      "y",
      8,
    );
    for (const direction of [-1, 1]) {
      box(
        `${side}/${direction} tower spine`,
        armor,
        x + direction * 0.127,
        0.37,
        0,
        0.019,
        0.25,
        0.051,
      );
      box(
        `${side}/${direction} tower window`,
        light,
        x,
        0.49,
        direction * 0.123,
        0.09,
        0.018,
        0.009,
      );
    }
    lathe(
      `${side} tower crown`,
      armor,
      [
        [0.155, 0.515],
        [0.19, 0.55],
        [0.18, 0.59],
      ],
      [x, 0, 0],
      "y",
      8,
    );
    lathe(
      `${side} crown command dome`,
      trim,
      [
        [0.093, 0.586],
        [0.08, 0.63],
      ],
      [x, 0, 0],
      "y",
      8,
    );
    box(`${side} crown cross arm`, hull, x, 0.565, 0, 0.49, 0.036, 0.065);
    box(`${side} crown fore arm`, hull, x, 0.565, 0, 0.065, 0.036, 0.4);
    for (const direction of [-1, 1]) {
      lathe(
        `${side}/${direction} crown turret`,
        armor,
        [
          [0.023, 0.585],
          [0.018, 0.61],
        ],
        [x + direction * 0.2, 0, 0],
        "y",
        12,
      );
      lathe(
        `${side}/${direction} sensor`,
        dark,
        [
          [0.008, 0.6],
          [0.003, 0.7],
        ],
        [x, 0, direction * 0.15],
        "y",
        8,
      );
    }
    lathe(
      `${side} lower reactor pod`,
      dark,
      [
        [0.105, -0.26],
        [0.16, -0.22],
        [0.17, -0.13],
      ],
      [x, 0, 0],
      "y",
      12,
    );
    lathe(
      `${side} reactor shield`,
      hull,
      [
        [0.1, -0.28],
        [0.15, -0.235],
      ],
      [x, 0, 0],
      "y",
      12,
    );
    box(`${side} outboard docking collar`, trim, side * 1.006, -0.005, 0, 0.039, 0.088, 0.19);
    box(`${side} outboard docking aperture`, dark, side * 1.029, -0.005, 0, 0.009, 0.052, 0.12);
  }
  box("Command block pedestal", trim, 0, 0.19, 0, 0.22, 0.28, 0.24);
  prism(
    "Central command citadel",
    armor,
    [
      [-0.22, -0.17],
      [0.22, -0.17],
      [0.25, -0.1],
      [0.25, 0.1],
      [0.22, 0.17],
      [-0.22, 0.17],
      [-0.25, 0.1],
      [-0.25, -0.1],
    ],
    0.3,
    0.43,
    0.78,
  );
  for (const side of [-1, 1]) {
    box(`${side} citadel window`, light, 0, 0.343, side * 0.161, 0.29, 0.022, 0.01);
    box(`${side} primary hangar`, dark, 0, -0.002, side * 0.257, 0.235, 0.105, 0.015);
    box(`${side} hangar lintel`, armor, 0, 0.064, side * 0.266, 0.28, 0.027, 0.055);
    for (const jamb of [-1, 1])
      box(
        `${side}/${jamb} hangar jamb`,
        armor,
        jamb * 0.132,
        -0.007,
        side * 0.263,
        0.025,
        0.14,
        0.04,
      );
    box(`${side} hangar docking lights`, light, 0, 0.035, side * 0.268, 0.17, 0.011, 0.008);
    box(`${side} docking apron`, hull, 0, -0.084, side * 0.285, 0.28, 0.024, 0.09);
  }
  // Deep central lower spire keeps the silhouette unmistakably stationary.
  lathe(
    "Lower command hub",
    hull,
    [
      [0.09, -0.34],
      [0.15, -0.26],
      [0.18, -0.15],
      [0.15, -0.09],
    ],
    [0, 0, 0],
    "y",
    8,
  );
  lathe(
    "Ventral spire",
    armor,
    [
      [0.012, -1.0],
      [0.032, -0.89],
      [0.046, -0.82],
      [0.05, -0.42],
      [0.07, -0.33],
    ],
    [0, 0, 0],
    "y",
    8,
  );
  lathe(
    "Spire service collar",
    trim,
    [
      [0.043, -0.83],
      [0.06, -0.8],
      [0.06, -0.72],
      [0.05, -0.7],
    ],
    [0, 0, 0],
    "y",
    8,
  );
  for (const side of [-1, 1])
    box(`${side} spire illumination`, light, side * 0.051, -0.59, 0, 0.006, 0.2, 0.015);
  return parts;
}
