export type Direction =
  | 'N' | 'NE' | 'E' | 'SE'
  | 'S' | 'SW' | 'W' | 'NW';

export function bearingFromPoint(
  cx: number, cy: number,
  px: number, py: number,
): number {
  const dx = px - cx;
  const dy = py - cy;
  const rad = Math.atan2(dx, -dy);
  return ((rad * 180) / Math.PI + 360) % 360;
}

export function bearingToDirection(bearing: number): Direction {
  const b = ((bearing % 360) + 360) % 360;
  if (b >= 337.5 || b < 22.5) return 'N';
  if (b < 67.5) return 'NE';
  if (b < 112.5) return 'E';
  if (b < 157.5) return 'SE';
  if (b < 202.5) return 'S';
  if (b < 247.5) return 'SW';
  if (b < 292.5) return 'W';
  return 'NW';
}

export function bearingToDegrees(bearing: number): string {
  return `${Math.round(bearing)}°`;
}

export function formatHeadingDisplay(bearing: number): {
  degrees: string;
  direction: Direction;
  full: string;
} {
  const dir = bearingToDirection(bearing);
  const deg = `${Math.round(bearing)}°`;
  return { degrees: deg, direction: dir, full: `${deg} ${dir}` };
}

export interface CircleBounds {
  cx: number;
  cy: number;
  radius: number;
}

export function clampToCircle(
  px: number, py: number,
  centerX: number, centerY: number,
  maxCenterDist: number,
): { x: number; y: number } {
  const dx = px - centerX;
  const dy = py - centerY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= maxCenterDist) return { x: px, y: py };
  const scale = maxCenterDist / dist;
  return {
    x: centerX + dx * scale,
    y: centerY + dy * scale,
  };
}

export function reflectOffCircle(
  vx: number, vy: number,
  px: number, py: number,
  centerX: number, centerY: number,
  damping = 0.98,
): { vx: number; vy: number } {
  const dx = px - centerX;
  const dy = py - centerY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return { vx, vy };
  const nx = dx / dist;
  const ny = dy / dist;
  const dot = vx * nx + vy * ny;
  if (dot <= 0) return { vx, vy };
  return {
    vx: (vx - 2 * dot * nx) * damping,
    vy: (vy - 2 * dot * ny) * damping,
  };
}

export function shortestAngleDelta(current: number, target: number): number {
  return ((target - current + 540) % 360) - 180;
}

export function interpolateAngle(
  current: number,
  target: number,
  speed: number,
): number {
  const delta = shortestAngleDelta(current, target);
  if (Math.abs(delta) < 0.5) return target;
  return current + delta * speed;
}

export function clampBallToCircle(
  px: number, py: number,
  centerX: number, centerY: number,
  playableRadius: number,
  ballRadius: number,
  safetyPadding = 1,
): { x: number; y: number } {
  const maxCenterDist = playableRadius - ballRadius - safetyPadding;
  return clampToCircle(px, py, centerX, centerY, maxCenterDist);
}

export interface CompassGeometry {
  stageWidth: number;
  stageHeight: number;
  centerX: number;
  centerY: number;
  stageSize: number;
  compassRadius: number;
  instrumentBand: number;
  playableRadius: number;
  collisionPadding: number;
}

export interface CompassBallState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface CompassBallConfigShape {
  id: string;
  radius: number;
  initialNX: number;
  initialNY: number;
}

export function createCompassGeometry(
  stageWidth: number,
  stageHeight: number,
  instrumentBand = 56,
  collisionPadding = 1,
): CompassGeometry {
  const stageSize = Math.min(Math.max(stageWidth, 1), Math.max(stageHeight, 1));
  const centerX = stageWidth / 2;
  const centerY = stageHeight / 2;
  const compassRadius = stageSize / 2;
  const playableRadius = compassRadius - instrumentBand;
  return {
    stageWidth,
    stageHeight,
    centerX,
    centerY,
    stageSize,
    compassRadius,
    instrumentBand,
    playableRadius,
    collisionPadding,
  };
}

export function projectBallInsidePlayableCircle(
  ball: { id?: string; x: number; y: number; vx?: number; vy?: number; radius?: number },
  geometry: CompassGeometry,
): { id?: string; x: number; y: number; vx?: number; vy?: number; radius?: number } {
  const radius = ball.radius ?? 0;
  const maxCenterDistance = geometry.playableRadius - radius - geometry.collisionPadding;
  const dx = ball.x - geometry.centerX;
  const dy = ball.y - geometry.centerY;
  const distance = Math.hypot(dx, dy);
  if (distance <= maxCenterDistance || distance <= 0.001) {
    return { ...ball };
  }
  const scale = maxCenterDistance / distance;
  return {
    ...ball,
    x: geometry.centerX + dx * scale,
    y: geometry.centerY + dy * scale,
  };
}

export function createInitialBallStates(
  configs: CompassBallConfigShape[],
  geometry: CompassGeometry,
): CompassBallState[] {
  return configs.map((config) => {
    const x = geometry.centerX + config.initialNX * geometry.playableRadius;
    const y = geometry.centerY + config.initialNY * geometry.playableRadius;
    return projectBallInsidePlayableCircle({
      id: config.id,
      x,
      y,
      vx: 0,
      vy: 0,
      radius: config.radius,
    }, geometry);
  }) as CompassBallState[];
}

export function remapBallStatesToGeometry(
  balls: CompassBallState[],
  previousGeometry: CompassGeometry,
  nextGeometry: CompassGeometry,
): CompassBallState[] {
  return balls.map((ball) => {
    const scaleX = nextGeometry.stageWidth / Math.max(previousGeometry.stageWidth, 1);
    const scaleY = nextGeometry.stageHeight / Math.max(previousGeometry.stageHeight, 1);
    const x = nextGeometry.centerX + (ball.x - previousGeometry.centerX) * scaleX;
    const y = nextGeometry.centerY + (ball.y - previousGeometry.centerY) * scaleY;
    return projectBallInsidePlayableCircle({ ...ball, x, y }, nextGeometry) as CompassBallState;
  });
}

export interface PersistedCompassState {
  version: 2;
  balls: Array<{ id: string; x: number; y: number; vx: number; vy: number; radius: number }>;
}

export function parsePersistedCompassState(raw: string | null | undefined): PersistedCompassState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedCompassState>;
    if (parsed?.version !== 2 && parsed?.version !== 3) return null;
    if (!Array.isArray(parsed.balls)) return null;
    return { version: 2, balls: parsed.balls.filter((ball): ball is PersistedCompassState['balls'][number] => Boolean(ball && typeof ball.id === 'string')) };
  } catch {
    return null;
  }
}

export function getBallRenderTransform(x: number, y: number, radius: number): string {
  return `translate3d(${x - radius}px, ${y - radius}px, 0)`;
}

export function toStageLocalPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }) {
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

export function getCompassDialRotation(headingDegrees: number): number {
  return -headingDegrees;
}
