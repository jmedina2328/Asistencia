
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { INITIAL_STUDENTS } from './constants';
import { Student, AttendanceRecord } from './types';
import QRScanner from './components/QRScanner';
import { generateAttendanceMessage } from './services/geminiService';

const STORAGE_KEY = 'palmista_pro_db_v25_final';

interface ExtendedAttendanceRecord extends AttendanceRecord {
  generatedMessage?: string;
}

const App: React.FC = () => {
  // Estado de estudiantes con persistencia
  const [students, setStudents] = useState<Student[]>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : INITIAL_STUDENTS;
  });

  const dateKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);

  // Estado de registros diarios con persistencia
  const [records, setRecords] = useState<ExtendedAttendanceRecord[]>(() => {
    const stored = localStorage.getItem(`palmista_att_${dateKey}`);
    if (stored) return JSON.parse(stored);
    
    return students.map((s: Student) => ({
      studentId: s.id,
      date: dateKey,
      time: null,
      status: 'pending' as const,
      notificationSent: false,
      justificationReceived: false
    }));
  });

  const [view, setView] = useState<'scan' | 'list' | 'students' | 'reports'>('scan');
  const [isScanning, setIsScanning] = useState(true);
  const [notifications, setNotifications] = useState<{ id: string; msg: string; type: 'success' | 'alert' | 'info' }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastScanResult, setLastScanResult] = useState<{ student: Student, msg: string, autoSent: boolean } | null>(null);

  const lastScannedRef = useRef<{ id: string; time: number } | null>(null);

  // Sincronización con LocalStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(students));
  }, [students]);

  useEffect(() => {
    localStorage.setItem(`palmista_att_${dateKey}`, JSON.stringify(records));
  }, [records, dateKey]);

  const addNotification = useCallback((msg: string, type: 'success' | 'alert' | 'info') => {
    const id = Math.random().toString(36).substring(2, 11);
    setNotifications(prev => [{ id, msg, type }, ...prev]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 4000);
  }, []);

  const displayDate = useMemo(() => new Date().toLocaleDateString('es-ES', { 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
  }), []);

  const stats = useMemo(() => ({
    total: students.length,
    present: records.filter(r => r.status === 'present').length,
    absent: records.filter(r => r.status === 'absent').length,
    pending: records.filter(r => r.status === 'pending').length
  }), [students, records]);

  const sendWhatsApp = (phone: string, message: string) => {
    if (!phone || phone.trim() === "") {
      addNotification("Sin número de contacto registrado", "alert");
      return false;
    }
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length === 9) cleanPhone = '51' + cleanPhone;
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
    return true;
  };

  const downloadExcelReport = () => {
    const headers = ["DNI/ID", "Estudiante", "Grado/Sección", "Tutor", "Contacto", "Estado", "Hora de Registro", "Mensaje Enviado"];
    const rows = records.map(r => {
      const s = students.find(std => std.id === r.studentId);
      return [
        s?.id || r.studentId,
        s?.alumno || "Desconocido",
        s?.grado || "N/A",
        s?.tutor || "N/A",
        s?.contacto || "N/A",
        r.status === 'present' ? 'PRESENTE' : r.status === 'absent' ? 'FALTA' : 'PENDIENTE',
        r.time || "Sin registro",
        r.generatedMessage ? `"${r.generatedMessage.replace(/"/g, '""')}"` : "Ninguno"
      ];
    });

    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Reporte_Asistencia_Palmista_${dateKey}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addNotification("Reporte Excel generado", "success");
  };

  const handleScan = useCallback(async (data: string) => {
    if (isProcessing || !data) return;

    let studentId = data.trim();
    let studentDataFromQR: any = null;

    // Sincronización con Palmista QR Assistant (soporta JSON o texto plano)
    try {
      if (data.startsWith('{')) {
        const parsed = JSON.parse(data);
        studentId = parsed.id || parsed.dni || studentId;
        studentDataFromQR = parsed;
      }
    } catch(e) {
      console.debug("QR no es JSON, procesando como texto plano");
    }

    const now = Date.now();
    // Prevenir doble escaneo en 5 segundos
    if (lastScannedRef.current?.id === studentId && now - lastScannedRef.current.time < 5000) return;
    lastScannedRef.current = { id: studentId, time: now };

    setIsProcessing(true);
    setIsScanning(false);

    const time = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    let student = students.find(s => s.id === studentId);

    // Registro automático si el alumno no existe en la base local (Sincronización Dinámica)
    if (!student) {
      const newStudent: Student = {
        id: studentId,
        alumno: studentDataFromQR?.nombre || studentDataFromQR?.alumno || `Nuevo Alumno (${studentId})`,
        grado: studentDataFromQR?.grado || "Por asignar",
        tutor: studentDataFromQR?.tutor || "Por asignar",
        contacto: studentDataFromQR?.contacto || ""
      };
      setStudents(prev => [...prev, newStudent]);
      setRecords(prev => [...prev, { 
        studentId: newStudent.id, 
        date: dateKey, 
        time: null, 
        status: 'pending', 
        notificationSent: false, 
        justificationReceived: false 
      }]);
      student = newStudent;
      addNotification("Alumno sincronizado correctamente", "info");
    }

    if (student) {
      try {
        const msg = await generateAttendanceMessage(student.alumno, student.tutor, 'present', time);
        setRecords(prev => prev.map(r => r.studentId === student!.id ? { ...r, status: 'present', time, notificationSent: true, generatedMessage: msg } : r));
        
        // Auto-envío utilizando el mensaje predeterminado
        const opened = student.contacto ? sendWhatsApp(student.contacto, msg) : false;
        setLastScanResult({ student, msg, autoSent: opened });
        addNotification(`${student.alumno}: Presente`, 'success');
      } catch (err) {
        addNotification("Error de conexión IA", "alert");
      }
    }

    // Pequeña pausa para feedback visual antes de permitir el siguiente escaneo
    setTimeout(() => { 
      setIsProcessing(false); 
      setIsScanning(true); 
    }, 2000);
  }, [students, dateKey, isProcessing, addNotification]);

  const markAbsences = async () => {
    const pending = records.filter(r => r.status === 'pending');
    if (pending.length === 0) {
      addNotification("No hay registros pendientes", "info");
      return;
    }
    
    if (!confirm(`¿Cerrar jornada y marcar ${pending.length} faltas?`)) return;
    
    setIsProcessing(true);
    const updated = [...records];
    for (const rec of pending) {
      const s = students.find(std => std.id === rec.studentId);
      if (s) {
        const msg = await generateAttendanceMessage(s.alumno, s.tutor, 'absent');
        const idx = updated.findIndex(r => r.studentId === rec.studentId);
        updated[idx] = { ...updated[idx], status: 'absent', notificationSent: true, generatedMessage: msg };
      }
    }
    setRecords(updated);
    setIsProcessing(false);
    addNotification("Jornada finalizada y reportada", "success");
    setView('reports');
  };

  const deleteStudent = (id: string) => {
    if (!confirm("¿Desea eliminar a este estudiante de la base de datos? Se perderá su registro de hoy.")) return;
    setStudents(prev => prev.filter(s => s.id !== id));
    setRecords(prev => prev.filter(r => r.studentId !== id));
    setSelectedIds(prev => prev.filter(selectedId => selectedId !== id));
    addNotification("Estudiante eliminado", "success");
  };

  const deleteSelectedStudents = () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`¿Desea eliminar los ${selectedIds.length} estudiantes seleccionados?`)) return;
    setStudents(prev => prev.filter(s => !selectedIds.includes(s.id)));
    setRecords(prev => prev.filter(r => !selectedIds.includes(r.studentId)));
    setSelectedIds([]);
    addNotification(`${selectedIds.length} estudiantes eliminados`, "success");
  };

  const toggleSelectStudent = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  const filteredStudents = useMemo(() => students.filter(s => 
    s.alumno.toLowerCase().includes(searchTerm.toLowerCase()) || s.id.includes(searchTerm)
  ), [students, searchTerm]);

  return (
    <div className="min-h-screen bg-slate-100 pb-32 font-sans text-slate-900">
      <header className="bg-indigo-600 text-white p-6 shadow-2xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-6 cursor-pointer group" onClick={() => setView('scan')}>
            <div className="bg-white p-1 rounded-3xl shadow-2xl group-hover:scale-110 transition-all duration-500 overflow-hidden w-20 h-20 flex items-center justify-center shrink-0 border-4 border-white">
              <img 
                src="https://i.ibb.co/vzYh0B6/logo-palmista.png" 
                alt="Logo I.E. Ricardo Palma" 
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tighter leading-none">Palmista Scan <span className="text-indigo-200">Pro</span></h1>
              <p className="text-[10px] font-black uppercase opacity-90 tracking-widest mt-1 bg-indigo-500/40 px-3 py-1 rounded-lg inline-block border border-white/10">I.E. 80010 Ricardo Palma</p>
            </div>
          </div>
          <div className="hidden md:block bg-black/10 px-5 py-2 rounded-full border border-white/10">
            <p className="text-xs font-black uppercase tracking-widest">{displayDate}</p>
          </div>
        </div>
      </header>

      {/* Toast Notifications */}
      <div className="fixed top-24 right-4 left-4 z-[100] flex flex-col gap-3 max-w-sm mx-auto sm:ml-auto sm:mr-4 pointer-events-none">
        {notifications.map(n => (
          <div key={n.id} className={`p-4 rounded-2xl shadow-2xl border-l-[8px] animate-in slide-in-from-right pointer-events-auto bg-white ${
            n.type === 'success' ? 'border-emerald-500' : n.type === 'alert' ? 'border-rose-500' : 'border-indigo-500'
          }`}>
            <p className="text-[11px] font-black text-slate-800 uppercase tracking-wider">{n.msg}</p>
          </div>
        ))}
      </div>

      <main className="max-w-7xl mx-auto p-4 sm:p-10">
        {view === 'scan' && (
          <div className="flex flex-col items-center gap-10 animate-in zoom-in">
            <div className="text-center space-y-2">
              <h2 className="text-5xl font-black tracking-tighter">Acceso <span className="text-indigo-600">Escolar</span></h2>
              <p className="text-slate-500 text-xs font-bold bg-white px-5 py-2 rounded-full border border-slate-200 shadow-sm inline-block uppercase tracking-widest">Sincronizado con Assistant</p>
            </div>

            {lastScanResult && (
              <div className="w-full max-w-md bg-white border-4 border-indigo-600 rounded-[2.5rem] p-6 shadow-2xl animate-in slide-in-from-bottom flex flex-col items-center gap-4 relative">
                <div className="flex items-center gap-4 w-full">
                  <div className="w-16 h-16 bg-indigo-600 text-white rounded-2xl flex items-center justify-center font-black text-3xl shadow-lg">{lastScanResult.student.alumno[0]}</div>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest">Ingreso Registrado</p>
                    <p className="font-black text-slate-900 text-xl truncate">{lastScanResult.student.alumno}</p>
                  </div>
                  <button onClick={() => setLastScanResult(null)} className="p-2 text-slate-300 hover:text-slate-900"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg></button>
                </div>
                <button 
                  onClick={() => sendWhatsApp(lastScanResult.student.contacto, lastScanResult.msg)}
                  className="w-full bg-emerald-500 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-3 hover:bg-emerald-600 transition-all text-xs uppercase tracking-widest"
                >
                  Enviar WhatsApp Predeterminado
                </button>
              </div>
            )}

            <div className="w-full max-w-md relative group">
              <div className="absolute -inset-4 bg-indigo-500/10 rounded-[3rem] blur-2xl"></div>
              <QRScanner onScan={handleScan} isScanning={isScanning} />
              {isProcessing && (
                <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-md rounded-[2.5rem] flex flex-col items-center justify-center z-20">
                  <div className="w-14 h-14 border-4 border-white/20 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
                  <span className="text-[10px] font-black text-white tracking-widest uppercase">Procesando...</span>
                </div>
              )}
            </div>

            <button onClick={markAbsences} className="w-full max-w-md bg-slate-900 text-white font-black py-8 rounded-[2rem] shadow-xl flex items-center justify-center gap-4 hover:bg-black transition-all text-xl group">
              <svg className="w-8 h-8 text-indigo-400 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7" /></svg>
              Finalizar Registro Diario
            </button>
          </div>
        )}

        {view === 'list' && (
          <div className="space-y-6 animate-in slide-in-from-bottom">
            <h2 className="text-3xl font-black px-2">Control de <span className="text-indigo-600">Hoy</span></h2>
            <div className="bg-white rounded-[2rem] shadow-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                      <th className="px-8 py-6">Estudiante</th>
                      <th className="px-8 py-6">Estado</th>
                      <th className="px-8 py-6">Hora</th>
                      <th className="px-8 py-6">Notificación</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {records.map(r => {
                      const s = students.find(std => std.id === r.studentId);
                      if (!s) return null;
                      return (
                        <tr key={r.studentId} className="hover:bg-indigo-50/30 transition-colors">
                          <td className="px-8 py-6">
                            <p className="font-black text-slate-900 text-lg">{s.alumno}</p>
                            <p className="text-[9px] font-bold text-slate-400 tracking-wider">ID: {s.id}</p>
                          </td>
                          <td className="px-8 py-6">
                            <span className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest ${
                              r.status === 'present' ? 'bg-emerald-500 text-white' : 
                              r.status === 'absent' ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-400'
                            }`}>
                              {r.status === 'present' ? 'Presente' : r.status === 'absent' ? 'Falta' : 'Pendiente'}
                            </span>
                          </td>
                          <td className="px-8 py-6 font-mono font-bold text-slate-700">{r.time || '--:--'}</td>
                          <td className="px-8 py-6">
                             {r.notificationSent ? (
                               <span className="flex items-center gap-2 text-indigo-600 font-black text-[9px] uppercase">
                                 <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" /></svg>
                                 Enviada
                               </span>
                             ) : <span className="text-slate-200">Pend.</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {view === 'students' && (
          <div className="space-y-8 animate-in slide-in-from-bottom">
            <div className="flex flex-col md:flex-row justify-between items-center gap-6 px-2">
              <h2 className="text-4xl font-black tracking-tighter">Base de <span className="text-indigo-600">Datos</span></h2>
              <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                {selectedIds.length > 0 && (
                  <button 
                    onClick={deleteSelectedStudents}
                    className="bg-rose-600 text-white px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-rose-700 transition-all flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    Eliminar Selección ({selectedIds.length})
                  </button>
                )}
                <input 
                  type="text" 
                  placeholder="Buscar por nombre o DNI..." 
                  value={searchTerm} 
                  onChange={e => setSearchTerm(e.target.value)} 
                  className="bg-white border-2 border-slate-200 rounded-2xl px-6 py-3 text-sm font-bold focus:border-indigo-500 outline-none w-full md:w-80 shadow-md transition-all" 
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredStudents.map(s => (
                <div key={s.id} className={`bg-white p-6 rounded-[2rem] shadow-lg border-2 transition-all flex flex-col items-center relative group ${selectedIds.includes(s.id) ? 'border-indigo-500 bg-indigo-50/20' : 'border-transparent hover:border-slate-200'}`}>
                  {/* Selector múltiple */}
                  <button 
                    onClick={() => toggleSelectStudent(s.id)}
                    className={`absolute top-6 left-6 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${selectedIds.includes(s.id) ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300'}`}
                  >
                    {selectedIds.includes(s.id) && <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" /></svg>}
                  </button>

                  {/* Botón eliminar individual */}
                  <button 
                    onClick={() => deleteStudent(s.id)}
                    className="absolute top-6 right-6 p-2 text-slate-300 hover:text-rose-600 transition-colors opacity-0 group-hover:opacity-100"
                    title="Eliminar estudiante"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>

                  <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center text-3xl font-black mb-4">{s.alumno[0]}</div>
                  <h3 className="text-xl font-black text-slate-900 text-center mb-1">{s.alumno}</h3>
                  <p className="px-4 py-1 bg-slate-50 text-slate-500 rounded-full text-[9px] font-black uppercase tracking-widest mb-6">{s.grado}</p>
                  <div className="w-full space-y-2 text-[10px] font-bold">
                    <div className="flex justify-between border-b border-slate-50 pb-2"><span className="text-slate-400">ID / DNI</span> <span className="text-slate-800">{s.id}</span></div>
                    <div className="flex justify-between border-b border-slate-50 pb-2"><span className="text-slate-400">TUTOR</span> <span className="text-slate-800">{s.tutor}</span></div>
                    <div className="flex justify-between"><span className="text-slate-400">CONTACTO</span> <span className="text-emerald-600">{s.contacto || "No registrado"}</span></div>
                  </div>
                </div>
              ))}
              {filteredStudents.length === 0 && (
                <div className="col-span-full py-20 flex flex-col items-center justify-center opacity-40">
                  <svg className="w-20 h-20 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                  <p className="font-black uppercase tracking-[0.3em]">No se encontraron estudiantes</p>
                </div>
              )}
            </div>
          </div>
        )}

        {view === 'reports' && (
          <div className="space-y-8 animate-in slide-in-from-bottom pb-10">
            <div className="flex flex-col md:flex-row justify-between items-center px-2 gap-4">
              <h2 className="text-4xl font-black tracking-tighter text-center md:text-left">Panel de <span className="text-indigo-600">Reportes</span></h2>
              <button 
                onClick={downloadExcelReport}
                className="bg-slate-900 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center gap-3 shadow-xl hover:bg-black transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Generar Excel del Día
              </button>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-2">
              {[
                { label: 'Matrícula', value: stats.total, color: 'text-slate-600', bg: 'bg-white' },
                { label: 'Presentes', value: stats.present, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                { label: 'Faltas', value: stats.absent, color: 'text-rose-600', bg: 'bg-rose-50' },
                { label: 'Restantes', value: stats.pending, color: 'text-indigo-600', bg: 'bg-indigo-50' }
              ].map((stat, i) => (
                <div key={i} className={`${stat.bg} p-6 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col items-center justify-center`}>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{stat.label}</p>
                  <p className={`text-3xl font-black ${stat.color}`}>{stat.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-2">
              {records.filter(r => r.notificationSent).map(r => {
                const s = students.find(std => std.id === r.studentId);
                if (!s) return null;
                return (
                   <div key={r.studentId} className="bg-white p-6 rounded-[2rem] shadow-md border border-slate-50 flex flex-col gap-3">
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="font-black text-slate-900">{s.alumno}</p>
                          <p className="text-[9px] uppercase font-bold text-slate-400">{r.status === 'present' ? 'ENTRADA' : 'INASISTENCIA'} • {r.time || '--:--'}</p>
                        </div>
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${r.status === 'present' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                           {r.status === 'present' ? '✓' : '✗'}
                        </span>
                      </div>
                      <div className="bg-slate-50 p-4 rounded-xl italic text-[10px] text-slate-600 border border-slate-100 leading-relaxed">
                         "{r.generatedMessage}"
                      </div>
                      <button 
                        onClick={() => sendWhatsApp(s.contacto, r.generatedMessage || "")}
                        className="text-indigo-600 text-[9px] font-black uppercase tracking-widest text-left hover:text-indigo-800"
                      >
                        Re-enviar Reporte Predeterminado
                      </button>
                   </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      <nav className="fixed bottom-10 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md bg-slate-900/95 backdrop-blur-2xl rounded-[2.5rem] p-2 flex justify-around shadow-2xl z-50 border border-white/5 ring-[10px] ring-slate-100">
        {[
          { id: 'scan', label: 'Escanear', icon: 'M12 4v1m6 11h2m-6 0h-2v4' },
          { id: 'list', label: 'Lista', icon: 'M9 5H7a2 2 0 00-2 2v12' },
          { id: 'students', label: 'Base', icon: 'M12 4.354a4 4 0 110 5.292' },
          { id: 'reports', label: 'Reportes', icon: 'M15 17h5l-1.405-1.405' },
        ].map(nav => (
          <button key={nav.id} onClick={() => setView(nav.id as any)} className={`flex flex-col items-center p-4 transition-all relative ${view === nav.id ? 'text-indigo-400' : 'text-slate-500'}`}>
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={nav.icon} /></svg>
            <span className="text-[8px] font-black uppercase mt-1 tracking-widest">{nav.label}</span>
            {view === nav.id && <div className="absolute -bottom-1 w-10 h-1.5 bg-indigo-500 rounded-full shadow-[0_0_15px_#6366f1]"></div>}
          </button>
        ))}
      </nav>
    </div>
  );
};

export default App;
