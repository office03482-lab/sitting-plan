"""
Anti-Cheat Seating Algorithm Engine

Implements intelligent algorithms for generating anti-cheating seating plans.
- Plan A: Strict anti-cheat with maximum separation
- Plan B: Optimized compact layout for space constraints
"""

import math
from typing import List, Dict, Tuple, Set, Optional


class SeatingAlgorithmEngine:
    """Core algorithm for generating anti-cheat seating plans"""
    
    def __init__(
        self,
        min_distance_feet: float = 3.0,
        desk_length_feet: float = 2.0,
        desk_width_feet: float = 3.0,
        allow_diagonal_same_batch: bool = False,
    ):
        """
        Initialize seating algorithm.
        
        Args:
            min_distance_feet: Minimum distance between desk centers
            desk_length_feet: Length of each desk
            desk_width_feet: Width of each desk
            allow_diagonal_same_batch: Whether same batch can sit diagonally
        """
        self.min_distance_feet = min_distance_feet
        self.desk_length_feet = desk_length_feet
        self.desk_width_feet = desk_width_feet
        self.allow_diagonal_same_batch = allow_diagonal_same_batch
    
    def calculate_grid_positions(
        self,
        room_length_feet: float,
        room_width_feet: float,
        teaching_zone_clearance: float = 5.0,
        aisle_width: float = 3.0,
    ) -> List[Tuple[int, int, float, float]]:
        """
        Calculate valid desk positions in room grid.
        
        Returns:
            List of (row, col, x_pos, y_pos) tuples
        """
        positions = []
        
        # Usable area after clearances
        usable_length = room_length_feet - teaching_zone_clearance - aisle_width
        usable_width = room_width_feet - (2 * aisle_width)
        
        # Calculate grid dimensions
        num_rows = max(1, int(usable_length / self.desk_length_feet))
        num_cols = max(1, int(usable_width / (self.desk_width_feet + 0.5)))
        
        # Generate positions
        for row in range(num_rows):
            for col in range(num_cols):
                x = teaching_zone_clearance + (row * self.desk_length_feet)
                y = aisle_width + (col * (self.desk_width_feet + 0.5))
                
                if x < room_length_feet and y < room_width_feet:
                    positions.append((row, col, x, y))
        
        return positions
    
    def get_adjacent_desks(self, row: int, col: int) -> List[Tuple[int, int]]:
        """
        Get all adjacent desk positions (8-way adjacency).
        
        Returns:
            List of (row, col) tuples for adjacent desks
        """
        adjacent = []
        for dr in [-1, 0, 1]:
            for dc in [-1, 0, 1]:
                if dr == 0 and dc == 0:
                    continue
                adjacent.append((row + dr, col + dc))
        return adjacent
    
    def check_batch_conflict(
        self,
        batch: str,
        desk_row: int,
        desk_col: int,
        assigned_batches: Dict[Tuple[int, int], str],
        conflict_batches: Set[str] = None,
    ) -> bool:
        """
        Check if placing this batch at desk position creates conflicts.
        
        Returns:
            True if conflict, False if valid placement
        """
        # Check same desk (2 students on one desk must be different batch)
        # This is actually handled separately in seat assignment
        
        # Check adjacent desks
        adjacent = self.get_adjacent_desks(desk_row, desk_col)
        
        for adj_row, adj_col in adjacent:
            if (adj_row, adj_col) in assigned_batches:
                adjacent_batch = assigned_batches[(adj_row, adj_col)]
                
                # No same batch in adjacent desks (strict rule)
                if adjacent_batch == batch:
                    return True  # Conflict
                
                # Optional: diagonal check
                if not self.allow_diagonal_same_batch:
                    is_diagonal = abs(desk_row - adj_row) == 1 and abs(desk_col - adj_col) == 1
                    if is_diagonal and adjacent_batch == batch:
                        return True
        
        return False  # No conflict
    
    def generate_strict_plan(
        self,
        students: List[Dict],
        num_desks: int,
        exclude_desks: List[int] = None,
        desk_positions: Dict[int, Tuple[int, int]] = None,
        batch_conflict_groups: List[List[str]] = None,
    ) -> Dict:
        """
        Generate Plan A: Strict anti-cheat with maximum separation.
        
        Args:
            students: List of student dicts with 'id', 'name', 'batch', 'roll_number'
            num_desks: Total available desks (2 seats per desk)
            exclude_desks: Desk IDs to exclude (reserved for special needs)
        
        Returns:
            {
                'assignment': {desk_id: [(student1, seat1), (student2, seat2)]},
                'unassigned': [student_ids],
                'violations': count,
                'validity': bool
            }
        """
        assignment, unassigned = self._generate_position_aware_plan(
            students=students,
            num_desks=num_desks,
            exclude_desks=exclude_desks,
            desk_positions=desk_positions,
            include_diagonal=True,
            plan_mode="strict",
            batch_conflict_groups=batch_conflict_groups,
        )
        
        return {
            'assignment': assignment,
            'unassigned': unassigned,
            'violations': 0,
            'validity': len(unassigned) == 0,
            'plan_type': 'strict'
        }
    
    def generate_compact_plan(
        self,
        students: List[Dict],
        num_desks: int,
        exclude_desks: List[int] = None,
        desk_positions: Dict[int, Tuple[int, int]] = None,
        batch_conflict_groups: List[List[str]] = None,
    ) -> Dict:
        """
        Generate Plan B: Optimized compact layout for space constraints.
        
        Uses a checkerboard/alternating pattern to maintain separation
        while maximizing space efficiency.
        
        Args:
            students: List of student dicts
            num_desks: Total available desks
            exclude_desks: Desk IDs to exclude
        
        Returns:
            Assignment plan dictionary
        """
        assignment, unassigned = self._generate_position_aware_plan(
            students=students,
            num_desks=num_desks,
            exclude_desks=exclude_desks,
            desk_positions=desk_positions,
            include_diagonal=False,
            plan_mode="compact",
            batch_conflict_groups=batch_conflict_groups,
        )
        
        return {
            'assignment': assignment,
            'unassigned': unassigned,
            'violations': 0,
            'validity': len(unassigned) == 0,
            'plan_type': 'compact'
        }

    def generate_all_in_one_plan(
        self,
        students: List[Dict],
        num_desks: int,
        exclude_desks: List[int] = None,
        desk_positions: Dict[int, Tuple[int, int]] = None,
        batch_conflict_groups: List[List[str]] = None,
    ) -> Dict:
        assignment, unassigned = self._generate_position_aware_plan(
            students=students,
            num_desks=num_desks,
            exclude_desks=exclude_desks,
            desk_positions=desk_positions,
            include_diagonal=False,
            plan_mode="all_in_one",
            batch_conflict_groups=batch_conflict_groups,
        )

        return {
            'assignment': assignment,
            'unassigned': unassigned,
            'violations': 0,
            'validity': len(unassigned) == 0,
            'plan_type': 'all_in_one'
        }

    def _generate_position_aware_plan(
        self,
        students: List[Dict],
        num_desks: int,
        exclude_desks: List[int] = None,
        desk_positions: Dict[int, Tuple[int, int]] = None,
        include_diagonal: bool = False,
        plan_mode: str = "strict",
        batch_conflict_groups: List[List[str]] = None,
    ) -> Tuple[Dict[int, List[Dict]], List[int]]:
        """
        Assign students without same-batch conflicts on a bench or adjacent desks.

        Core anti-cheat rules:
        - Same bench left/right seats cannot have the same batch.
        - Same batch cannot sit immediately left/right or front/back.
        - Strict mode also avoids diagonal same-batch adjacency.
        """
        exclude_desks = exclude_desks or []
        available_desks = [desk_id for desk_id in range(num_desks) if desk_id not in exclude_desks]
        positions = self._normalize_desk_positions(num_desks, desk_positions)
        conflict_lookup = self._build_batch_conflict_lookup(batch_conflict_groups)
        assignment = {desk_id: [] for desk_id in available_desks}
        assigned_students = set()
        pair_counts: Dict[Tuple[str, str], int] = {}

        for student in self._round_robin_students_by_batch(students):
            desk_id = self._find_best_desk_for_student(
                student=student,
                available_desks=available_desks,
                assignment=assignment,
                positions=positions,
                include_diagonal=include_diagonal,
                plan_mode=plan_mode,
                pair_counts=pair_counts,
                conflict_lookup=conflict_lookup,
            )

            if desk_id is not None:
                assignment[desk_id].append(student)
                assigned_students.add(student['id'])
                if len(assignment[desk_id]) == 2:
                    left_batch = str(assignment[desk_id][0].get('batch') or '').strip()
                    right_batch = str(assignment[desk_id][1].get('batch') or '').strip()
                    pair_key = tuple(sorted((left_batch, right_batch)))
                    pair_counts[pair_key] = pair_counts.get(pair_key, 0) + 1

        unassigned = [student['id'] for student in students if student['id'] not in assigned_students]
        return assignment, unassigned

    def _round_robin_students_by_batch(self, students: List[Dict]) -> List[Dict]:
        students_by_batch = {}
        for student in students:
            students_by_batch.setdefault(student['batch'], []).append(student)

        ordered_batches = sorted(
            students_by_batch.keys(),
            key=lambda batch: len(students_by_batch[batch]),
            reverse=True,
        )

        ordered_students = []
        forward_pass = True
        while any(students_by_batch.values()):
            batches_for_pass = ordered_batches if forward_pass else list(reversed(ordered_batches))
            for batch in batches_for_pass:
                if students_by_batch[batch]:
                    ordered_students.append(students_by_batch[batch].pop(0))
            forward_pass = not forward_pass

        return ordered_students

    def _normalize_desk_positions(
        self,
        num_desks: int,
        desk_positions: Dict[int, Tuple[int, int]] = None,
    ) -> Dict[int, Tuple[int, int]]:
        if desk_positions:
            return desk_positions

        return {
            desk_id: (desk_id // 3, desk_id % 3)
            for desk_id in range(num_desks)
        }

    def _find_best_desk_for_student(
        self,
        student: Dict,
        available_desks: List[int],
        assignment: Dict[int, List[Dict]],
        positions: Dict[int, Tuple[int, int]],
        include_diagonal: bool,
        plan_mode: str,
        pair_counts: Dict[Tuple[str, str], int],
        conflict_lookup: Dict[str, str],
    ) -> Optional[int]:
        candidate_desks = []

        for desk_id in available_desks:
            if len(assignment[desk_id]) >= 2:
                continue

            if not self._can_place_student(student, desk_id, assignment, positions, include_diagonal, conflict_lookup):
                continue

            candidate_desks.append(
                (
                    self._candidate_desk_sort_key(
                        student=student,
                        desk_id=desk_id,
                        assignment=assignment,
                        positions=positions,
                        include_diagonal=include_diagonal,
                        plan_mode=plan_mode,
                        pair_counts=pair_counts,
                    ),
                    desk_id,
                )
            )

        if not candidate_desks:
            return None

        candidate_desks.sort(key=lambda item: item[0])
        return candidate_desks[0][1]

    def _candidate_desk_sort_key(
        self,
        student: Dict,
        desk_id: int,
        assignment: Dict[int, List[Dict]],
        positions: Dict[int, Tuple[int, int]],
        include_diagonal: bool,
        plan_mode: str,
        pair_counts: Dict[Tuple[str, str], int],
    ) -> Tuple[int, int, int, int, int, int]:
        position = positions.get(desk_id, (0, 0))
        occupancy = len(assignment.get(desk_id, []))
        restricted_neighbors = 0
        pair_penalty = 0
        sequence_penalty = 0

        current_position = positions.get(desk_id)
        if current_position is not None:
            for other_desk_id, students_on_desk in assignment.items():
                if other_desk_id == desk_id or not students_on_desk:
                    continue

                if abs(other_desk_id - desk_id) <= 1:
                    if any(existing.get('batch') == student.get('batch') for existing in students_on_desk):
                        sequence_penalty += 1

                other_position = positions.get(other_desk_id)
                if other_position is None:
                    continue

                if self._is_restricted_neighbor(current_position, other_position, include_diagonal):
                    restricted_neighbors += 1

        if occupancy == 1:
            existing_batch = str(assignment[desk_id][0].get('batch') or '').strip()
            current_batch = str(student.get('batch') or '').strip()
            pair_key = tuple(sorted((existing_batch, current_batch)))
            pair_penalty = pair_counts.get(pair_key, 0)

        if plan_mode == "compact":
            occupancy_priority = 0 if occupancy == 1 else 1 if occupancy == 0 else 2
            return (occupancy_priority, sequence_penalty, pair_penalty, -restricted_neighbors, position[0], position[1])

        if plan_mode == "all_in_one":
            occupancy_priority = 0 if occupancy == 0 else 1 if occupancy == 1 else 2
            return (occupancy_priority, sequence_penalty, pair_penalty, restricted_neighbors, position[0], position[1])

        occupancy_priority = 0 if occupancy == 0 else 1 if occupancy == 1 else 2
        return (occupancy_priority, sequence_penalty, pair_penalty, restricted_neighbors, position[0], position[1])

    def _can_place_student(
        self,
        student: Dict,
        desk_id: int,
        assignment: Dict[int, List[Dict]],
        positions: Dict[int, Tuple[int, int]],
        include_diagonal: bool,
        conflict_lookup: Dict[str, str],
    ) -> bool:
        anti_cheat_group = self._anti_cheat_group(student['batch'], conflict_lookup)

        # Same bench left/right seats must never contain the same anti-cheat group.
        if any(self._anti_cheat_group(existing['batch'], conflict_lookup) == anti_cheat_group for existing in assignment.get(desk_id, [])):
            return False

        current_position = positions.get(desk_id)
        if current_position is None:
            return True

        for other_desk_id, students_on_desk in assignment.items():
            if other_desk_id == desk_id or not students_on_desk:
                continue

            other_position = positions.get(other_desk_id)
            if other_position is None:
                continue

            if self._is_restricted_neighbor(current_position, other_position, include_diagonal):
                if any(self._anti_cheat_group(existing['batch'], conflict_lookup) == anti_cheat_group for existing in students_on_desk):
                    return False

        return True

    def _build_batch_conflict_lookup(self, batch_conflict_groups: List[List[str]] = None) -> Dict[str, str]:
        lookup = {}
        for group_index, group in enumerate(batch_conflict_groups or []):
            cleaned_group = [batch.strip() for batch in group if batch and batch.strip()]
            if len(cleaned_group) < 2:
                continue

            group_key = f"conflict_group_{group_index}"
            for batch in cleaned_group:
                lookup[batch] = group_key

        return lookup

    def _anti_cheat_group(self, batch: str, conflict_lookup: Dict[str, str]) -> str:
        return conflict_lookup.get(batch, batch)

    def _is_restricted_neighbor(
        self,
        position_a: Tuple[int, int],
        position_b: Tuple[int, int],
        include_diagonal: bool,
    ) -> bool:
        row_distance = abs(position_a[0] - position_b[0])
        col_distance = abs(position_a[1] - position_b[1])

        # Keep at least a two-bench gap for the same batch in the same row/column.
        is_front_back_or_side = (row_distance in {1, 2} and col_distance == 0) or (row_distance == 0 and col_distance in {1, 2})
        if is_front_back_or_side:
            return True

        return include_diagonal and row_distance == 1 and col_distance == 1
    
    def validate_plan(self, assignment: Dict, students_by_id: Dict) -> Dict:
        """
        Validate a seating plan against anti-cheat rules.
        
        Returns:
            {
                'is_valid': bool,
                'violations': [violation_list],
                'violation_count': int
            }
        """
        violations = []
        
        for desk_id, students_on_desk in assignment.items():
            # Check: No same batch on same desk
            if len(students_on_desk) == 2:
                batch1 = students_on_desk[0]['batch']
                batch2 = students_on_desk[1]['batch']
                if batch1 == batch2:
                    violations.append({
                        'type': 'same_batch_on_desk',
                        'desk_id': desk_id,
                        'students': [s['id'] for s in students_on_desk]
                    })
        
        return {
            'is_valid': len(violations) == 0,
            'violations': violations,
            'violation_count': len(violations)
        }
    
    def calculate_batch_distribution(self, assignment: Dict) -> Dict[str, int]:
        """
        Calculate distribution of batches across desks.
        
        Returns:
            {batch_name: count}
        """
        distribution = {}
        
        for desk_id, students in assignment.items():
            for student in students:
                batch = student['batch']
                distribution[batch] = distribution.get(batch, 0) + 1
        
        return distribution
