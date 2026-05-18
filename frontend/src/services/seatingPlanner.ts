import type { Room, RoomLayout, SeatingPlan, Student } from '@types';

type PlannerStudent = Pick<Student, 'id' | 'name' | 'roll_number' | 'batch' | 'email'>;

type PlannerAssignment = Record<number, PlannerStudent[]>;

type PlannerGenerationResult = {
  assignment: PlannerAssignment;
  unassigned: Array<string | number>;
  validity: boolean;
  plan_type: 'all_in_one';
};

type RoomContext = {
  room: Room;
  roomId: string | number;
  numDesks: number;
  seatCapacity: number;
  positions: Record<number, [number, number]>;
  sequence: number;
};

const roundRobinStudentsByBatch = (students: PlannerStudent[]) => {
  const studentsByBatch = new Map<string, PlannerStudent[]>();
  students.forEach((student) => {
    const batch = String(student.batch || '').trim() || 'Unassigned';
    const current = studentsByBatch.get(batch) || [];
    current.push(student);
    studentsByBatch.set(batch, current);
  });

  const orderedBatches = Array.from(studentsByBatch.keys()).sort(
    (a, b) => (studentsByBatch.get(b)?.length || 0) - (studentsByBatch.get(a)?.length || 0) || a.localeCompare(b),
  );

  const orderedStudents: PlannerStudent[] = [];
  let forwardPass = true;

  while (Array.from(studentsByBatch.values()).some((items) => items.length > 0)) {
    const batchesForPass = forwardPass ? orderedBatches : [...orderedBatches].reverse();
    batchesForPass.forEach((batch) => {
      const items = studentsByBatch.get(batch) || [];
      if (items.length > 0) {
        orderedStudents.push(items.shift() as PlannerStudent);
      }
    });
    forwardPass = !forwardPass;
  }

  return orderedStudents;
};

const buildConflictLookup = (batchConflictGroups?: string[][]) => {
  const lookup = new Map<string, string>();
  (batchConflictGroups || []).forEach((group, groupIndex) => {
    const cleaned = group.map((item) => String(item || '').trim()).filter(Boolean);
    if (cleaned.length < 2) return;
    const groupKey = `conflict_group_${groupIndex}`;
    cleaned.forEach((batch) => lookup.set(batch, groupKey));
  });
  return lookup;
};

const antiCheatGroup = (batch: string, conflictLookup: Map<string, string>) =>
  conflictLookup.get(String(batch || '').trim()) || String(batch || '').trim();

const isRestrictedNeighbor = (
  positionA: [number, number],
  positionB: [number, number],
  includeDiagonal: boolean,
) => {
  const rowDistance = Math.abs(positionA[0] - positionB[0]);
  const colDistance = Math.abs(positionA[1] - positionB[1]);
  const frontBackOrSide =
    (rowDistance >= 1 && rowDistance <= 2 && colDistance === 0) ||
    (rowDistance === 0 && colDistance >= 1 && colDistance <= 2);
  if (frontBackOrSide) {
    return true;
  }
  return includeDiagonal && rowDistance === 1 && colDistance === 1;
};

const canPlaceStudent = (
  student: PlannerStudent,
  deskId: number,
  assignment: PlannerAssignment,
  positions: Record<number, [number, number]>,
  includeDiagonal: boolean,
  conflictLookup: Map<string, string>,
) => {
  const studentGroup = antiCheatGroup(String(student.batch || ''), conflictLookup);
  if ((assignment[deskId] || []).some((existing) => antiCheatGroup(String(existing.batch || ''), conflictLookup) === studentGroup)) {
    return false;
  }

  const currentPosition = positions[deskId];
  if (!currentPosition) return true;

  return !Object.entries(assignment).some(([otherDeskId, studentsOnDesk]) => {
    if (Number(otherDeskId) === deskId || studentsOnDesk.length === 0) return false;
    const otherPosition = positions[Number(otherDeskId)];
    if (!otherPosition || !isRestrictedNeighbor(currentPosition, otherPosition, includeDiagonal)) return false;
    return studentsOnDesk.some((existing) => antiCheatGroup(String(existing.batch || ''), conflictLookup) === studentGroup);
  });
};

