import { useRef, useEffect, useCallback, RefObject } from 'react';

export interface BodyConfig {
  id: string;
  kind: 'coin' | 'striker';
  label: string;
  radius: number;
  mass: number;
  restitution: number;
  friction: number;
  initialX: number;
  initialY: number;
  initialVx: number;
  initialVy: number;
}

interface BodyState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface DragInfo {
  active: boolean;
  bodyId: string | null;
  px: number;
  py: number;
  time: number;
  vx: number;
  vy: number;
}

interface UseCarromPhysicsOptions {
  wallPadding?: number;
  activeBodyId?: string | null;
  reducedMotion?: boolean;
}

export function useCarromPhysics(
  surfaceRef: RefObject<HTMLDivElement | null>,
  configs: BodyConfig[],
  options: UseCarromPhysicsOptions = {},
) {
  const { wallPadding = 8, activeBodyId = null, reducedMotion = false } = options;

  const configsRef = useRef(configs);
  configsRef.current = configs;

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const activeIdRef = useRef(activeBodyId);
  activeIdRef.current = activeBodyId;

  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  const bodiesRef = useRef<BodyState[]>([]);
  const elementRefsRef = useRef<Map<string, RefObject<HTMLDivElement | null>>>(new Map());
  const boundsRef = useRef({ width: 0, height: 0 });
  const dragRef = useRef<DragInfo>({ active: false, bodyId: null, px: 0, py: 0, time: 0, vx: 0, vy: 0 });
  const rafRef = useRef(0);
  const initializedRef = useRef(false);

  if (!initializedRef.current || bodiesRef.current.length !== configs.length) {
    bodiesRef.current = configs.map((c) => ({
      x: c.initialX,
      y: c.initialY,
      vx: c.initialVx,
      vy: c.initialVy,
    }));
    initializedRef.current = true;
  }

  configs.forEach((c) => {
    if (!elementRefsRef.current.has(c.id)) {
      elementRefsRef.current.set(c.id, { current: null } as RefObject<HTMLDivElement | null>);
    }
  });

  const elRefs = new Map<string, RefObject<HTMLDivElement | null>>();
  configs.forEach((c) => {
    elRefs.set(c.id, elementRefsRef.current.get(c.id)!);
  });

  const updateBounds = useCallback(() => {
    if (surfaceRef.current) {
      const rect = surfaceRef.current.getBoundingClientRect();
      boundsRef.current = { width: rect.width, height: rect.height };
    }
  }, [surfaceRef]);

  const clampBodies = useCallback(() => {
    const bw = boundsRef.current.width;
    const bh = boundsRef.current.height;
    if (bw <= 0 || bh <= 0) return;
    const cfg = configsRef.current;
    const bodies = bodiesRef.current;
    for (let i = 0; i < bodies.length && i < cfg.length; i++) {
      const r = cfg[i].radius;
      const minX = r + wallPadding;
      const maxX = bw - r - wallPadding;
      const minY = r + wallPadding;
      const maxY = bh - r - wallPadding;
      bodies[i].x = Math.max(minX, Math.min(maxX, bodies[i].x));
      bodies[i].y = Math.max(minY, Math.min(maxY, bodies[i].y));
    }
  }, [wallPadding]);

  useEffect(() => {
    if (!surfaceRef.current) return;
    updateBounds();
    clampBodies();

    const ro = new ResizeObserver(() => {
      updateBounds();
      clampBodies();
    });
    ro.observe(surfaceRef.current);

    return () => {
      ro.disconnect();
    };
  }, [surfaceRef, updateBounds, clampBodies]);

  useEffect(() => {
    if (reducedMotion) {
      const bodies = bodiesRef.current;
      bodies.forEach((b) => { b.vx = 0; b.vy = 0; });
      configsRef.current.forEach((c, i) => {
        const el = elementRefsRef.current.get(c.id)?.current;
        if (el && i < bodies.length) {
          el.style.transform = `translate3d(${bodies[i].x}px, ${bodies[i].y}px, 0)`;
        }
      });
      return;
    }

    let lastTime = performance.now();

    function tick(now: number) {
      const dt = Math.min((now - lastTime) / 16.667, 3);
      lastTime = now;

      const bw = boundsRef.current.width;
      const bh = boundsRef.current.height;
      if (bw <= 0 || bh <= 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const cfg = configsRef.current;
      const bodies = bodiesRef.current;
      const drag = dragRef.current;
      const padding = optionsRef.current.wallPadding ?? 8;
      const currentActive = activeIdRef.current;

      for (let i = 0; i < cfg.length; i++) {
        const body = bodies[i];
        const config = cfg[i];

        if (drag.active && drag.bodyId === config.id) {
          continue;
        }

        body.vx *= 1 - config.friction * (dt * 0.06);
        body.vy *= 1 - config.friction * (dt * 0.06);

        body.x += body.vx * dt;
        body.y += body.vy * dt;

        const r = config.radius;
        const minX = r + padding;
        const maxX = bw - r - padding;
        const minY = r + padding;
        const maxY = bh - r - padding;

        if (body.x - r < minX) {
          body.x = minX + r;
          body.vx = Math.abs(body.vx) * config.restitution;
        } else if (body.x + r > maxX) {
          body.x = maxX - r;
          body.vx = -Math.abs(body.vx) * config.restitution;
        }

        if (body.y - r < minY) {
          body.y = minY + r;
          body.vy = Math.abs(body.vy) * config.restitution;
        } else if (body.y + r > maxY) {
          body.y = maxY - r;
          body.vy = -Math.abs(body.vy) * config.restitution;
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
          const dist = Math.sqrt(dx * dx + dy * dy);
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
        }
      }

      for (let i = 0; i < cfg.length; i++) {
        const el = elementRefsRef.current.get(cfg[i].id)?.current;
        if (el) {
          el.style.transform = `translate3d(${bodies[i].x}px, ${bodies[i].y}px, 0)`;
          if (currentActive === cfg[i].id) {
            el.setAttribute('data-active', 'true');
          } else {
            el.removeAttribute('data-active');
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [reducedMotion]);

  const handlePointerDown = useCallback((e: React.PointerEvent, bodyId: string) => {
    if (reducedMotionRef.current) return;
    const cfg = configsRef.current;
    const idx = cfg.findIndex((c) => c.id === bodyId);
    if (idx < 0) return;
    const el = elementRefsRef.current.get(bodyId)?.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
    const body = bodiesRef.current[idx];
    dragRef.current = {
      active: true, bodyId,
      px: e.clientX, py: e.clientY,
      time: performance.now(),
      vx: body.vx, vy: body.vy,
    };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag.active || !drag.bodyId) return;
    const cfg = configsRef.current;
    const idx = cfg.findIndex((c) => c.id === drag.bodyId);
    if (idx < 0) return;
    const body = bodiesRef.current[idx];
    const now = performance.now();
    const dt = Math.max(now - drag.time, 8);
    const dx = e.clientX - drag.px;
    const dy = e.clientY - drag.py;

    const instVx = (dx / dt) * 16;
    const instVy = (dy / dt) * 16;
    drag.vx = drag.vx * 0.35 + instVx * 0.65;
    drag.vy = drag.vy * 0.35 + instVy * 0.65;

    body.x += dx;
    body.y += dy;
    drag.px = e.clientX;
    drag.py = e.clientY;
    drag.time = now;
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag.active && drag.bodyId) {
      const cfg = configsRef.current;
      const idx = cfg.findIndex((c) => c.id === drag.bodyId);
      if (idx >= 0) {
        bodiesRef.current[idx].vx = drag.vx;
        bodiesRef.current[idx].vy = drag.vy;
      }
      const el = elementRefsRef.current.get(drag.bodyId)?.current;
      if (el) el.style.cursor = 'grab';
    }
    dragRef.current = { active: false, bodyId: null, px: 0, py: 0, time: 0, vx: 0, vy: 0 };
  }, []);

  return {
    elementRefs: elRefs,
    updateBounds,
    clampBodies,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}
