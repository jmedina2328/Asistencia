
export interface Student {
  id: string;
  name: string;
  grade: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
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
