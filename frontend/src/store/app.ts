import { create } from 'zustand';
import type { Student, Room, SeatingPlan } from '@types';

interface AppStore {
  // School/Admin data
  selectedSchoolId: number;
  setSelectedSchoolId: (id: number) => void;

  // Student management
  students: Student[];
  setStudents: (students: Student[]) => void;
  addStudent: (student: Student) => void;
  updateStudent: (student: Student) => void;
  removeStudent: (studentId: number) => void;
  studentRefreshToken: number;
  bumpStudentRefreshToken: () => void;

  // Room management
  rooms: Room[];
  setRooms: (rooms: Room[]) => void;
  addRoom: (room: Room) => void;
  updateRoom: (room: Room) => void;
  removeRoom: (roomId: number) => void;

  // Seating plans
  seatingPlans: SeatingPlan[];
  setSeatingPlans: (plans: SeatingPlan[]) => void;
  selectedPlan: SeatingPlan | null;
  setSelectedPlan: (plan: SeatingPlan | null) => void;

  // UI state
  loading: boolean;
  setLoading: (loading: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  selectedSchoolId: 1,
  setSelectedSchoolId: (id) => set({ selectedSchoolId: id }),

  students: [],
  setStudents: (students) => set({ students }),
  addStudent: (student) => set((state) => ({ 
    students: [...state.students, student] 
  })),
  updateStudent: (student) => set((state) => ({
    students: state.students.map((s) => s.id === student.id ? student : s),
  })),
  removeStudent: (studentId) => set((state) => ({
    students: state.students.filter((s) => s.id !== studentId),
  })),
  studentRefreshToken: 0,
  bumpStudentRefreshToken: () => set((state) => ({
    studentRefreshToken: state.studentRefreshToken + 1,
  })),

  rooms: [],
  setRooms: (rooms) => set({ rooms }),
  addRoom: (room) => set((state) => ({ 
    rooms: [...state.rooms, room] 
  })),
  updateRoom: (room) => set((state) => ({
    rooms: state.rooms.map((r) => r.id === room.id ? room : r),
  })),
  removeRoom: (roomId) => set((state) => ({
    rooms: state.rooms.filter((r) => r.id !== roomId),
  })),

  seatingPlans: [],
  setSeatingPlans: (plans) => set({ seatingPlans: plans }),
  selectedPlan: null,
  setSelectedPlan: (plan) => set({ selectedPlan: plan }),

  loading: false,
  setLoading: (loading) => set({ loading }),
  error: null,
  setError: (error) => set({ error }),
}));
