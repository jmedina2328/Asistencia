
import { Student } from './types';

export const INITIAL_STUDENTS: Student[] = [
  { id: 'STU001', name: 'Ana García', grade: '10-A', parentName: 'Carlos García', parentEmail: 'carlos@example.com', parentPhone: '555-0101' },
  { id: 'STU002', name: 'Luis Pérez', grade: '10-A', parentName: 'Marta Pérez', parentEmail: 'marta@example.com', parentPhone: '555-0102' },
  { id: 'STU003', name: 'Sofía Martínez', grade: '10-A', parentName: 'Jorge Martínez', parentEmail: 'jorge@example.com', parentPhone: '555-0103' },
  { id: 'STU004', name: 'Diego Rodríguez', grade: '10-A', parentName: 'Elena Rodríguez', parentEmail: 'elena@example.com', parentPhone: '555-0104' },
  { id: 'STU005', name: 'Valeria López', grade: '10-A', parentName: 'Roberto López', parentEmail: 'roberto@example.com', parentPhone: '555-0105' },
];

export const COLORS = {
  present: 'bg-emerald-500',
  absent: 'bg-rose-500',
  late: 'bg-amber-500',
  pending: 'bg-slate-300',
};
