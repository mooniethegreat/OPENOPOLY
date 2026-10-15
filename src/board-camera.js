export const DEFAULT_BOARD_YAW = -2;
const radians = degrees => degrees * Math.PI / 180;
const framingPoints = [
  ...[[-24,-24],[984,-24],[984,984],[-24,984]].map(([x,y]) => ({ x,y,z:0 })),
  ...[[62,62],[898,62],[898,898],[62,898]].map(([x,y]) => ({ x,y,z:85 })),
];

// Translation is inside perspective. Fit the actual 3D corner constraints, with
// the camera and perspective origin centered on the same usable play window.
export function fitBoardWindow(width, height, tilt, yaw = DEFAULT_BOARD_YAW) {
  const points = framingPoints.map(point => projectBoardPoint(point, tilt, yaw));
  const limits = scale => {
    const horizontal = points.map(point => { const factor = 2400 / (2400 - point.z); return { low: -width / (2 * factor) - point.x * scale, high: width / (2 * factor) - point.x * scale }; });
    const vertical = points.map(point => { const factor = 2400 / (2400 - point.z); return { low: -height / (2 * factor) - point.y * scale, high: height / (2 * factor) - point.y * scale }; });
    return { left: Math.max(...horizontal.map(value => value.low)), right: Math.min(...horizontal.map(value => value.high)), top: Math.max(...vertical.map(value => value.low)), bottom: Math.min(...vertical.map(value => value.high)) };
  };
  let low = .01, high = 4;
  for (let index = 0; index < 22; index++) {
    const candidate = (low + high) / 2, bounds = limits(candidate);
    if (bounds.left > bounds.right || bounds.top > bounds.bottom) high = candidate;
    else low = candidate;
  }
  const bounds = limits(low);
  return { scale: low, x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
}

export function keepBoardFocusVisible(camera, point, scale, tilt, yaw, width, height, margin = 38) {
  const projected = projectBoardPoint(point, tilt, yaw), factor = 2400 / (2400 - projected.z);
  const halfWidth = Math.max(1, width / 2 - margin), halfHeight = Math.max(1, height / 2 - margin);
  return { x: Math.min(halfWidth / factor - projected.x * scale, Math.max(-halfWidth / factor - projected.x * scale, camera.x)), y: Math.min(halfHeight / factor - projected.y * scale, Math.max(-halfHeight / factor - projected.y * scale, camera.y)) };
}

// CSS uses rotateX(tilt) rotateZ(yaw): yaw is applied in the table plane first.
export function projectBoardPoint(point, tilt = 48, yaw = DEFAULT_BOARD_YAW) {
  const angle = radians(yaw % 360), pitch = radians(tilt);
  const dx = point.x - 480, dy = point.y - 480, height = point.z || 0;
  const rotatedY = dx * Math.sin(angle) + dy * Math.cos(angle);
  return {
    x: dx * Math.cos(angle) - dy * Math.sin(angle),
    y: rotatedY * Math.cos(pitch) - height * Math.sin(pitch),
    z: rotatedY * Math.sin(pitch) + height * Math.cos(pitch),
  };
}

export function projectedBoardBounds(scale, tilt, yaw = DEFAULT_BOARD_YAW) {
  const distance = 2400;
  const corners = [{ x: -22, y: -22 }, { x: 982, y: -22 }, { x: 982, y: 982 }, { x: -22, y: 982 }].map(point => {
    const projected = projectBoardPoint(point, tilt, yaw);
    // The ancestor uses CSS scale(s), not scale3d: it enlarges X/Y while Z stays unchanged.
    const perspective = distance / (distance - projected.z);
    return { x: projected.x * scale * perspective, y: projected.y * scale * perspective };
  });
  const left = Math.min(...corners.map(point => point.x)), right = Math.max(...corners.map(point => point.x));
  const top = Math.min(...corners.map(point => point.y)), bottom = Math.max(...corners.map(point => point.y));
  return { width: right - left, height: bottom - top, x: (left + right) / 2, y: (top + bottom) / 2 };
}

// Raise a screen-facing label without moving its screen anchor off its own tile.
export function billboardOffset(tilt, yaw, height = 29) {
  const lift = height * Math.tan(radians(tilt)), angle = radians(yaw % 360);
  return { x: lift * Math.sin(angle), y: lift * Math.cos(angle) };
}

export function nearestBoardNorth(yaw) {
  return yaw + ((DEFAULT_BOARD_YAW - yaw + 180) % 360 + 360) % 360 - 180;
}

export function boardHeading(yaw) {
  return ((Math.round(yaw - DEFAULT_BOARD_YAW) % 360) + 360) % 360;
}