const candidateDeskSortKey = (
  student: PlannerStudent,
  deskId: number,
  assignment: PlannerAssignment,
  positions: Record<number, [number, number]>,
  pairCounts: Map<string, number>,
) => {
  const occupancy = assignment[deskId]?.length || 0;
  const position = positions[deskId] || [0, 0];
  let restrictedNeighbors = 0;
  let pairPenalty = 0;
  let sequencePenalty = 0;

  Object.entries(assignment).forEach(([otherDeskId, studentsOnDesk]) => {
    if (Number(otherDeskId) === deskId || studentsOnDesk.length === 0) return;
    if (Math.abs(Number(otherDeskId) - deskId) <= 1 && studentsOnDesk.some((existing) => existing.batch === student.batch)) {
      sequencePenalty += 1;
    }
    const otherPosition = positions[Number(otherDeskId)];
    if (otherPosition && isRestrictedNeighbor(position, otherPosition, false)) {
      restrictedNeighbors += 1;
    }
  });

  if (occupancy === 1) {
    const existingBatch = String(assignment[deskId][0].batch || '').trim();
    const currentBatch = String(student.batch || '').trim();
    const pairKey = [existingBatch, currentBatch].sort().join('::');
    pairPenalty = pairCounts.get(pairKey) || 0;
  }

  return [occupancy === 0 ? 0 : 1, sequencePenalty, pairPenalty, restrictedNeighbors, position[0], position[1]];
};

const findBestDeskForStudent = (
  student: PlannerStudent,
  context: RoomContext,
  assignment: PlannerAssignment,
  pairCounts: Map<string, number>,
  conflictLookup: Map<string, string>,
) => {
  const candidateDeskIds = Array.from({ length: context.numDesks }, (_, index) => index)
    .filter((deskId) => (assignment[deskId] || []).length < 2)
    .filter((deskId) => canPlaceStudent(student, deskId, assignment, context.positions, false, conflictLookup))
    .map((deskId) => ({
      deskId,
      sortKey: candidateDeskSortKey(student, deskId, assignment, context.positions, pairCounts),
    }))
    .sort((a, b) => {
      for (let index = 0; index < a.sortKey.length; index += 1) {
        if (a.sortKey[index] !== b.sortKey[index]) {
          return a.sortKey[index] - b.sortKey[index];
        }
      }
      return 0;
    });

  return candidateDeskIds[0]?.deskId;
};

const calculateDeskGrid = (room: Room) => {
  const deskCount = Math.max(Number(room.num_benches || 0), 0);
  if (deskCount === 0) {
    return { numDesks: 0, positions: {} as Record<number, [number, number]> };
  }

  const usableWidth = Math.max(Number(room.width_feet || 0) - (2 * Number(room.aisle_width_feet || 0)), 1);
  const maxColsByWidth = Math.max(
    1,
    Math.floor(usableWidth / Math.max(Number(room.desk_width_feet || 1.5) + 0.5, 1)),
  );
  const cols = Math.max(1, Math.min(maxColsByWidth, Math.ceil(Math.sqrt(deskCount))));
  const positions: Record<number, [number, number]> = {};
  for (let deskId = 0; deskId < deskCount; deskId += 1) {
    positions[deskId] = [Math.floor(deskId / cols), deskId % cols];
  }
  return { numDesks: deskCount, positions };
};

