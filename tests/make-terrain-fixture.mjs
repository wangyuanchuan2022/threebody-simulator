// Generates a minimal valid GLB terrain fixture (displaced grid, no textures)
// for the browser test of the GLTFLoader terrain path. Run: node tests/make-terrain-fixture.mjs
import fs from 'node:fs';
import path from 'node:path';

const N = 40, HALF = 500;
const positions = [], indices = [];
const height = (x, z) =>
  90 * Math.exp(-((x * .6) ** 2 + (z - 200) ** 2) / 90000)
  + 60 * Math.exp(-((x + 300) ** 2 + (z + 250) ** 2) / 60000)
  + 35 * Math.sin(x * .013) * Math.cos(z * .011);
for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
  const x = -HALF + 2 * HALF * i / N, z = -HALF + 2 * HALF * j / N;
  positions.push(x, height(x, z) - 40, z);
}
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
  indices.push(a, c, b, b, c, d);
}
const posBuf = Buffer.from(new Float32Array(positions).buffer);
const idxBuf = Buffer.from(new Uint32Array(indices).buffer);
const pad4 = (buf, fill) => {
  const r = buf.length % 4;
  return r ? Buffer.concat([buf, Buffer.alloc(4 - r, fill)]) : buf;
};
const posView = pad4(posBuf, 0), idxView = pad4(idxBuf, 0);
let minY = Infinity, maxY = -Infinity;
for (let k = 1; k < positions.length; k += 3) { minY = Math.min(minY, positions[k]); maxY = Math.max(maxY, positions[k]); }
const gltf = {
  asset: { version: '2.0', generator: 'threebody-website fixture' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
  materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.36, 0.31, 0.26, 1], metallicFactor: 0, roughnessFactor: 1 } }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: [-HALF, minY, -HALF], max: [HALF, maxY, HALF] },
    { bufferView: 1, componentType: 5125, count: indices.length, type: 'SCALAR', min: [0], max: [indices.length - 1] }
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 },
    { buffer: 0, byteOffset: posView.length, byteLength: idxBuf.length, target: 34963 }
  ],
  buffers: [{ byteLength: posView.length + idxView.length }]
};
const jsonBuf = pad4(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
const total = 12 + 8 + jsonBuf.length + 8 + posView.length + idxView.length;
const glb = Buffer.alloc(total);
glb.writeUInt32LE(0x46546C67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(total, 8);
glb.writeUInt32LE(jsonBuf.length, 12); glb.writeUInt32LE(0x4E4F534A, 16); jsonBuf.copy(glb, 20);
let o = 20 + jsonBuf.length;
glb.writeUInt32LE(posView.length + idxView.length, o); glb.writeUInt32LE(0x004E4942, o + 4); o += 8;
posView.copy(glb, o); idxView.copy(glb, o + posView.length);
const out = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'fixtures', 'terrain.glb');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, glb);
console.log('[FIXTURE] ' + out + ' ' + glb.length + ' bytes, ' + positions.length / 3 + ' verts, ' + indices.length / 3 + ' tris');
