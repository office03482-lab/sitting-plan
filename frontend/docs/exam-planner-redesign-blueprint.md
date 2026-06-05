# Exam Planner Redesign Blueprint

## Scope

- Frontend-only redesign of the `Exam Planner` hub at `/admin-office`
- No API changes
- No routing changes
- No permission changes
- No database changes
- Existing modules remain the source of truth

## Wireframe

```text
+----------------------------------------------------------------------------------+
| Exam Planner                                                                    |
| "Command center for exam readiness, seating progress, rooms, invigilators..."   |
|                                                                  [Refresh]       |
+--------------------------+--------------------------+----------------------------+
| Readiness Score          | Upcoming Exams           | Generated Plans            |
| Rooms ready              | Next exam date           | Students seated            |
| Invigilators assigned    | Active exam count        | Finalized / draft split    |
+--------------------------+--------------------------+----------------------------+
| Planning Center                                                                |
| [Generate Seating] [Seating Plans] [Reports & Export] [Room Configuration]     |
| [Invigilator Management] [Student Management] [Batch Management] [Timetable]    |
+----------------------------------------------------------------------------------+
| Exam Readiness                         | Operational Snapshot                    |
| - Rooms configured                     | - Plans by exam                         |
| - Invigilator room coverage            | - Rooms with plans                      |
| - Seats available vs assigned          | - Room capacity snapshot                |
| - Exams created                        | - Assignment coverage                   |
+----------------------------------------+-----------------------------------------+
| Recent Exams / Plan Progress                                                         |
| exam name | date | plans | students seated | status | [Open Generate] [Open Reports] |
+----------------------------------------------------------------------------------+
| Quick Actions                                                                    |
| Deep links only: existing pages stay source of truth                             |
+----------------------------------------------------------------------------------+
```

## Component Tree

```text
AdminOfficePage
|- ExamPlannerHero
|- ExamPlannerSummaryGrid
|  |- ReadinessScoreCard
|  |- UpcomingExamsCard
|  |- GeneratedPlansCard
|- PlanningCenterCard
|  |- ActionLinkButton x N
|- ExamReadinessPanel
|  |- ReadinessChecklist
|  |- CoverageStatRow x N
|- OperationalSnapshotPanel
|  |- MetricChipRow
|  |- ExamProgressList
|- QuickActionsPanel
|  |- DeepLinkTile x N
```

## Data Source Mapping

| UI Area | Existing API Source | Notes |
|---|---|---|
| Upcoming exams | `GET /api/exams` | Read-only summary only |
| Generated plans | `GET /api/seating/plans` | Shared source with Seating Generation, Seating Plan Management, Reports |
| Room readiness | `GET /api/rooms/summary` and `GET /api/rooms` | Summary first, room list for details |
| Invigilator coverage | `GET /api/invigilators/assignments` | Existing room assignment source |
| Student/batch support links | existing routes only | No new data ownership |
| Action buttons | existing routes | Deep-link only |

## Dependency Map

```text
AdminOffice.tsx
|- frontend/src/services/api.ts
|  |- /api/exams
|  |- /api/seating/plans
|  |- /api/rooms
|  |- /api/rooms/summary
|  |- /api/invigilators/assignments
|- frontend/src/contexts/AuthProvider.tsx
|- frontend/src/store/auth.ts
|- react-router navigation

Indirect shared consumers of same APIs:
|- SeatingGeneration.tsx
|- SeatingPlanManagement.tsx
|- Reports.tsx
|- RoomConfiguration.tsx
|- InvigilatorManagement.tsx
|- TimetableManagement.tsx (rooms)
|- Dashboard.tsx (rooms summary and shared access patterns)
```

## Guardrails

- No generation logic in the hub
- No plan management logic in the hub
- No exports in the hub
- No room editing in the hub
- No invigilator assignment mutation in the hub
- All action buttons open existing modules
- Existing modules remain operational source of truth
