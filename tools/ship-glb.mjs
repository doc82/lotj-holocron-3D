// Minimal GLB container reader; geometry decoding remains in the ship importer.
export function encodeShipGlb(parts) {
  const gltf = {
    asset: { version: "2.0", generator: "Holocron original ship modeler" },
    scene: 0,
    scenes: [{ nodes: parts.map((_, i) => i) }],
    nodes: [],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
  };
  const chunks = [];
  let byteOffset = 0;
  function accessor(values, minimum, maximum) {
    const floats = new Float32Array(values);
    const bytes = Buffer.from(floats.buffer);
    const index = gltf.accessors.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length, target: 34962 });
    gltf.accessors.push({
      bufferView: index,
      componentType: 5126,
      count: floats.length / 3,
      type: "VEC3",
      ...(minimum ? { min: minimum, max: maximum } : {}),
    });
    chunks.push(bytes);
    byteOffset += bytes.length;
    return index;
  }
  for (const [index, part] of parts.entries()) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const normals = [];
    for (let i = 0; i < part.positions.length; i += 9) {
      const p = part.positions.slice(i, i + 9);
      const u = [p[3] - p[0], p[4] - p[1], p[5] - p[2]];
      const v = [p[6] - p[0], p[7] - p[1], p[8] - p[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const length = Math.hypot(...n);
      if (!Number.isFinite(length) || length === 0)
        throw new Error(`${part.name}: invalid triangle.`);
      for (let vertex = 0; vertex < 3; vertex++) normals.push(...n.map((value) => value / length));
    }
    for (let i = 0; i < part.positions.length; i++) {
      min[i % 3] = Math.min(min[i % 3], Math.fround(part.positions[i]));
      max[i % 3] = Math.max(max[i % 3], Math.fround(part.positions[i]));
    }
    const position = accessor(part.positions, min, max);
    const normal = accessor(normals);
    gltf.nodes.push({ name: part.name, mesh: index });
    gltf.meshes.push({
      name: part.name,
      primitives: [{ attributes: { POSITION: position, NORMAL: normal }, material: index }],
    });
    gltf.materials.push({
      name: part.name,
      pbrMetallicRoughness: {
        baseColorFactor: [...part.color, 1],
        metallicFactor: 0.35,
        roughnessFactor: 0.7,
      },
      doubleSided: true,
    });
  }
  gltf.buffers.push({ byteLength: byteOffset });
  const json = Buffer.from(JSON.stringify(gltf));
  const paddedJson = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(paddedJson);
  const binary = Buffer.concat(chunks);
  const result = Buffer.alloc(12 + 8 + paddedJson.length + 8 + binary.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(paddedJson.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  paddedJson.copy(result, 20);
  const binOffset = 20 + paddedJson.length;
  result.writeUInt32LE(binary.length, binOffset);
  result.writeUInt32LE(0x004e4942, binOffset + 4);
  binary.copy(result, binOffset + 8);
  return result;
}

export function decodeGlb(bytes) {
  if (
    bytes.length < 20 ||
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length
  ) {
    throw new Error("Invalid GLB 2.0 container.");
  }
  let gltf;
  let binary;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error("Truncated GLB chunk header.");
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + length;
    if (length % 4 || end > bytes.length) throw new Error("Invalid GLB chunk length.");
    const chunk = bytes.subarray(offset + 8, end);
    if (offset === 12 && type !== 0x4e4f534a) throw new Error("GLB JSON must be first.");
    if (type === 0x4e4f534a) {
      if (gltf) throw new Error("Duplicate GLB JSON chunk.");
      gltf = JSON.parse(chunk.toString("utf8"));
    }
    if (type === 0x004e4942) {
      if (binary) throw new Error("Duplicate GLB binary chunk.");
      binary = chunk;
    }
    offset = end;
  }
  if (!gltf || !binary) throw new Error("GLB needs JSON and binary chunks.");
  if (gltf.extensionsRequired?.length)
    throw new Error(`Unsupported required GLB extensions: ${gltf.extensionsRequired.join(", ")}`);
  return { gltf, binary };
}
