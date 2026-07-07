import { useRef, useEffect } from 'react';
import bhavyaAxisLogo from '@/assets/bhavya-axis-logo.png';
import { useCarromPhysics, BodyConfig } from './hooks/useCarromPhysics';
import type { PortalIntent } from '@types';

interface Props {
  activePortal: PortalIntent;
  reducedMotion?: boolean;
}

const PORTAL_BODY_MAP: Record<PortalIntent, string> = {
  school_erp: 'school',
  student_portal: 'student',
  parent_portal: 'parent',
  platform_admin: 'striker',
};

export default function CarromPortalBoard({ activePortal, reducedMotion = false }: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  const bodyConfigs: BodyConfig[] = [
    {
      id: 'school', kind: 'coin', label: 'School',
      radius: 38, mass: 1, restitution: 0.92, friction: 0.02,
      initialX: 60, initialY: 120,
      initialVx: 55, initialVy: 70,
    },
    {
      id: 'student', kind: 'coin', label: 'Student',
      radius: 38, mass: 1, restitution: 0.90, friction: 0.02,
      initialX: 280, initialY: 80,
      initialVx: -60, initialVy: 80,
    },
    {
      id: 'parent', kind: 'coin', label: 'Parent',
      radius: 38, mass: 1, restitution: 0.90, friction: 0.02,
      initialX: 160, initialY: 280,
      initialVx: 70, initialVy: -55,
    },
    {
      id: 'striker', kind: 'striker', label: '',
      radius: 48, mass: 2.6, restitution: 0.94, friction: 0.01,
      initialX: 100, initialY: 180,
      initialVx: -65, initialVy: 90,
    },
  ];

  const {
    elementRefs,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = useCarromPhysics(surfaceRef, bodyConfigs, {
    wallPadding: 8,
    activeBodyId: PORTAL_BODY_MAP[activePortal],
    reducedMotion,
  });

  const schoolRef = elementRefs.get('school')!;
  const studentRef = elementRefs.get('student')!;
  const parentRef = elementRefs.get('parent')!;
  const strikerRef = elementRefs.get('striker')!;

  return (
    <div className="carrom-stage" role="img" aria-label="Interactive carrom board with portal pieces">
      <div className="carrom-frame">
        <div className="carrom-outer-rim" />
        <div className="carrom-inner-rim" />
        <div className="carrom-surface" ref={surfaceRef}>
          <div className="carrom-hole" style={{ left: '10%', top: '10%' }} />
          <div className="carrom-hole" style={{ right: '10%', top: '10%' }} />
          <div className="carrom-hole" style={{ left: '10%', bottom: '10%' }} />
          <div className="carrom-hole" style={{ right: '10%', bottom: '10%' }} />

          <div className="carrom-center-ring" />
          <div className="carrom-center-cross" />
          <div className="carrom-baseline-top" />
          <div className="carrom-baseline-bottom" />

          <div
            ref={schoolRef}
            className="carrom-piece carrom-piece--school"
            data-kind="coin"
            aria-hidden="true"
          >
            <span className="carrom-piece-label">School</span>
          </div>

          <div
            ref={studentRef}
            className="carrom-piece carrom-piece--student"
            data-kind="coin"
            aria-hidden="true"
          >
            <span className="carrom-piece-label">Student</span>
          </div>

          <div
            ref={parentRef}
            className="carrom-piece carrom-piece--parent"
            data-kind="coin"
            aria-hidden="true"
          >
            <span className="carrom-piece-label">Parent</span>
          </div>

          <div
            ref={strikerRef}
            className="carrom-striker"
            data-kind="striker"
            role="button"
            tabIndex={0}
            aria-label="Platform Admin branded striker, draggable"
            onPointerDown={(e) => handlePointerDown(e, 'striker')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
              backgroundImage: `url(${bhavyaAxisLogo})`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