const allocateStudentsToRoomPools = (students: PlannerStudent[], roomContexts: RoomContext[]) => {
  const roomPools = new Map<string, PlannerStudent[]>();
  const roomBatchCounts = new Map<string, Map<string, number>>();
  roomContexts.forEach((context) => {
    roomPools.set(String(context.roomId), []);
    roomBatchCounts.set(String(context.roomId), new Map<string, number>());
  });

  const studentsByBatch = new Map<string, PlannerStudent[]>();
  students.forEach((student) => {
    const batch = String(student.batch || '').trim() || 'Unassigned';
    const current = studentsByBatch.get(batch) || [];
    current.push(student);
    studentsByBatch.set(batch, current);
  });

  const orderedBatches = Array.from(studentsByBatch.keys()).sort(
    (a, b) => (studentsByBatch.get(b)?.length || 0) - (studentsByBatch.get(a)?.length || 0) || a.localeCompare(b),
  );

  orderedBatches.forEach((batch) => {
    const batchStudents = [...(studentsByBatch.get(batch) || [])];
    while (batchStudents.length > 0) {
      const candidateRooms = roomContexts
        .filter((context) => (roomPools.get(String(context.roomId))?.length || 0) < context.seatCapacity)
        .sort((a, b) => {
          const aBatchCount = roomBatchCounts.get(String(a.roomId))?.get(batch) || 0;
          const bBatchCount = roomBatchCounts.get(String(b.roomId))?.get(batch) || 0;
          if (aBatchCount !== bBatchCount) return aBatchCount - bBatchCount;
          const aFill = (roomPools.get(String(a.roomId))?.length || 0) / Math.max(a.seatCapacity, 1);
          const bFill = (roomPools.get(String(b.roomId))?.length || 0) / Math.max(b.seatCapacity, 1);
          if (aFill !== bFill) return aFill - bFill;
          return a.sequence - b.sequence;
        });

      const selected = candidateRooms[0];
      if (!selected) break;
      const nextStudent = batchStudents.shift() as PlannerStudent;
      roomPools.get(String(selected.roomId))?.push(nextStudent);
      const batchCountMap = roomBatchCounts.get(String(selected.roomId)) as Map<string, number>;
      batchCountMap.set(batch, (batchCountMap.get(batch) || 0) + 1);
    }
  });

  return roomContexts.reduce<Record<string, PlannerStudent[]>>((accumulator, context) => {
    accumulator[String(context.roomId)] = roundRobinStudentsByBatch(roomPools.get(String(context.roomId)) || []);
    return accumulator;
  }, {});
};

const buildRoomLayout = (
  room: Room,
  assignment: PlannerAssignment,
  positions: Record<number, [number, number]>,
): RoomLayout => {
  const desks = Array.from({ length: Math.max(Number(room.num_benches || 0), 0) }, (_, deskIndex) => {
    const assignedStudents = assignment[deskIndex] || [];
    const [row, col] = positions[deskIndex] || [Math.floor(deskIndex / 3), deskIndex % 3];
    const deskId = deskIndex + 1;
    return {
      desk_id: deskId,
      row,
      col,
      is_reserved: false,
      reservation_reason: undefined,
      seats: [0, 1].map((seatIndex) => {
        const student = assignedStudents[seatIndex];
        return {
          seat_id: (deskIndex * 2) + seatIndex + 1,
          desk_id: deskId,
          position: (seatIndex + 1) as 1 | 2,
          student_id: typeof student?.id === 'number' ? student.id : undefined,
          student_name: student?.name,
          student_roll: student?.roll_number,
          batch: student?.batch,
          is_occupied: Boolean(student),
          row,
          col,
        };
      }),
    };
  });

  const occupied = desks.reduce((sum, desk) => sum + desk.seats.filter((seat) => seat.is_occupied).length, 0);

  return {
    room_id: room.id,
    room_name: room.name,
    desks,
    dimensions: {
      length_feet: Number(room.length_feet || 0),
      width_feet: Number(room.width_feet || 0),
    },
    capacity: Math.max(Number(room.num_benches || 0), 0) * 2,
    occupied,
  };
};

