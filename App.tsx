
import React, { useState, useEffect, useCallback } from 'react';
import { INITIAL_STUDENTS } from './constants';
import { Student, AttendanceRecord, AttendanceStatus } from './types';
import QRScanner from './components/QRScanner';
import { generateAttendanceMessage } from './services/geminiService';

const App: React.FC = () => {
  const [students] = useState<Student[]>(INITIAL_STUDENTS);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [view, setView] = useState<'scan' | 'list' | 'reports'>('scan');
  const [isScanning, setIsScanning] = useState(true);
  const [notifications, setNotifications] = useState<{ id: string; msg: string; type: 'success' | 'alert' }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const currentDate = new Date().toLocaleDateString();

  // Initialize records for the day if not present
  useEffect(() => {
    const existing = localStorage.getItem(`attendance_${currentDate}`);
    if (existing) {
      setRecords(JSON.parse(existing));
    } else {
      const initialRecords: AttendanceRecord[] = students.map(s => ({
        studentId: s.id,
        date: currentDate,
        time: null,
        status: 'pending',
        notificationSent: false,
        justificationReceived: false
      }));
      setRecords(initialRecords);
      localStorage.setItem(`attendance_${currentDate}`, JSON.stringify(initialRecords));
    }
  }, [students, currentDate]);

  const addNotification = (msg: string, type: 'success' | 'alert') => {
    const id = Math.random().toString(36).substr(2, 9);
    setNotifications(prev => [{ id, msg, type }, ...prev]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  const handleScan = useCallback(async (data: string) => {
    if (isProcessing) return;
    
    const student = students.find(s => s.id === data);
    if (!student) {
      addNotification("Código QR no reconocido", 'alert');
      return;
    }

    const currentRecord = records.find(r => r.studentId === student.id);
    if (currentRecord?.status === 'present') {
      addNotification(`${student.name} ya está registrado`, 'alert');
      return;
    }

    setIsProcessing(true);
    setIsScanning(false);
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const updatedRecords = records.map(r => 
      r.studentId === student.id 
        ? { ...r, status: 'present' as AttendanceStatus, time, notificationSent: true }
        : r
    );

    setRecords(updatedRecords);
    localStorage.setItem(`attendance_${currentDate}`, JSON.stringify(updatedRecords));

    // Simulate AI message and parent notification
    const aiMessage = await generateAttendanceMessage(student.name, student.parentName, 'present', time);
    addNotification(`REPORTE ENVIADO: ${aiMessage}`, 'success');

    setTimeout(() => {
      setIsScanning(true);
      setIsProcessing(false);
    }, 2000);
  }, [records, students, isProcessing, currentDate]);

  const markAbsences = async () => {
    const pendingStudents = records.filter(r => r.status === 'pending');
    if (pendingStudents.length === 0) {
      addNotification("No hay estudiantes pendientes", 'alert');
      return;
    }

    const updatedRecords = records.map(r => 
      r.status === 'pending' 
        ? { ...r, status: 'absent' as AttendanceStatus, notificationSent: true }
        : r
    );

    setRecords(updatedRecords);
    localStorage.setItem(`attendance_${currentDate}`, JSON.stringify(updatedRecords));

    addNotification(`Se han marcado ${pendingStudents.length} inasistencias. Generando reportes para padres...`, 'alert');

    // Generate notifications for absences
    for (const record of pendingStudents) {
      const student = students.find(s => s.id === record.studentId)!;
      const msg = await generateAttendanceMessage(student.name, student.parentName, 'absent');
      console.log(`Notification to ${student.parentEmail}: ${msg}`);
    }
  };

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">EduScan</h1>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-widest">{currentDate}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">
              {records.filter(r => r.status === 'present').length} Presentes
            </span>
          </div>
        </div>
      </header>

      {/* Notifications Overlay */}
      <div className="fixed top-20 right-4 left-4 z-[100] pointer-events-none flex flex-col gap-2">
        {notifications.map(n => (
          <div key={n.id} className={`p-4 rounded-xl shadow-lg border-l-4 pointer-events-auto transform transition-all animate-bounce-short ${n.type === 'success' ? 'bg-white border-emerald-500 text-slate-800' : 'bg-rose-50 border-rose-500 text-rose-800'}`}>
             <div className="flex items-start gap-3">
               {n.type === 'success' ? (
                 <svg className="w-5 h-5 text-emerald-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
               ) : (
                 <svg className="w-5 h-5 text-rose-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
               )}
               <p className="text-sm font-medium leading-relaxed">{n.msg}</p>
             </div>
          </div>
        ))}
      </div>

      <main className="max-w-4xl mx-auto p-4 mt-4">
        {view === 'scan' && (
          <div className="flex flex-col items-center gap-8">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Escaneo de Ingreso</h2>
              <p className="text-slate-500">Asegúrate de que el código QR esté bien iluminado</p>
            </div>
            
            <QRScanner onScan={handleScan} isScanning={isScanning} />

            <div className="grid grid-cols-2 gap-4 w-full max-w-md">
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
                <p className="text-xs text-slate-400 font-semibold mb-1 uppercase tracking-wider">Total Estudiantes</p>
                <p className="text-2xl font-bold text-slate-800">{students.length}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
                <p className="text-xs text-slate-400 font-semibold mb-1 uppercase tracking-wider">Por Ingresar</p>
                <p className="text-2xl font-bold text-indigo-600">{records.filter(r => r.status === 'pending').length}</p>
              </div>
            </div>

            <button 
              onClick={markAbsences}
              className="w-full max-w-md bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold py-4 rounded-2xl border-2 border-rose-200 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Cerrar Registro y Notificar Faltas
            </button>
          </div>
        )}

        {view === 'list' && (
          <div className="space-y-4">
            <div className="flex justify-between items-end mb-6">
              <h2 className="text-2xl font-bold text-slate-800">Listado de Asistencia</h2>
              <div className="flex gap-2">
                 <button onClick={() => setRecords(records.map(r => ({...r, status: 'pending', time: null})))} className="text-xs text-slate-400 font-semibold hover:text-slate-600">Reiniciar hoy</button>
              </div>
            </div>
            
            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Estudiante</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Estado</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Hora</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Padre</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students.map(student => {
                    const record = records.find(r => r.studentId === student.id);
                    return (
                      <tr key={student.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-semibold text-slate-800">{student.name}</div>
                          <div className="text-xs text-slate-400">{student.grade}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
                            record?.status === 'present' ? 'bg-emerald-100 text-emerald-700' :
                            record?.status === 'absent' ? 'bg-rose-100 text-rose-700' :
                            'bg-slate-100 text-slate-500'
                          }`}>
                            {record?.status === 'present' ? 'Presente' : record?.status === 'absent' ? 'Ausente' : 'Pendiente'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-600">
                          {record?.time || '--:--'}
                        </td>
                        <td className="px-6 py-4">
                           <div className="text-xs font-medium text-slate-700">{student.parentName}</div>
                           <div className="text-[10px] text-slate-400">{student.parentPhone}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {view === 'reports' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-slate-800">Reportes en Tiempo Real</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               {records.filter(r => r.notificationSent).map(r => {
                 const s = students.find(stud => stud.id === r.studentId)!;
                 return (
                   <div key={r.studentId} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                      <div className="flex justify-between items-start mb-3">
                         <div>
                            <p className="text-sm font-bold text-slate-800">{s.name}</p>
                            <p className="text-xs text-slate-400">Notificado a {s.parentName}</p>
                         </div>
                         <span className={`text-[10px] px-2 py-1 rounded font-bold ${r.status === 'present' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                           ENVIADO
                         </span>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-lg text-xs italic text-slate-600 border border-slate-100">
                         "Estimado padre de familia, le informamos que el estudiante {s.name} ha sido registrado como {r.status === 'present' ? 'PRESENTE' : 'AUSENTE'} hoy {r.date} a las {r.time || 'la hora de cierre'}."
                      </div>
                   </div>
                 );
               })}
               {records.filter(r => r.notificationSent).length === 0 && (
                 <div className="col-span-full py-20 text-center bg-slate-100 rounded-3xl border-2 border-dashed border-slate-200">
                    <p className="text-slate-400 font-medium">Aún no se han enviado reportes hoy.</p>
                 </div>
               )}
            </div>
          </div>
        )}
      </main>

      {/* Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-slate-200 px-6 py-4 z-50">
        <div className="max-w-md mx-auto flex justify-between items-center">
          <button 
            onClick={() => setView('scan')}
            className={`flex flex-col items-center gap-1 transition-all ${view === 'scan' ? 'text-indigo-600 scale-110' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
            <span className="text-[10px] font-bold uppercase tracking-wider">Escáner</span>
          </button>
          
          <button 
            onClick={() => setView('list')}
            className={`flex flex-col items-center gap-1 transition-all ${view === 'list' ? 'text-indigo-600 scale-110' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
            <span className="text-[10px] font-bold uppercase tracking-wider">Asistencia</span>
          </button>
          
          <button 
            onClick={() => setView('reports')}
            className={`flex flex-col items-center gap-1 transition-all ${view === 'reports' ? 'text-indigo-600 scale-110' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
            <span className="text-[10px] font-bold uppercase tracking-wider">Reportes</span>
          </button>
        </div>
      </nav>
    </div>
  );
};

export default App;
