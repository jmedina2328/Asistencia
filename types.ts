
export interface Student {
  id: string; // Unique Identifier (DNI/ID)
  alumno: string; // Name of the student
  grado: string; // Grade and section
  tutor: string; // Tutor name (Renamed from padre)
  contacto: string; // Phone number or contact info
  registeredAt?: string;
}

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'pending';

export interface AttendanceRecord {
  studentId: string;
  date: string;
  time: string | null;
  status: AttendanceStatus;
  notificationSent: boolean;
  justificationReceived: boolean;
}

export interface AppState {
  students: Student[];
  records: AttendanceRecord[];
  currentDate: string;
}