export const generatePlannerSeating = (
  students: PlannerStudent[],
  rooms: Room[],
  batchConflictGroups?: string[][],
) => {
  const roomContexts: RoomContext[] = rooms.map((room, index) => {
    const grid = calculateDeskGrid(room);
    return {
      room,
      roomId: room.id,
      numDesks: grid.numDesks,
      seatCapacity: grid.numDesks * 2,
      positions: grid.positions,
      sequence: index,
    };
  }).filter((context) => context.numDesks > 0);

  const roomStudentPools = allocateStudentsToRoomPools(students, roomContexts);
  const conflictLookup = buildConflictLookup(batchConflictGroups);

  return roomContexts.map((context) => {
    const orderedStudents = roomStudentPools[String(context.roomId)] || [];
    const assignment: PlannerAssignment = Object.fromEntries(
      Array.from({ length: context.numDesks }, (_, index) => [index, [] as PlannerStudent[]]),
    );
    const assignedIds = new Set<string | number>();
    const pairCounts = new Map<string, number>();

    roundRobinStudentsByBatch(orderedStudents).forEach((student) => {
      const deskId = findBestDeskForStudent(student, context, assignment, pairCounts, conflictLookup);
      if (deskId === undefined) return;
      assignment[deskId].push(student);
      assignedIds.add(student.id);
      if (assignment[deskId].length === 2) {
        const batches = assignment[deskId].map((item) => String(item.batch || '').trim()).sort();
        const pairKey = batches.join('::');
        pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
      }
    });

    const result: PlannerGenerationResult = {
      assignment,
      unassigned: orderedStudents.filter((student) => !assignedIds.has(student.id)).map((student) => student.id),
      validity: orderedStudents.every((student) => assignedIds.has(student.id)),
      plan_type: 'all_in_one',
    };

    return {
      room: context.room,
      result,
      layout: buildRoomLayout(context.room, assignment, context.positions),
    };
  });
};

export const buildPlanBatchDistribution = (layout: RoomLayout) => {
  const counts = new Map<string, number>();
  layout.desks.forEach((desk) => {
    desk.seats.forEach((seat) => {
      if (!seat.is_occupied) return;
      const batch = String(seat.batch || 'Unknown').trim() || 'Unknown';
      counts.set(batch, (counts.get(batch) || 0) + 1);
    });
  });

  return Array.from(counts.entries()).reduce<Record<string, number>>((accumulator, [batch, count]) => {
    accumulator[batch] = count;
    return accumulator;
  }, {});
};

export const buildPlanBatches = (distribution: Record<string, number>) =>
  Object.keys(distribution).sort((a, b) => (distribution[b] || 0) - (distribution[a] || 0) || a.localeCompare(b));

export const buildLegacyPlanSummary = (
  planId: number,
  examId: string | number,
  roomId: string | number,
  roomName: string,
  examName: string,
  examSubject: string | undefined,
  createdAt: string,
  distribution: Record<string, number>,
  isValid: boolean,
  uiPlanType: SeatingPlan['plan_type'],
) => {
  const totalStudents = Object.values(distribution).reduce((sum, value) => sum + Number(value || 0), 0);
  const batches = buildPlanBatches(distribution);
  return {
    id: planId,
    exam_id: examId,
    room_id: roomId,
    room_name: roomName,
    exam_name: examName,
    exam_subject: examSubject,
    batches,
    batch_distribution: batches.map((batch) => ({
      batch,
      count: distribution[batch] || 0,
      percentage: totalStudents ? Number((((distribution[batch] || 0) / totalStudents) * 100).toFixed(2)) : 0,
    })),
    name: `${roomName} - Batches: ${batches.join(', ')} - All-in-One Plan`,
    plan_type: uiPlanType,
    status: 'draft' as const,
    students_assigned: totalStudents,
    is_valid: isValid,
    validation_errors: isValid ? [] : ['Some students could not be assigned.'],
    created_at: createdAt,
  } satisfies SeatingPlan;
};
