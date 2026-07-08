import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import bhavyaAxisLogo from '@/assets/bhavya-axis-logo.png';
import type { PortalIntent } from '@types';
import {
  bearingFromPoint,
  formatHeadingDisplay,
  reflectOffCircle,
} from './compassMath';

interface BallConfig {
  id: string;
  label: string;
  radius: number;
  mass: number;
  restitution: number;
  friction: number;
  initialNX: number;
  initialNY: number;
  initialVx: number;
  initialVy: number;
  color: string;
  textColor: string;
  borderColor: string;
  glowColor: string;
}

interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface DragState {
  active: boolean;
  bodyId: string | null;
  prevCx: number;
  prevCy: number;
  time: number;
  vx: number;
  vy: number;
}

interface Props {
  activePortal: PortalIntent;
  reducedMotion?: boolean;
}

const BALL_CONFIGS: BallConfig[] = [
  {
    id: 'school', label: 'School',
    radius: 34, mass: 1, restitution: 0.92, friction: 0.02,
    initialNX: 0.30, initialNY: 0.12,
    initialVx: 50, initialVy: 65,
    color: 'radial-gradient(circle at 38% 32%, #3b82f6, #1e40af 70%)',
    textColor: '#fff',
    borderColor: 'rgba(59,130,246,0.15)',
    glowColor: 'rgba(59,130,246,0.4)',
  },
  {
    id: 'student', label: 'Student',
    radius: 34, mass: 1, restitution: 0.90, friction: 0.02,
    initialNX: 0.08, initialNY: 0.38,
    initialVx: -55, initialVy: 75,
    color: 'radial-gradient(circle at 38% 32%, #facc15, #ca8a04 70%)',
    textColor: '#1e293b',
    borderColor: 'rgba(250,204,21,0.15)',
    glowColor: 'rgba(250,204,21,0.4)',
  },
  {
    id: 'parent', label: 'Parent',
    radius: 34, mass: 1, restitution: 0.90, friction: 0.02,
    initialNX: 0.28, initialNY: -0.20,
    initialVx: 65, initialVy: -50,
    color: 'radial-gradient(circle at 38% 32%, #ef4444, #991b1b 70%)',
    textColor: '#fff',
    borderColor: 'rgba(239,68,68,0.15)',
    glowColor: 'rgba(239,68,68,0.4)',
  },
  {
    id: 'logo', label: '',
    radius: 42, mass: 2.5, restitution: 0.94, friction: 0.01,
    initialNX: -0.34, initialNY: -0.24,
    initialVx: -60, initialVy: 85,
    color: 'rgba(255,255,255,0.92)',
    textColor: 'transparent',
    borderColor: 'rgba(249,115,22,0.2)',
    glowColor: 'rgba(249,115,22,0.4)',
  },
];

const DEGREE_LABELS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

const DIRECTIONS = ['N', 'E', 'S', 'W'] as const;
const DIRECTION_ANGLES: Record<string, number> = { N: 0, E: 90, S: 180, W: 270 };

const INSTRUMENT_BAND = 58;
const COLLISION_PADDING = 2;

type GeometryState = 'UNMEASURED' | 'MEASURED' | 'READY';

const WATCH_SCALE_BASE = 174;
const ROMANS = [
  'XII', 'I', 'II', 'III', 'IV', 'V',
  'VI', 'VII', 'VIII', 'IX', 'X', 'XI',
];

const RED_LABELS = [
  '60', '5', '10', '15', '20', '25',
  '30', '35', '40', '45', '50', '55',
];

type AntiqueInnerWatchFaceProps = {
  cx: number;
  cy: number;
  watchR: number;
  realTime: Date;
};

