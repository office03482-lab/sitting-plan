import { describe, it, expect } from 'vitest';
import {
  bearingFromPoint,
  bearingToDirection,
  clampToCircle,
  reflectOffCircle,
  clampBallToCircle,
  shortestAngleDelta,
  formatHeadingDisplay,
  createCompassGeometry,
  projectBallInsidePlayableCircle,
  createInitialBallStates,
  remapBallStatesToGeometry,
  parsePersistedCompassState,
  getBallRenderTransform,
  toStageLocalPoint,
  getCompassDialRotation,
} from '@components/login/compassMath';

describe('compassMath', () => {
  describe('bearingFromPoint', () => {
    it('1. bearing North = 0°', () => {
      const b = bearingFromPoint(200, 200, 200, 50);
      expect(b).toBeCloseTo(0, 0);
    });

    it('2. bearing East = 90°', () => {
      const b = bearingFromPoint(200, 200, 350, 200);
      expect(b).toBeCloseTo(90, 0);
    });

    it('3. bearing South = 180°', () => {
      const b = bearingFromPoint(200, 200, 200, 350);
      expect(b).toBeCloseTo(180, 0);
    });

    it('4. bearing West = 270°', () => {
      const b = bearingFromPoint(200, 200, 50, 200);
      expect(b).toBeCloseTo(270, 0);
    });

    it('NE = ~45°', () => {
      const b = bearingFromPoint(200, 200, 350, 50);
      expect(b).toBeCloseTo(45, 0);
    });

    it('SE = ~135°', () => {
      const b = bearingFromPoint(200, 200, 350, 350);
      expect(b).toBeCloseTo(135, 0);
    });

    it('SW = ~225°', () => {
      const b = bearingFromPoint(200, 200, 50, 350);
      expect(b).toBeCloseTo(225, 0);
    });

    it('NW = ~315°', () => {
      const b = bearingFromPoint(200, 200, 50, 50);
      expect(b).toBeCloseTo(315, 0);
    });
  });

  describe('bearingToDirection', () => {
    it('5. 0° → N', () => {
      expect(bearingToDirection(0)).toBe('N');
    });

    it('6. 45° → NE', () => {
      expect(bearingToDirection(45)).toBe('NE');
    });

    it('7. 90° → E', () => {
      expect(bearingToDirection(90)).toBe('E');
    });

    it('8. 135° → SE', () => {
      expect(bearingToDirection(135)).toBe('SE');
    });

    it('180° → S', () => {
      expect(bearingToDirection(180)).toBe('S');
    });

    it('225° → SW', () => {
      expect(bearingToDirection(225)).toBe('SW');
    });

    it('270° → W', () => {
      expect(bearingToDirection(270)).toBe('W');
    });

    it('315° → NW', () => {
      expect(bearingToDirection(315)).toBe('NW');
    });

    it('9. 359° → N', () => {
      expect(bearingToDirection(359)).toBe('N');
    });

    it('10. 0° → N (exact boundary)', () => {
      expect(bearingToDirection(0)).toBe('N');
    });

    it('11. 22.4° → N (below 22.5 boundary)', () => {
      expect(bearingToDirection(22.4)).toBe('N');
    });

    it('337.5° → N', () => {
      expect(bearingToDirection(337.5)).toBe('N');
    });

    it('22.5° → NE (exact boundary lower)', () => {
      expect(bearingToDirection(22.5)).toBe('NE');
    });

    it('67.5° → E (exact boundary upper for NE → E)', () => {
      expect(bearingToDirection(67.5)).toBe('E');
    });

    it('292.5° → NW (exact boundary lower)', () => {
      expect(bearingToDirection(292.5)).toBe('NW');
    });

    it('337.4° → NW (upper bound)', () => {
      expect(bearingToDirection(337.4)).toBe('NW');
    });

    it('360° → N (wraps)', () => {
      const b = ((360 % 360) + 360) % 360;
      expect(bearingToDirection(b)).toBe('N');
    });
  });

  describe('clampToCircle', () => {
    it('12. point inside circle stays unchanged', () => {
      const r = clampToCircle(200, 200, 200, 200, 100);
      expect(r.x).toBe(200);
      expect(r.y).toBe(200);
    });

    it('13. point outside circle projected to boundary', () => {
      const r = clampToCircle(350, 200, 200, 200, 100);
      expect(r.x).toBeCloseTo(300, 0);
      expect(r.y).toBeCloseTo(200, 0);
    });

    it('ball center never exceeds maxCenterDist', () => {
      const r = clampToCircle(200, 0, 200, 200, 50);
      const dx = r.x - 200;
      const dy = r.y - 200;
      const dist = Math.sqrt(dx * dx + dy * dy);
      expect(dist).toBeLessThanOrEqual(50.001);
    });
  });

  describe('clampBallToCircle', () => {
    it('14. respects ball radius in projection', () => {
      const r = clampBallToCircle(350, 200, 200, 200, 100, 34);
      const dx = r.x - 200;
      const dy = r.y - 200;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxLegal = 100 - 34 - 1;
      expect(dist).toBeLessThanOrEqual(maxLegal + 0.001);
    });
  });

  describe('reflectOffCircle', () => {
    it('15. velocity reflected correctly at circular boundary', () => {
      const result = reflectOffCircle(100, 0, 300, 200, 200, 200);
      expect(result.vx).toBeLessThan(0);
      expect(result.vy).toBeCloseTo(0, 0);
    });

    it('reflects with damping', () => {
      const result = reflectOffCircle(100, 0, 300, 200, 200, 200, 0.5);
      expect(Math.abs(result.vx)).toBeLessThan(100);
      expect(result.vy).toBeCloseTo(0, 0);
    });

    it('moving inward from boundary is not reflected', () => {
      const result = reflectOffCircle(-100, 0, 300, 200, 200, 200);
      expect(result.vx).toBe(-100);
    });
  });

  describe('shortestAngleDelta', () => {
    it('shortest path from 350 to 10 is 20°', () => {
      expect(shortestAngleDelta(350, 10)).toBeCloseTo(20, 0);
    });

    it('shortest path from 10 to 350 is -20°', () => {
      expect(shortestAngleDelta(10, 350)).toBeCloseTo(-20, 0);
    });
  });

  describe('no rectangular clamp remnants', () => {
    it('17. clampToCircle uses circular geometry, not rectangular', () => {
      const r = clampToCircle(300, 300, 200, 200, 50);
      const dx = r.x - 200;
      const dy = r.y - 200;
      const dist = Math.sqrt(dx * dx + dy * dy);
      expect(dist).toBeLessThanOrEqual(50.001);
      expect(r.x).not.toBe(250);
      expect(r.y).not.toBe(250);
    });
  });

  describe('formatHeadingDisplay', () => {
    it('formats 0° as "0° N"', () => {
      const result = formatHeadingDisplay(0);
      expect(result.full).toBe('0° N');
      expect(result.degrees).toBe('0°');
      expect(result.direction).toBe('N');
    });

    it('formats 90° as "90° E"', () => {
      const result = formatHeadingDisplay(90);
      expect(result.full).toBe('90° E');
      expect(result.direction).toBe('E');
    });

    it('formats 180° as "180° S"', () => {
      const result = formatHeadingDisplay(180);
      expect(result.full).toBe('180° S');
    });

    it('formats 270° as "270° W"', () => {
      const result = formatHeadingDisplay(270);
      expect(result.full).toBe('270° W');
    });

    it('formats 45° as "45° NE"', () => {
      const result = formatHeadingDisplay(45);
      expect(result.full).toBe('45° NE');
    });

    it('formats 140° as "140° SE"', () => {
      const result = formatHeadingDisplay(140);
      expect(result.full).toBe('140° SE');
    });

    it('formats 315° as "315° NW"', () => {
      const result = formatHeadingDisplay(315);
      expect(result.full).toBe('315° NW');
    });

    it('rounds decimal degrees', () => {
      const result = formatHeadingDisplay(45.7);
      expect(result.degrees).toBe('46°');
    });
  });

  describe('geometry containment helpers', () => {
    const geometry = createCompassGeometry(400, 400, 56);
    const configs = [
      { id: 'school', radius: 34, initialNX: 0.30, initialNY: 0.12 },
      { id: 'student', radius: 34, initialNX: 0.08, initialNY: 0.38 },
      { id: 'parent', radius: 34, initialNX: 0.28, initialNY: -0.20 },
      { id: 'logo', radius: 42, initialNX: -0.34, initialNY: -0.24 },
    ];

    it('creates initial states that stay inside the playable circle', () => {
      const balls = createInitialBallStates(configs, geometry);
      balls.forEach((ball) => {
        const dx = ball.x - geometry.centerX;
        const dy = ball.y - geometry.centerY;
        const dist = Math.hypot(dx, dy);
        expect(dist).toBeLessThanOrEqual(geometry.playableRadius - ball.radius - 1 + 0.001);
      });
    });

    it('projects a ball to the north edge', () => {
      const ball = projectBallInsidePlayableCircle({ x: geometry.centerX, y: geometry.centerY - geometry.playableRadius - 20, vx: 0, vy: 0, radius: 20 }, geometry);
      expect(ball.y).toBeCloseTo(geometry.centerY - (geometry.playableRadius - 20 - 1), 0);
    });

    it('projects a ball to the east edge', () => {
      const ball = projectBallInsidePlayableCircle({ x: geometry.centerX + geometry.playableRadius + 20, y: geometry.centerY, vx: 0, vy: 0, radius: 20 }, geometry);
      expect(ball.x).toBeCloseTo(geometry.centerX + (geometry.playableRadius - 20 - 1), 0);
    });

    it('projects a ball to the south edge', () => {
      const ball = projectBallInsidePlayableCircle({ x: geometry.centerX, y: geometry.centerY + geometry.playableRadius + 20, vx: 0, vy: 0, radius: 20 }, geometry);
      expect(ball.y).toBeCloseTo(geometry.centerY + (geometry.playableRadius - 20 - 1), 0);
    });

    it('projects a ball to the west edge', () => {
      const ball = projectBallInsidePlayableCircle({ x: geometry.centerX - geometry.playableRadius - 20, y: geometry.centerY, vx: 0, vy: 0, radius: 20 }, geometry);
      expect(ball.x).toBeCloseTo(geometry.centerX - (geometry.playableRadius - 20 - 1), 0);
    });

    it('remaps positions when geometry changes', () => {
      const previous = createCompassGeometry(400, 400, 56);
      const next = createCompassGeometry(300, 300, 42);
      const balls = createInitialBallStates(configs, previous);
      const remapped = remapBallStatesToGeometry(balls, previous, next);
      remapped.forEach((ball) => {
        const dx = ball.x - next.centerX;
        const dy = ball.y - next.centerY;
        const dist = Math.hypot(dx, dy);
        expect(dist).toBeLessThanOrEqual(next.playableRadius - ball.radius - 1 + 0.001);
      });
    });

    it('rejects old persisted coordinate formats', () => {
      expect(parsePersistedCompassState('{"version":1,"balls":[]}')).toBeNull();
      expect(parsePersistedCompassState('{"version":2,"positions":[]}')).toBeNull();
      expect(parsePersistedCompassState('not-json')).toBeNull();
    });

    it('renders balls with a single radius subtraction', () => {
      const transform = getBallRenderTransform(123, 87, 34);
      expect(transform).toBe('translate3d(89px, 53px, 0)');
    });

    it('converts pointer coordinates to the stage-local frame', () => {
      const point = toStageLocalPoint(260, 180, { left: 40, top: 20, width: 320, height: 320 });
      expect(point).toEqual({ x: 220, y: 160 });
    });

    it('rotates the dial by the negative heading', () => {
      expect(getCompassDialRotation(140)).toBe(-140);
    });
  });
});
