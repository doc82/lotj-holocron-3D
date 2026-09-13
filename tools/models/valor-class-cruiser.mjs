import { createShipMesh } from "./mesh-primitives.mjs";

// Original reference-informed geometry. +Y up, +Z bow; armament is cosmetic.
export function createValor() {
  const { parts, part, prism, box, lathe } = createShipMesh();
  const hull = [0.57, 0.59, 0.57],
    armor = [0.79, 0.78, 0.71];
  const dark = [0.18, 0.22, 0.25],
    red = [0.48, 0.13, 0.1];
  const light = [0.33, 0.68, 0.8],
    exhaust = [1, 0.61, 0.19];
  // Elliptical cross sections: z, half-width, half-height, center Y.
  function loft(name, color, sections, segments = 24) {
    const point = ([z, w, h, y], a) => [w * Math.cos(a), y - h * Math.sin(a), z];
    part(name, color, (tri, quad) => {
      for (let i = 0; i < segments; i++) {
        const a = (i * 2 * Math.PI) / segments,
          b = ((i + 1) * 2 * Math.PI) / segments;
        for (let j = 0; j < sections.length - 1; j++)
          quad(
            point(sections[j], a),
            point(sections[j + 1], a),
            point(sections[j + 1], b),
            point(sections[j], b),
          );
        const back = sections[0],
          front = sections.at(-1);
        tri([0, back[3], back[0]], point(back, a), point(back, b));
        tri([0, front[3], front[0]], point(front, b), point(front, a));
      }
    });
  }
  const outline = [
    [-0.12, -0.96],
    [0.12, -0.96],
    [0.31, -0.69],
    [0.39, -0.25],
    [0.37, 0.35],
    [0.25, 0.79],
    [0.06, 1.02],
    [-0.06, 1.02],
    [-0.25, 0.79],
    [-0.37, 0.35],
    [-0.39, -0.25],
    [-0.31, -0.69],
  ];
  loft("Lower armored hull", hull, [
    [-0.96, 0.1, 0.03, 0],
    [-0.7, 0.3, 0.105, -0.015],
    [-0.25, 0.385, 0.16, -0.025],
    [0.33, 0.37, 0.14, -0.015],
    [0.78, 0.245, 0.07, 0.025],
    [1.02, 0.05, 0.02, 0.06],
  ]);
  prism("Broadside machinery belt", dark, outline, 0.025, 0.095);
  prism("Main deck armor lip", armor, outline, 0.095, 0.12, 0.985);
  // Two independently armored dorsal masses separated by a machinery trench.
  for (const [i, start, end, width] of [
    [0, -0.88, -0.12, 0.29],
    [1, 0.04, 0.82, 0.31],
  ]) {
    loft(`Dorsal armor shell ${i}`, armor, [
      [start, 0.06, 0.015, 0.125],
      [start + 0.16, width * 0.88, 0.085, 0.13],
      [(start + end) / 2, width, 0.115, 0.13],
      [end - 0.1, width * 0.66, 0.07, 0.13],
      [end, 0.055, 0.015, 0.13],
    ]);
    for (const side of [-1, 1]) {
      box(
        `${i}/${side} shell red trim`,
        red,
        side * width * 0.74,
        0.133,
        (start + end) / 2,
        0.075,
        0.065,
        (end - start) * 0.68,
      );
      for (let j = 0; j < 5; j++)
        box(
          `${i}/${side} shell seam ${j}`,
          hull,
          side * 0.105,
          0.177,
          start + 0.2 + j * 0.075,
          0.15,
          0.128,
          0.009,
        );
    }
  }
  box("Central service trench", dark, 0, 0.132, -0.025, 0.52, 0.026, 0.13);
  for (let i = 0; i < 5; i++)
    box(`Trench crossbeam ${i}`, hull, -0.2 + i * 0.1, 0.153, -0.025, 0.013, 0.022, 0.13);
  // Elevated command platform and antennas.
  prism(
    "Bridge sloping support",
    dark,
    [
      [-0.075, -0.44],
      [0.075, -0.44],
      [0.065, -0.2],
      [-0.065, -0.2],
    ],
    0.2,
    0.35,
    0.55,
  );
  prism(
    "Command bridge",
    armor,
    [
      [-0.13, -0.39],
      [0.13, -0.39],
      [0.16, -0.26],
      [0.09, -0.17],
      [-0.09, -0.17],
      [-0.16, -0.26],
    ],
    0.34,
    0.38,
    0.88,
  );
  box("Bridge windows", light, 0, 0.353, -0.167, 0.145, 0.013, 0.01);
  box("Bridge roof marking", red, 0, 0.383, -0.28, 0.055, 0.01, 0.13);
  for (const [i, z, y] of [
    [0, -0.58, 0.24],
    [1, 0.29, 0.24],
  ]) {
    for (const side of [-1, 1]) {
      lathe(
        `${i}/${side} sensor mast`,
        dark,
        [
          [0.009, y],
          [0.003, y + 0.13],
        ],
        [side * 0.07, 0, z],
        "y",
        8,
      );
      box(`${i}/${side} sensor foot`, hull, side * 0.07, y - 0.02, z, 0.035, 0.07, 0.045);
    }
  }
  // Deep ventral pylon: the most distinctive part of the Valor silhouette.
  loft(
    "Ventral engineering spine",
    dark,
    [
      [-0.83, 0.07, 0.07, -0.18],
      [-0.67, 0.12, 0.25, -0.27],
      [-0.4, 0.13, 0.22, -0.25],
      [-0.12, 0.08, 0.08, -0.15],
      [0.22, 0.045, 0.025, -0.135],
    ],
    16,
  );
  for (const side of [-1, 1]) {
    const pylon = [
      [side * 0.08, -0.79],
      [side * 0.145, -0.67],
      [side * 0.125, -0.34],
      [side * 0.07, -0.21],
    ];
    if (side < 0) pylon.reverse();
    prism(`${side} engine pylon armor`, red, pylon, -0.44, -0.15, 0.8);
  }
  // Six aft-facing engines in a compact staggered cluster beneath the hull.
  for (const [i, x, y, r] of [
    [0, -0.115, -0.3, 0.072],
    [1, 0.115, -0.3, 0.072],
    [2, 0, -0.45, 0.075],
    [3, -0.16, -0.17, 0.043],
    [4, 0.16, -0.17, 0.043],
    [5, 0, -0.17, 0.04],
  ]) {
    lathe(
      `Engine housing ${i}`,
      hull,
      [
        [r * 0.95, -0.92],
        [r * 1.13, -0.85],
        [r, -0.6],
        [r * 0.65, -0.49],
      ],
      [x, y, 0],
      "z",
      20,
    );
    lathe(
      `Engine collar ${i}`,
      dark,
      [
        [r * 1.08, -0.944],
        [r * 1.08, -0.89],
      ],
      [x, y, 0],
      "z",
      20,
    );
    lathe(
      `Engine aperture ${i}`,
      exhaust,
      [
        [r * 0.79, -0.948],
        [r * 0.79, -0.945],
      ],
      [x, y, 0],
      "z",
      20,
    );
  }
  for (const side of [-1, 1]) {
    for (const [i, z, x] of [
      [0, -0.55, 0.33],
      [1, -0.25, 0.389],
      [2, 0.08, 0.384],
      [3, 0.4, 0.359],
      [4, 0.67, 0.292],
    ]) {
      box(`${side} broadside recess ${i}`, dark, side * x, 0.069, z, 0.017, 0.042, 0.12);
      box(`${side} broadside light ${i}`, light, side * (x + 0.011), 0.071, z, 0.006, 0.009, 0.075);
      box(`${side} red armor belt ${i}`, red, side * (x - 0.007), 0.013, z, 0.021, 0.034, 0.14);
      lathe(
        `${side} turret base ${i}`,
        dark,
        [
          [0.025, 0.121],
          [0.02, 0.143],
        ],
        [side * (x - 0.045), 0, z],
        "y",
        12,
      );
      for (const barrel of [-1, 1])
        lathe(
          `${side}/${i}/${barrel} turret barrel`,
          hull,
          [
            [0.0035, z],
            [0.0035, z + 0.063],
          ],
          [side * (x - 0.045) + barrel * 0.009, 0.143, 0],
          "z",
          8,
        );
    }
    box(`${side} forward hangar recess`, dark, side * 0.2, -0.065, 0.53, 0.075, 0.045, 0.15);
    for (let i = 0; i < 5; i++)
      box(
        `${side} aft radiator ${i}`,
        dark,
        side * 0.19,
        -0.07,
        -0.74 + i * 0.07,
        0.065,
        0.018,
        0.017,
      );
  }
  return parts;
}