function AntiqueInnerWatchFace({ cx, cy, watchR, realTime }: AntiqueInnerWatchFaceProps) {
  const scale = watchR / WATCH_SCALE_BASE;

  const polar = (radius: number, angleDeg: number) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };

  const outerTicks = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => {
        const angle = i * 6;
        const major = i % 5 === 0;

        return {
          i,
          major,
          p1: polar(watchR - 7, angle),
          p2: polar(watchR - (major ? 18 : 13), angle),
        };
      }),
    [watchR]
  );

  const innerTicks = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => {
        const angle = i * 6;
        const major = i % 5 === 0;

        return {
          i,
          major,
          p1: polar(111 * scale, angle),
          p2: polar(major ? 101 * scale : 105 * scale, angle),
        };
      }),
    [watchR]
  );

  const hourAngleDeg = ((realTime.getHours() % 12 + realTime.getMinutes() / 60 + realTime.getSeconds() / 3600) / 12) * 360;
  const minuteAngleDeg = ((realTime.getMinutes() + realTime.getSeconds() / 60) / 60) * 360;
  const secondAngleDeg = (realTime.getSeconds() / 60) * 360;

  const hourHandR = watchR * 0.60;
  const minuteHandR = watchR * 0.77;
  const secondHandR = watchR * 0.86;

  const hourTip = polar(hourHandR, hourAngleDeg);
  const minuteTip = polar(minuteHandR, minuteAngleDeg);
  const secondTip = polar(secondHandR, secondAngleDeg);

  return (
    <g id="antique-inner-watch" pointerEvents="none">
      <defs>
        <radialGradient id="oldPaper" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#ffffff" />
        </radialGradient>

        <linearGradient id="thinBronze" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#65401f" />
          <stop offset="30%" stopColor="#2b180d" />
          <stop offset="60%" stopColor="#5a3d24" />
          <stop offset="100%" stopColor="#24130b" />
        </linearGradient>
      </defs>

      <circle cx={cx} cy={cy} r={watchR + 5} fill="none" stroke="#2b180d" strokeWidth="5" />
      <circle cx={cx} cy={cy} r={watchR + 1} fill="none" stroke="url(#thinBronze)" strokeWidth="4" />

      <circle cx={cx} cy={cy} r={watchR - 3} fill="#ffffff" stroke="#4a3825" strokeWidth="1.5" />

      <circle cx={cx} cy={cy} r={watchR - 12} fill="none" stroke="#2b241c" strokeWidth="1.2" opacity="0.9" />
      <circle cx={cx} cy={cy} r={watchR - 31} fill="none" stroke="#3c3328" strokeWidth="1" opacity="0.85" />

      <g>
        {outerTicks.map((t) => (
          <line
            key={t.i}
            x1={t.p1.x}
            y1={t.p1.y}
            x2={t.p2.x}
            y2={t.p2.y}
            stroke="#211c17"
            strokeWidth={t.major ? 1.8 : 0.85}
            opacity={t.major ? 0.92 : 0.72}
          />
        ))}
      </g>

      <g fill="#a64a3a" fontFamily="Georgia, 'Times New Roman', serif" fontWeight="600">
        {RED_LABELS.map((label, i) => {
          const angle = i * 30;
          const p = polar(139 * scale, angle);
          return (
            <text key={label} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="11" opacity="0.88" transform={`rotate(${angle} ${p.x} ${p.y})`}>
              {label}
            </text>
          );
        })}
      </g>

      <circle cx={cx} cy={cy} r={127 * scale} fill="none" stroke="#292219" strokeWidth="1.2" />

      <g fill="#211c17" fontFamily="Georgia, 'Times New Roman', serif" fontWeight="700">
        {ROMANS.map((roman, i) => {
          const angle = i * 30;
          const p = polar(119 * scale, angle);
          return (
            <text key={roman} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize={roman.length >= 4 ? 15 : 18} transform={`rotate(${angle} ${p.x} ${p.y})`}>
              {roman}
            </text>
          );
        })}
      </g>

      <circle cx={cx} cy={cy} r={112 * scale} fill="none" stroke="#2b241c" strokeWidth="1.2" />

      <g>
        {innerTicks.map((t) => (
          <line
            key={t.i}
            x1={t.p1.x}
            y1={t.p1.y}
            x2={t.p2.x}
            y2={t.p2.y}
            stroke="#332a20"
            strokeWidth={t.major ? 1.25 : 0.65}
            opacity={t.major ? 0.86 : 0.6}
          />
        ))}
      </g>

      <circle cx={cx} cy={cy} r={97 * scale} fill="none" stroke="#594a38" strokeWidth="0.8" opacity="0.8" />
      <circle cx={cx} cy={cy} r={84 * scale} fill="none" stroke="#665642" strokeWidth="0.7" strokeDasharray="1.5 2.5" opacity="0.65" />

      <path d={`M ${cx} ${cy} L ${hourTip.x} ${hourTip.y}`} fill="none" stroke="#211c17" strokeWidth={4} strokeLinecap="round" />
      <path d={`M ${cx} ${cy} L ${minuteTip.x} ${minuteTip.y}`} fill="none" stroke="#463d31" strokeWidth={2.4} strokeLinecap="round" />
      <path d={`M ${cx} ${cy} L ${secondTip.x} ${secondTip.y}`} fill="none" stroke="#a64a3a" strokeWidth={1.4} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={3.6 * scale} fill="#2b180d" />
      <circle cx={cx} cy={cy} r={2.1 * scale} fill="#d8d0ad" />
    </g>
  );
}

