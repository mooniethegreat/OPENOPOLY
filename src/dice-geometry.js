const ORIENTATIONS = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
const radians = angle => angle * Math.PI / 180;

/** Cube rotation and exact support height above its local board plane. */
export function dicePose({ value = 1, rolling = false, progress = 0, index = 0, size = 56 } = {}) {
  const orientation = ORIENTATIONS[value] || ORIENTATIONS[1];
  const remaining = rolling ? Math.pow(1 - Math.min(1, Math.max(0, progress)), 1.5) : 0;
  // The resting face is parallel to the table; the scene camera supplies the viewing angle.
  const x = orientation[0] + remaining * (900 + index * 360);
  const y = orientation[1] + remaining * 1080;
  const z = index ? 12 : -10;
  const a = radians(x), b = radians(y);
  // Third row of Rz * Rx * Ry, matching CSS transform order. Its absolute sum
  // gives the maximum downward extent of all eight rotated cube vertices.
  const zx = -Math.cos(a) * Math.sin(b);
  const zy = Math.sin(a);
  const zz = Math.cos(a) * Math.cos(b);
  const supportHeight = size / 2 * (Math.abs(zx) + Math.abs(zy) + Math.abs(zz));
  return { x, y, z, supportHeight, height: supportHeight + 1 };
}
