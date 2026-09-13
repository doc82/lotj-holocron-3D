// Shared geometry primitives for original Holocron ships. +Y up, +Z forward.
export function createShipMesh() {
  const parts = [];
  function part(name, color, build) {
    const positions = [];
    const tri = (a, b, c) => positions.push(...a, ...b, ...c);
    const quad = (a, b, c, d) => {
      tri(a, b, c);
      tri(a, c, d);
    };
    build(tri, quad);
    parts.push({ name, color, positions });
  }
  // Closed surface of revolution. Profile travels from bottom to top.
  function lathe(name, color, profile, center, axis = "y", segments = 48) {
    const point = (radius, height, angle) => {
      const x = radius * Math.cos(angle);
      const z = radius * Math.sin(angle);
      const p = axis === "y" ? [x, height, z] : [x, -z, height];
      return p.map((v, i) => v + center[i]);
    };
    part(name, color, (tri, quad) => {
      for (let i = 0; i < segments; i++) {
        const a = (i * Math.PI * 2) / segments;
        const b = ((i + 1) * Math.PI * 2) / segments;
        for (let j = 0; j < profile.length - 1; j++) {
          const [r0, h0] = profile[j];
          const [r1, h1] = profile[j + 1];
          quad(point(r0, h0, a), point(r1, h1, a), point(r1, h1, b), point(r0, h0, b));
        }
        const [r0, h0] = profile[0];
        const [r1, h1] = profile.at(-1);
        tri(point(0, h0, 0), point(r0, h0, a), point(r0, h0, b));
        tri(point(0, h1, 0), point(r1, h1, b), point(r1, h1, a));
      }
    });
  }
  // Convex plan polygon, counterclockwise in X/Z, with tapered upper deck.
  function prism(name, color, outline, bottom, top, taper = 1) {
    const cx = outline.reduce((sum, p) => sum + p[0], 0) / outline.length;
    const cz = outline.reduce((sum, p) => sum + p[1], 0) / outline.length;
    const low = outline.map(([x, z]) => [x, bottom, z]);
    const high = outline.map(([x, z]) => [cx + (x - cx) * taper, top, cz + (z - cz) * taper]);
    part(name, color, (tri, quad) => {
      for (let i = 0; i < outline.length; i++) {
        const next = (i + 1) % outline.length;
        quad(low[i], high[i], high[next], low[next]);
        tri([cx, bottom, cz], low[i], low[next]);
        tri([cx, top, cz], high[next], high[i]);
      }
    });
  }
  function box(name, color, x, y, z, width, height, length) {
    prism(
      name,
      color,
      [
        [x - width / 2, z - length / 2],
        [x + width / 2, z - length / 2],
        [x + width / 2, z + length / 2],
        [x - width / 2, z + length / 2],
      ],
      y - height / 2,
      y + height / 2,
    );
  }

  return { parts, part, lathe, prism, box };
}