export default function InteractiveCompass({ reducedMotion = false }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const bodiesRef = useRef<BallState[]>([]);
  const configsRef = useRef(BALL_CONFIGS);
  const dragRef = useRef<DragState>({ active: false, bodyId: null, prevCx: 0, prevCy: 0, time: 0, vx: 0, vy: 0 });
  const rafRef = useRef(0);
  const lastTimeRef = useRef(0);
  const reducedRef = useRef(reducedMotion);
  const headingRef = useRef(0);
  reducedRef.current = reducedMotion;

  const [geometry, setGeometry] = useState<GeometryState>('UNMEASURED');
  const [stageW, setStageW] = useState(0);
  const [stageH, setStageH] = useState(0);
  const [headingDegrees, setHeadingDegrees] = useState(0);
  const [realTime, setRealTime] = useState(() => new Date());

  const stageWRef = useRef(0);
  const stageHRef = useRef(0);

  function projectBall(b: BallState, w: number, h: number, ballR: number) {
    const size = Math.min(w, h);
    const cX = w / 2;
    const cY = h / 2;
    const playableR = size / 2 - INSTRUMENT_BAND;
    const maxDist = playableR - ballR - COLLISION_PADDING;
    const dx = b.x - cX;
    const dy = b.y - cY;
    const dist = Math.hypot(dx, dy);
    if (dist > maxDist && dist > 0.001) {
      const scale = maxDist / dist;
      b.x = cX + dx * scale;
      b.y = cY + dy * scale;
    }
  }

  function projectAllBodies(w: number, h: number) {
    const cfg = configsRef.current;
    for (let i = 0; i < bodiesRef.current.length; i++) {
      projectBall(bodiesRef.current[i], w, h, cfg[i].radius);
    }
  }

  function initBodies(w: number, h: number) {
    const cX = w / 2;
    const cY = h / 2;
    const size = Math.min(w, h);
    const playableR = size / 2 - INSTRUMENT_BAND;
    bodiesRef.current = BALL_CONFIGS.map((cfg) => {
      const maxDist = playableR - cfg.radius - COLLISION_PADDING;
      const x = cX + cfg.initialNX * maxDist;
      const y = cY + cfg.initialNY * maxDist;
      return { x, y, vx: cfg.initialVx, vy: cfg.initialVy };
    });
    projectAllBodies(w, h);
  }

  function renderBalls() {
    const bodies = bodiesRef.current;
    const cfg = configsRef.current;
    for (let i = 0; i < cfg.length; i++) {
      const el = document.getElementById(`compass-ball-${cfg[i].id}`);
      if (el) {
        el.style.transform = `translate3d(${bodies[i].x - cfg[i].radius}px, ${bodies[i].y - cfg[i].radius}px, 0)`;
        const isActive = dragRef.current.active && dragRef.current.bodyId === cfg[i].id;
        el.setAttribute('data-active', isActive ? 'true' : '');
      }
    }
  }

  useEffect(() => {
    if (!stageRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        const h = entry.contentBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        const oldW = stageWRef.current;
        const oldH = stageHRef.current;
        stageWRef.current = w;
        stageHRef.current = h;

        if (oldW <= 0 || oldH <= 0) {
          initBodies(w, h);
          setGeometry('READY');
        } else {
          const oldSize = Math.min(oldW, oldH);
          const newSize = Math.min(w, h);
          if (oldSize > 0 && newSize > 0) {
            const scale = newSize / oldSize;
            const oldCX = oldW / 2;
            const oldCY = oldH / 2;
            const newCX = w / 2;
            const newCY = h / 2;
            for (const b of bodiesRef.current) {
              const dx = b.x - oldCX;
              const dy = b.y - oldCY;
              b.x = newCX + dx * scale;
              b.y = newCY + dy * scale;
            }
            projectAllBodies(w, h);
          }
        }
        setStageW(w);
        setStageH(h);
      }
    });
    ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setRealTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (geometry !== 'READY') return;

    if (reducedMotion) {
      for (const b of bodiesRef.current) { b.vx = 0; b.vy = 0; }
      renderBalls();
      return;
    }

    lastTimeRef.current = performance.now();

    function tick(now: number) {
      const dt = Math.min((now - lastTimeRef.current) / 16.667, 3);
      lastTimeRef.current = now;

      const w = stageWRef.current;
      const h = stageHRef.current;
      if (w <= 0 || h <= 0) { rafRef.current = requestAnimationFrame(tick); return; }

      const cX = w / 2;
      const cY = h / 2;
      const size = Math.min(w, h);
      const playableR = size / 2 - INSTRUMENT_BAND;
      const cfg = configsRef.current;
      const bodies = bodiesRef.current;
      const drag = dragRef.current;

      for (let i = 0; i < cfg.length; i++) {
        if (drag.active && drag.bodyId === cfg[i].id) continue;
        const b = bodies[i];
        const c = cfg[i];
        b.vx *= 1 - c.friction * (dt * 0.06);
        b.vy *= 1 - c.friction * (dt * 0.06);
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        const maxDist = playableR - c.radius - COLLISION_PADDING;
        const dx = b.x - cX;
        const dy = b.y - cY;
        const dist = Math.hypot(dx, dy);
        if (dist > maxDist && dist > 0.001) {
          projectBall(b, w, h, c.radius);
          const reflected = reflectOffCircle(b.vx, b.vy, b.x, b.y, cX, cY);
          b.vx = reflected.vx * c.restitution;
          b.vy = reflected.vy * c.restitution;
        }
      }

      for (let i = 0; i < cfg.length; i++) {
        for (let j = i + 1; j < cfg.length; j++) {
          const a = bodies[i];
          const b = bodies[j];
          const ca = cfg[i];
          const cb = cfg[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          const minDist = ca.radius + cb.radius;
          if (dist >= minDist || dist < 0.001) continue;
          const nx = dx / dist;
          const ny = dy / dist;
          const penetration = minDist - dist;
          const invMassA = 1 / ca.mass;
          const invMassB = 1 / cb.mass;
          const invMassSum = invMassA + invMassB;
          const relVx = b.vx - a.vx;
          const relVy = b.vy - a.vy;
          const relVelAlongNormal = relVx * nx + relVy * ny;
          if (relVelAlongNormal > 0) continue;
          const e = Math.min(ca.restitution, cb.restitution);
          const jAmt = -(1 + e) * relVelAlongNormal / invMassSum;
          a.vx -= jAmt * invMassA * nx;
          a.vy -= jAmt * invMassA * ny;
          b.vx += jAmt * invMassB * nx;
          b.vy += jAmt * invMassB * ny;
          const percent = 0.8;
          const slop = 0.5;
          const correction = Math.max(penetration - slop, 0) / invMassSum * percent;
          a.x -= correction * invMassA * nx;
          a.y -= correction * invMassA * ny;
          b.x += correction * invMassB * nx;
          b.y += correction * invMassB * ny;
          projectBall(a, w, h, ca.radius);
          projectBall(b, w, h, cb.radius);
        }
      }

      let bearing = 0;
      if (drag.active && drag.bodyId) {
        const idx = cfg.findIndex((c) => c.id === drag.bodyId);
        if (idx >= 0) {
          bearing = bearingFromPoint(cX, cY, bodies[idx].x, bodies[idx].y);
        }
      }
      headingRef.current = bearing;
      setHeadingDegrees(bearing);

      renderBalls();
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [geometry, reducedMotion]);

  const getStageLocalCoords = useCallback((clientX: number, clientY: number) => {
    if (!stageRef.current) return { x: 0, y: 0 };
    const rect = stageRef.current.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent, bodyId: string) => {
    if (reducedRef.current) return;
    const idx = BALL_CONFIGS.findIndex((c) => c.id === bodyId);
    if (idx < 0) return;
    const el = document.getElementById(`compass-ball-${bodyId}`);
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
    const body = bodiesRef.current[idx];
    const local = getStageLocalCoords(e.clientX, e.clientY);
    dragRef.current = {
      active: true, bodyId,
      prevCx: local.x, prevCy: local.y,
      time: performance.now(),
      vx: body.vx, vy: body.vy,
    };
  }, [getStageLocalCoords]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag.active || !drag.bodyId) return;
    const idx = BALL_CONFIGS.findIndex((c) => c.id === drag.bodyId);
    if (idx < 0) return;
    const body = bodiesRef.current[idx];
    const now = performance.now();
    const dt = Math.max(now - drag.time, 8);
    const local = getStageLocalCoords(e.clientX, e.clientY);
    const dx = local.x - drag.prevCx;
    const dy = local.y - drag.prevCy;
    const instVx = (dx / dt) * 16;
    const instVy = (dy / dt) * 16;
    drag.vx = drag.vx * 0.35 + instVx * 0.65;
    drag.vy = drag.vy * 0.35 + instVy * 0.65;

    const w = stageWRef.current;
    const h = stageHRef.current;
    body.x = local.x;
    body.y = local.y;
    projectBall(body, w, h, BALL_CONFIGS[idx].radius);

    drag.prevCx = local.x;
    drag.prevCy = local.y;
    drag.time = now;
  }, [getStageLocalCoords]);

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    if (drag.active && drag.bodyId) {
      const idx = BALL_CONFIGS.findIndex((c) => c.id === drag.bodyId);
      if (idx >= 0) {
        const maxV = 1200;
        drag.vx = Math.max(-maxV, Math.min(maxV, drag.vx));
        drag.vy = Math.max(-maxV, Math.min(maxV, drag.vy));
        bodiesRef.current[idx].vx = drag.vx;
        bodiesRef.current[idx].vy = drag.vy;
      }
      const el = document.getElementById(`compass-ball-${drag.bodyId}`);
      if (el) el.style.cursor = 'grab';
    }
    dragRef.current = { active: false, bodyId: null, prevCx: 0, prevCy: 0, time: 0, vx: 0, vy: 0 };
  }, []);

  const w = stageW;
  const h = stageH;
  const size = Math.min(w, h);
  const rendered = geometry === 'READY' && size > 0;

  const cX = w / 2;
  const cY = h / 2;
  const compassR = size / 2;
  const innerFaceR = compassR - 4;
  const majorTickOuterR = compassR - 8;
  const majorTickInnerR = compassR - 22;
  const mediumTickOuterR = compassR - 10;
  const mediumTickInnerR = compassR - 21;
  const minorTickOuterR = compassR - 12;
  const minorTickInnerR = compassR - 20;
  const degreeLabelR = compassR - 30;
  const cardinalR = compassR - 42;
  const crosshairHalf = 16;
  const ballPlayableR = compassR - INSTRUMENT_BAND;

  const ticks: { angle: number; tier: 'minor' | 'medium' | 'major' }[] = [];
  for (let deg = 0; deg < 360; deg += 5) {
    let tier: 'minor' | 'medium' | 'major' = 'minor';
    if (deg % 30 === 0) tier = 'major';
    else if (deg % 10 === 0) tier = 'medium';
    ticks.push({ angle: deg, tier });
  }

  const degreeLabelPositions = DEGREE_LABELS.map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return { deg, x: cX + degreeLabelR * Math.sin(rad), y: cY - degreeLabelR * Math.cos(rad) };
  });

  const cardinalPositions = DIRECTIONS.map((dir) => {
    const angle = DIRECTION_ANGLES[dir];
    const rad = (angle * Math.PI) / 180;
    return { label: dir, x: cX + cardinalR * Math.sin(rad), y: cY - cardinalR * Math.cos(rad), isNorth: dir === 'N' };
  });

  const arcR = compassR - 2;
  const arcStartDeg = -32;
  const arcEndDeg = 32;
  const arcStartRad = (arcStartDeg * Math.PI) / 180;
  const arcEndRad = (arcEndDeg * Math.PI) / 180;
  const arcPath = `M ${cX + arcR * Math.sin(arcStartRad)} ${cY - arcR * Math.cos(arcStartRad)} A ${arcR} ${arcR} 0 0 1 ${cX + arcR * Math.sin(arcEndRad)} ${cY - arcR * Math.cos(arcEndRad)}`;

  const markerTipY = cY - compassR + 4;
  const markerBaseY = markerTipY + 14;
  const markerHalf = 9;
  const markerPoints = `${cX},${markerTipY} ${cX - markerHalf},${markerBaseY} ${cX + markerHalf},${markerBaseY}`;

  const heading = headingDegrees;
  const headingDisplay = formatHeadingDisplay(heading);

  const secondAngleDeg = (realTime.getSeconds() / 60) * 360 - 90;
  const minuteAngleDeg = ((realTime.getMinutes() + realTime.getSeconds() / 60) / 60) * 360 - 90;
  const hourAngleDeg = ((realTime.getHours() % 12 + realTime.getMinutes() / 60 + realTime.getSeconds() / 3600) / 12) * 360 - 90;
  const watchOuterR = compassR - 84;
  const watchInnerR = compassR - 120;
  const watchHourHandR = watchOuterR - 24;
  const watchMinuteHandR = watchOuterR - 12;
  const watchSecondHandR = watchOuterR - 8;

  return (
    <div className="compass-shell">
      <div className="compass-heading-display" aria-live="polite">
        <span className="compass-heading-degrees">{rendered ? headingDisplay.full : ''}</span>
      </div>
      <div
        ref={stageRef}
        className="compass-stage"
        role="img"
        aria-label="Interactive compass with portal balls"
      >
        {rendered && (
          <>
            <svg
              className="compass-svg"
              viewBox={`0 0 ${size} ${size}`}
              width={size}
              height={size}
            >
              <defs>
                <filter id="compassShadow" x="-10%" y="-10%" width="120%" height="120%">
                  <feDropShadow dx={0} dy={2} stdDeviation={5} floodColor="rgba(0,0,0,0.18)" />
                </filter>
                <radialGradient id="faceGrad" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#FFFFFF" />
                  <stop offset="65%" stopColor="#F4F6F8" />
                  <stop offset="100%" stopColor="#EEF1F4" />
                </radialGradient>
              </defs>

              <circle
                cx={cX} cy={cY} r={compassR}
                fill="url(#faceGrad)" stroke="rgba(180,190,210,0.35)" strokeWidth={1}
                filter="url(#compassShadow)"
              />

              <circle
                cx={cX} cy={cY} r={innerFaceR}
                fill="url(#faceGrad)" stroke="rgba(200,208,220,0.25)" strokeWidth={0.5}
              />
              <circle cx={cX} cy={cY} r={innerFaceR} fill="url(#faceGrad)" />
              <circle cx={cX} cy={cY} r={compassR - 10} fill="none" stroke="rgba(255,75,35,0.16)" strokeWidth={8} />
              <circle cx={cX} cy={cY} r={compassR - 34} fill="none" stroke="rgba(15,23,42,0.08)" strokeWidth={1} />

              {/* Orange heading arc */}
              <path
                d={arcPath}
                fill="none" stroke="#FF4B23" strokeWidth={4} strokeLinecap="round" opacity={0.9}
              />

              {/* Triangular heading marker */}
              <polygon
                points={markerPoints}
                fill="#FF4B23" opacity={0.95}
              />

              {/* Rotating dial */}
              <g transform={`rotate(${-heading}, ${cX}, ${cY})`}>
                {/* Ticks */}
                {ticks.map((t) => {
                  const rad = (t.angle * Math.PI) / 180;
                  let x1: number, y1: number, x2: number, y2: number;
                  let sw: number, color: string;
                  if (t.tier === 'major') {
                    x1 = cX + majorTickOuterR * Math.sin(rad);
                    y1 = cY - majorTickOuterR * Math.cos(rad);
                    x2 = cX + majorTickInnerR * Math.sin(rad);
                    y2 = cY - majorTickInnerR * Math.cos(rad);
                    sw = 2; color = 'rgba(55,61,70,0.7)';
                  } else if (t.tier === 'medium') {
                    x1 = cX + mediumTickOuterR * Math.sin(rad);
                    y1 = cY - mediumTickOuterR * Math.cos(rad);
                    x2 = cX + mediumTickInnerR * Math.sin(rad);
                    y2 = cY - mediumTickInnerR * Math.cos(rad);
                    sw = 1.2; color = 'rgba(55,61,70,0.45)';
                  } else {
                    x1 = cX + minorTickOuterR * Math.sin(rad);
                    y1 = cY - minorTickOuterR * Math.cos(rad);
                    x2 = cX + minorTickInnerR * Math.sin(rad);
                    y2 = cY - minorTickInnerR * Math.cos(rad);
                    sw = 0.6; color = 'rgba(70,76,86,0.25)';
                  }
                  return (
                    <line key={`t-${t.angle}`} x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={color} strokeWidth={sw} />
                  );
                })}

                {/* Degree labels */}
                {degreeLabelPositions.map(({ deg, x, y }) => (
                  <text key={`d-${deg}`} x={x} y={y} textAnchor="middle" dominantBaseline="central"
                    fill="#34383F" fontSize={deg === 0 ? 12 : 10}
                    fontWeight={deg === 0 ? 700 : 500}
                    fontFamily="'Nunito', 'DM Sans', sans-serif">
                    {deg}
                  </text>
                ))}

                {/* Cardinal letters */}
                {cardinalPositions.map(({ label, x, y, isNorth }) => (
                  <text key={`c-${label}`} x={x} y={y} textAnchor="middle" dominantBaseline="central"
                    fill={isNorth ? '#FF4B23' : '#4A4F57'}
                    fontSize={22} fontWeight={800}
                    fontFamily="'Nunito', 'DM Sans', sans-serif"
                    letterSpacing="0.5">
                    {label}
                  </text>
                ))}
              </g>

              {/* Antique inner watch (white face) */}
              {(() => {
                const watchR = innerFaceR - 5;
                return <AntiqueInnerWatchFace cx={cX} cy={cY} watchR={watchR} realTime={realTime} />;
              })()}

              {/* Crosshair (fixed) */}
              <line x1={cX - crosshairHalf} y1={cY} x2={cX + crosshairHalf} y2={cY}
                stroke="#4A4F57" strokeWidth={1} opacity={0.3} />
              <line x1={cX} y1={cY - crosshairHalf} x2={cX} y2={cY + crosshairHalf}
                stroke="#4A4F57" strokeWidth={1} opacity={0.3} />
              <circle cx={cX} cy={cY} r={2.5} fill="#4A4F57" opacity={0.5} />

              {/* Playable boundary */}
              <circle cx={cX} cy={cY} r={ballPlayableR}
                fill="none" stroke="rgba(160,170,190,0.3)" strokeWidth={0.5} strokeDasharray="3 5" />
            </svg>

            {/* Ball layer */}
            <div className="compass-ball-layer">
              {BALL_CONFIGS.map((config, i) => {
                const body = bodiesRef.current[i];
                const isLogo = config.id === 'logo';
                return (
                  <div
                    key={config.id}
                    id={`compass-ball-${config.id}`}
                    className="compass-ball"
                    data-kind={isLogo ? 'logo' : 'coin'}
                    role="button"
                    tabIndex={0}
                    aria-label={isLogo ? 'Brand logo ball' : `${config.label} portal ball`}
                    onPointerDown={(e) => handlePointerDown(e, config.id)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    style={{
                      width: config.radius * 2,
                      height: config.radius * 2,
                      background: isLogo ? undefined : config.color,
                      color: config.textColor,
                      borderColor: config.borderColor,
                      cursor: 'grab',
                      touchAction: 'none',
                      willChange: 'transform',
                      transform: body
                        ? `translate3d(${body.x - config.radius}px, ${body.y - config.radius}px, 0)`
                        : undefined,
                    } as React.CSSProperties}
                  >
                    {isLogo && (
                      <img src={bhavyaAxisLogo} alt="" className="compass-ball-logo-img" draggable={false} />
                    )}
                    {!isLogo && (
                      <span className="compass-ball-label">{config.label}</span>
                    )}
                  </div>
                );
              })}
            </div>

          </>
        )}
      </div>
    </div>
  );
}
