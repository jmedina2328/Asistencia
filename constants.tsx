
import { Student } from './types';

// Initial database entries
export const INITIAL_STUDENTS: Student[] = [
  { 
    id: 'STU001', 
    alumno: 'Ana García', 
    grado: '5to Secundaria - A', 
    tutor: 'Carlos García', 
    contacto: '+51 987654321' 
  },
  { 
    id: 'STU002', 
    alumno: 'Luis Pérez', 
    grado: '4to Primaria - B', 
    tutor: 'Marta Pérez', 
    contacto: '+51 912345678' 
  },
];

export const COLORS = {
  present: 'bg-emerald-500',
  absent: 'bg-rose-500',
  late: 'bg-amber-500',
  pending: 'bg-slate-300',
};
