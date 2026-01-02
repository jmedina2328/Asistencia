
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { INITIAL_STUDENTS } from './constants';
import { Student, AttendanceRecord, AttendanceStatus } from './types';
import QRScanner from './components/QRScanner';
import { generateAttendanceMessage } from './services/geminiService';

const App: React.FC = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [view, setView] = useState<'scan' | 'list' | 'students' | 'reports'>('scan');
  const [isScanning, setIsScanning] = useState(true);
  const [notifications, setNotifications] = useState<{ id: string; msg: string; type: 'success' | 'alert' | 'info' }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  // Refs para control de duplicados en escaneo
  const lastScannedRef = useRef<{ id: string; time: number } | null>(null);

  const dateKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);

  const displayDate = useMemo(() => new Date().toLocaleDateString('es-ES', { 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
  }), []);

  // 1. Inicialización de Base de Datos
  useEffect(() => {
    const storedStudents = localStorage.getItem('palmista_db_v8');
    let currentStudents: Student[] = [];
    if (storedStudents) {
      currentStudents = JSON.parse(storedStudents);
    } else {
      currentStudents = INITIAL_STUDENTS;
      localStorage.setItem('palmista_db_v8', JSON.stringify(currentStudents));
    }
    setStudents(currentStudents);

    const storedRecords = localStorage.getItem(`palmista_att_${dateKey}`);
    if (storedRecords) {
      setRecords(JSON.parse(storedRecords));
    } else {
      const initialRecords: AttendanceRecord[] = currentStudents.map(s => ({
        studentId: s.id,
        date: dateKey,
        time: null,
        status: 'pending',
        notificationSent: false,
        justificationReceived: false
      }));
      setRecords(initialRecords);
      localStorage.setItem(`palmista_att_${dateKey}`, JSON.stringify(initialRecords));
    }
  }, [dateKey]);

  useEffect(() => {
    localStorage.setItem('palmista_db_v8', JSON.stringify(students));
  }, [students]);

  useEffect(() => {
    localStorage.setItem(`palmista_att_${dateKey}`, JSON.stringify(records));
  }, [records, dateKey]);

  const addNotification = useCallback((msg: string, type: 'success' | 'alert' | 'info') => {
    const id = Math.random().toString(36).substring(2, 11);
    setNotifications(prev => [{ id, msg, type }, ...prev]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 6000);
  }, []);

  const deleteStudent = (id: string) => {
    if (!confirm("¿Está seguro de eliminar a este estudiante? Se borrará también su registro de hoy.")) return;
    
    setStudents(prev => prev.filter(s => s.id !== id));
    setRecords(prev => prev.filter(r => r.studentId !== id));
    addNotification("Estudiante eliminado correctamente", "info");
  };

  // 2. Lógica de Escaneo con Mapeo Específico y Prevención de Duplicados
  const handleScan = useCallback(async (data: string) => {
    if (isProcessing) return;
    
    let parsedQR: any = null;
    let targetId = data.trim();

    const jsonMatch = data.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsedQR = JSON.parse(jsonMatch[0]);
        targetId = (parsedQR.ID || parsedQR.id || parsedQR.dni || parsedQR.codigo || "").toString();
        if (!targetId) {
           targetId = `AUTO-${Math.abs(data.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0)).toString(36).toUpperCase()}`;
        }
      } catch (e) {
        console.error("Error al parsear JSON detectado:", e);
      }
    }

    // Prevención de duplicados (Ignorar mismo ID si fue escaneado hace menos de 5 segundos)
    const now = Date.now();
    if (lastScannedRef.current?.id === targetId && now - lastScannedRef.current.time < 5000) {
      return; 
    }
    lastScannedRef.current = { id: targetId, time: now };

    setIsProcessing(true);
    setIsScanning(false);

    const time = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const existingStudent = students.find(s => s.id === targetId);

    if (existingStudent) {
      const record = records.find(r => r.studentId === existingStudent.id);
      if (record?.status === 'present') {
        addNotification(`Entrada previa registrada: ${existingStudent.alumno} (${record.time})`, 'info');
      } else {
        setRecords(prev => prev.map(r => 
          r.studentId === existingStudent.id 
            ? { ...r, status: 'present', time, notificationSent: true }
            : r
        ));
        addNotification(`Ingreso Confirmado: ${existingStudent.alumno} - ${time}`, 'success');
        generateAttendanceMessage(existingStudent.alumno, existingStudent.padre, 'present', time)
          .then(msg => addNotification(`NOTIFICACIÓN: ${msg}`, 'info'));
      }
    } else {
      // Registro Automático según claves específicas solicitadas
      if (parsedQR && (parsedQR["Usuario ejemplo"] || parsedQR.alumno || parsedQR.nombre)) {
        const newStudent: Student = {
          id: targetId,
          alumno: parsedQR["Usuario ejemplo"] || parsedQR.alumno || parsedQR.nombre || 'Desconocido',
          grado: parsedQR["GS"] || parsedQR.grado || parsedQR.seccion || 'S/G',
          padre: parsedQR["Padre/tutor"] || parsedQR.padre || parsedQR.tutor || 'Sin Tutor',
          contacto: parsedQR.contacto || parsedQR.telefono || 'S/N',
          registeredAt: new Date().toISOString()
        };

        setStudents(prev => [...prev, newStudent]);
        
        const newRecord: AttendanceRecord = {
          studentId: newStudent.id,
          date: dateKey,
          time,
          status: 'present',
          notificationSent: true,
          justificationReceived: false
        };

        setRecords(prev => [...prev, newRecord]);
        addNotification(`AUTO-REGISTRO: ${newStudent.alumno} (DNI: ${newStudent.id})`, 'success');

        generateAttendanceMessage(newStudent.alumno, newStudent.padre, 'present', time)
          .then(msg => addNotification(`REPORTE IA: ${msg}`, 'info'));
      } else {
        addNotification(`QR no estructurado o incompleto.`, 'alert');
      }
    }

    setTimeout(() => {
      setIsProcessing(false);
      setIsScanning(true);
    }, 2500);
  }, [records, students, isProcessing, dateKey, addNotification]);

  const markAbsences = async () => {
    const pending = records.filter(r => r.status === 'pending');
    if (pending.length === 0) {
      addNotification("No hay alumnos pendientes por registrar hoy.", 'info');
      return;
    }

    if (!confirm(`¿Cerrar jornada escolar? ${pending.length} alumnos serán marcados con FALTA.`)) return;

    setRecords(prev => prev.map(r => r.status === 'pending' ? { ...r, status: 'absent', notificationSent: true } : r));
    addNotification("Generando alertas de inasistencia para padres...", 'alert');

    for (const rec of pending) {
      const s = students.find(std => std.id === rec.studentId);
      if (s) {
        generateAttendanceMessage(s.alumno, s.padre, 'absent')
          .then(msg => console.log(`Alerta enviada: ${msg}`))
          .catch(e => console.error(e));
      }
    }
  };

  const filteredStudents = useMemo(() => students.filter(s => 
    s.alumno.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.id.toLowerCase().includes(searchTerm.toLowerCase())
  ), [students, searchTerm]);

  return (
    <div className="min-h-screen bg-slate-50 pb-36 font-sans antialiased">
      {/* Header Premium */}
      <header className="bg-white/95 backdrop-blur-2xl border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-5 group cursor-pointer" onClick={() => setView('scan')}>
            <div className="bg-indigo-600 p-3 rounded-2xl shadow-xl shadow-indigo-100 group-hover:rotate-6 transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tighter leading-none mb-1">Palmista Scan <span className="text-indigo-600 italic">v8</span></h1>
              <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em]">{displayDate}</p>
            </div>
          </div>
          <div className="hidden lg:flex items-center gap-6">
             <div className="text-right">
                <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest block mb-1">Registro Estudiantil Activo</span>
                <div className="flex items-center gap-3">
                   <div className="w-40 h-2.5 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                      <div className="h-full bg-indigo-600 shadow-[0_0_15px_rgba(79,70,229,0.5)] transition-all duration-1000" style={{width: `${Math.min((students.length / 600) * 100, 100)}%`}}></div>
                   </div>
                   <span className="text-sm font-black text-indigo-600 tabular-nums">{students.length} / 600+</span>
                </div>
             </div>
          </div>
        </div>
      </header>

      {/* Notificaciones */}
      <div className="fixed top-24 right-4 left-4 z-[100] pointer-events-none flex flex-col gap-3 max-w-md mx-auto lg:mr-8 lg:ml-auto">
        {notifications.map(n => (
          <div key={n.id} className={`p-5 rounded-[2.5rem] shadow-2xl border-l-[10px] pointer-events-auto transition-all animate-in slide-in-from-right ${
            n.type === 'success' ? 'bg-white border-emerald-500' : 
            n.type === 'alert' ? 'bg-white border-rose-500' : 
            'bg-white border-indigo-500'
          }`}>
             <div className="flex items-start gap-4">
               <div className={`shrink-0 mt-0.5 ${n.type === 'success' ? 'text-emerald-500' : n.type === 'alert' ? 'text-rose-500' : 'text-indigo-500'}`}>
                 {n.type === 'success' && <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" /></svg>}
                 {n.type === 'alert' && <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" /></svg>}
                 {n.type === 'info' && <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" /></svg>}
               </div>
               <p className="text-sm font-extrabold text-slate-800 leading-snug tracking-tight">{n.msg}</p>
             </div>
          </div>
        ))}
      </div>

      <main className="max-w-7xl mx-auto p-4 sm:p-10">
        {view === 'scan' && (
          <div className="flex flex-col items-center gap-12 animate-in fade-in zoom-in duration-500">
            <div className="text-center max-w-2xl space-y-4">
              <h2 className="text-5xl font-black text-slate-900 tracking-tighter">Panel de <span className="text-indigo-600">Escaneo</span></h2>
              <p className="text-slate-500 text-lg font-bold leading-relaxed px-6">Registro automático con mapeo inteligente de datos para nuevos alumnos y notificaciones en tiempo real.</p>
              <button 
                onClick={() => setShowHelp(!showHelp)}
                className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-600 px-6 py-2 rounded-full font-black uppercase text-[10px] tracking-widest hover:bg-indigo-100 transition-colors shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {showHelp ? 'Cerrar Guía' : 'Ver Formato JSON Requerido'}
              </button>
            </div>

            {showHelp && (
              <div className="w-full max-w-lg bg-slate-900 text-indigo-100 p-8 rounded-[3rem] font-mono text-xs shadow-2xl animate-in zoom-in border-4 border-indigo-500/20 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                   <svg className="w-20 h-20" fill="currentColor" viewBox="0 0 24 24"><path d="M3 3h6v6H3V3zm12 0h6v6h-6V3zM3 15h6v6H3v-6zm15 0h3v3h-3v-3z" /></svg>
                </div>
                <p className="text-emerald-400 mb-4 font-bold border-b border-white/10 pb-2">Estructura del Código QR:</p>
                <pre className="whitespace-pre-wrap leading-relaxed text-indigo-300">
{`{
  "ID": "12345678",
  "Usuario ejemplo": "Nombre Alumno",
  "GS": "Grado y Sección",
  "Padre/tutor": "Nombre del Padre",
  "contacto": "Número de Celular"
}`}
                </pre>
                <div className="mt-6 flex gap-2">
                   <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                   <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                   <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                </div>
              </div>
            )}
            
            <div className="w-full max-w-lg relative group">
              <div className="absolute -inset-2 bg-gradient-to-tr from-indigo-600 via-indigo-400 to-indigo-800 rounded-[3rem] blur-2xl opacity-20 transition duration-1000 group-hover:opacity-40"></div>
              <div className="relative">
                {isProcessing && (
                  <div className="absolute inset-0 z-20 bg-white/40 backdrop-blur-md rounded-[2.5rem] flex items-center justify-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-16 h-16 border-[6px] border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-sm font-black text-indigo-800 uppercase tracking-[0.3em] animate-pulse">Sincronizando...</span>
                    </div>
                  </div>
                )}
                <QRScanner onScan={handleScan} isScanning={isScanning} />
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 w-full">
              {[
                { label: 'Matriculados', value: students.length, color: 'indigo', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
                { label: 'Presentes', value: records.filter(r => r.status === 'present').length, color: 'emerald', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
                { label: 'En Espera', value: records.filter(r => r.status === 'pending').length, color: 'amber', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
                { label: 'Ausentes', value: records.filter(r => r.status === 'absent').length, color: 'rose', icon: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
              ].map(stat => (
                <div key={stat.label} className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100 flex flex-col items-center text-center transition-all hover:shadow-2xl hover:-translate-y-3 group">
                  <div className={`w-14 h-14 mb-4 bg-${stat.color}-50 text-${stat.color}-600 rounded-2xl flex items-center justify-center group-hover:bg-${stat.color}-600 group-hover:text-white transition-all shadow-sm`}>
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={stat.icon} /></svg>
                  </div>
                  <p className="text-[10px] text-slate-300 font-black uppercase tracking-[0.2em] mb-1">{stat.label}</p>
                  <p className={`text-4xl font-black text-${stat.color}-600 tracking-tighter`}>{stat.value}</p>
                </div>
              ))}
            </div>

            <button 
              onClick={markAbsences}
              className="group relative w-full max-w-lg bg-slate-950 hover:bg-black text-white font-black py-8 rounded-[3rem] transition-all shadow-2xl active:scale-[0.96] overflow-hidden"
            >
              <span className="relative z-10 flex items-center justify-center gap-5 text-2xl tracking-tight">
                <svg className="w-8 h-8 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A10.003 10.003 0 0112 3c1.268 0 2.478.235 3.597.663m3.06 3.06a10.048 10.048 0 012.307 5.711" /></svg>
                Finalizar Jornada
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
            </button>
          </div>
        )}

        {view === 'list' && (
          <div className="space-y-10 animate-in slide-in-from-bottom-6 duration-600">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 px-4">
              <div className="space-y-2">
                <h2 className="text-5xl font-black text-slate-900 tracking-tighter">Diario de <span className="text-indigo-600">Asistencia</span></h2>
                <p className="text-slate-500 text-lg font-bold">Resumen de ingresos y alertas del día</p>
              </div>
              <button 
                onClick={() => { if(confirm("¿Seguro que desea reiniciar el diario de hoy?")) setRecords(records.map(r => ({...r, status: 'pending', time: null, notificationSent: false}))); }}
                className="px-8 py-5 bg-rose-50 hover:bg-rose-600 hover:text-white text-rose-600 rounded-[2rem] text-xs font-black transition-all uppercase tracking-widest border border-rose-100 shadow-sm active:scale-95"
              >
                Limpiar Registros
              </button>
            </div>
            
            <div className="bg-white rounded-[4rem] shadow-2xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[950px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="px-14 py-8 text-[11px] font-black text-slate-300 uppercase tracking-[0.3em]">Alumno / DNI</th>
                      <th className="px-14 py-8 text-[11px] font-black text-slate-300 uppercase tracking-[0.3em]">Grado y Sección</th>
                      <th className="px-14 py-8 text-[11px] font-black text-slate-300 uppercase tracking-[0.3em]">Estado</th>
                      <th className="px-14 py-8 text-[11px] font-black text-slate-300 uppercase tracking-[0.3em]">Hora Entrada</th>
                      <th className="px-14 py-8 text-[11px] font-black text-slate-300 uppercase tracking-[0.3em]">Reporte</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {records.map(record => {
                      const student = students.find(s => s.id === record.studentId);
                      return (
                        <tr key={record.studentId} className="hover:bg-indigo-50/40 transition-all group">
                          <td className="px-14 py-8">
                            <div className="font-black text-slate-900 text-xl group-hover:text-indigo-600 transition-colors leading-none mb-2">{student?.alumno || 'DNI: ' + record.studentId}</div>
                            <div className="text-[10px] text-slate-400 font-black font-mono tracking-widest uppercase opacity-60">Matrícula: {record.studentId}</div>
                          </td>
                          <td className="px-14 py-8">
                            <span className="text-sm font-extrabold text-slate-500 bg-slate-100 px-4 py-1.5 rounded-xl border border-slate-200/50">{student?.grado || 'S/G'}</span>
                          </td>
                          <td className="px-14 py-8">
                            <span className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-sm flex items-center gap-3 w-fit ${
                              record.status === 'present' ? 'bg-emerald-500 text-white shadow-emerald-100' :
                              record.status === 'absent' ? 'bg-rose-500 text-white shadow-rose-100' :
                              'bg-slate-200 text-slate-500'
                            }`}>
                              <div className={`w-2 h-2 rounded-full ${record.status === 'present' ? 'bg-white animate-ping' : record.status === 'absent' ? 'bg-white' : 'bg-slate-400'}`}></div>
                              {record.status === 'present' ? 'Presente' : record.status === 'absent' ? 'Ausente' : 'Pendiente'}
                            </span>
                          </td>
                          <td className="px-14 py-8">
                            <span className="text-sm font-black text-slate-600 tracking-tighter tabular-nums">{record.time || '--:--'}</span>
                          </td>
                          <td className="px-14 py-8">
                             {record.notificationSent ? (
                               <div className="flex items-center gap-2 text-indigo-600 font-black text-[10px] uppercase tracking-widest bg-indigo-50 px-4 py-2 rounded-full w-fit border border-indigo-100">
                                 <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" /></svg>
                                 Enviado
                               </div>
                             ) : (
                               <span className="text-[10px] font-black text-slate-200 uppercase italic tracking-widest">Sin Enviar</span>
                             )}
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
          <div className="space-y-10 animate-in slide-in-from-bottom-6 duration-600">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-8 px-6">
              <div className="space-y-2">
                <h2 className="text-5xl font-black text-slate-900 tracking-tighter">Base de <span className="text-indigo-600">Datos</span></h2>
                <p className="text-slate-500 text-lg font-bold">Gestión de {students.length} alumnos registrados</p>
              </div>
              <div className="relative w-full lg:w-96 group">
                <input 
                  type="text" 
                  placeholder="Buscar alumno o DNI..." 
                  className="w-full pl-16 pr-8 py-6 bg-white border-4 border-slate-50 rounded-[2.5rem] text-sm font-black focus:outline-none focus:border-indigo-600 focus:ring-12 focus:ring-indigo-600/5 transition-all shadow-xl shadow-slate-200/40"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <svg className="w-7 h-7 absolute left-6 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-indigo-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-10">
              {filteredStudents.map(student => (
                <div key={student.id} className="bg-white p-12 rounded-[4rem] border border-slate-100 shadow-sm hover:shadow-2xl hover:-translate-y-3 transition-all group relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-40 h-40 bg-indigo-50/50 rounded-bl-[6rem] -mr-12 -mt-12 transition-all group-hover:bg-indigo-600/10"></div>
                  
                  {/* Botón eliminar */}
                  <button 
                    onClick={() => deleteStudent(student.id)}
                    className="absolute top-6 right-6 z-20 p-3 bg-rose-50 text-rose-500 rounded-full opacity-0 group-hover:opacity-100 hover:bg-rose-500 hover:text-white transition-all shadow-sm"
                    title="Eliminar Estudiante"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>

                  <div className="relative z-10 flex justify-between items-start mb-10">
                    <div className="w-24 h-24 bg-gradient-to-br from-indigo-600 to-indigo-900 rounded-[2.5rem] flex items-center justify-center text-white text-4xl font-black shadow-2xl shadow-indigo-100 group-hover:rotate-12 transition-all">
                      {student.alumno.charAt(0)}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="px-5 py-2 bg-indigo-50 text-indigo-700 rounded-2xl text-[11px] font-black uppercase tracking-widest border border-indigo-100 shadow-sm">
                        {student.grado}
                      </span>
                      <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest tabular-nums">DNI: {student.id}</span>
                    </div>
                  </div>
                  <h3 className="text-3xl font-black text-slate-900 mb-2 group-hover:text-indigo-700 transition-colors tracking-tight">{student.alumno}</h3>
                  <div className="space-y-6 border-t border-slate-50 pt-10">
                    <div className="flex items-center gap-5">
                       <div className="w-12 h-12 rounded-3xl bg-slate-50 flex items-center justify-center text-slate-400 group-hover:text-indigo-600 group-hover:bg-indigo-50 transition-all">
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                       </div>
                       <div className="flex flex-col">
                          <span className="text-[10px] font-black text-slate-300 uppercase leading-none mb-1 tracking-widest">Padre / Tutor</span>
                          <span className="text-lg font-extrabold text-slate-800 tracking-tight">{student.padre}</span>
                       </div>
                    </div>
                    <div className="flex items-center gap-5">
                       <div className="w-12 h-12 rounded-3xl bg-slate-50 flex items-center justify-center text-slate-400 group-hover:text-emerald-600 group-hover:bg-emerald-50 transition-all">
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                       </div>
                       <div className="flex flex-col">
                          <span className="text-[10px] font-black text-slate-300 uppercase leading-none mb-1 tracking-widest">Contacto</span>
                          <span className="text-lg font-extrabold text-slate-800 tracking-tight">{student.contacto}</span>
                       </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === 'reports' && (
          <div className="space-y-12 animate-in slide-in-from-bottom-6 duration-600">
            <div className="px-6 space-y-2">
              <h2 className="text-5xl font-black text-slate-900 tracking-tighter">Historial de <span className="text-indigo-600">Reportes</span></h2>
              <p className="text-slate-500 text-lg font-bold">Bitácora de notificaciones enviadas vía Gemini AI</p>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
               {records.filter(r => r.notificationSent).map(r => {
                 const s = students.find(stud => stud.id === r.studentId);
                 if (!s) return null;
                 return (
                   <div key={r.studentId} className="bg-white overflow-hidden rounded-[5rem] border border-slate-100 shadow-xl hover:shadow-2xl transition-all group">
                      <div className="bg-slate-50 px-12 py-10 flex justify-between items-center border-b border-slate-100">
                         <div className="flex flex-col">
                            <span className="text-[10px] text-slate-300 font-black uppercase tracking-[0.3em] leading-none mb-3">Notificación enviada a</span>
                            <span className="text-xl font-black text-slate-900 tracking-tight">{s.padre}</span>
                         </div>
                         <div className={`flex items-center gap-3 px-6 py-2.5 rounded-full text-[11px] font-black tracking-widest shadow-lg ${r.status === 'present' ? 'bg-emerald-500 text-white shadow-emerald-200' : 'bg-rose-500 text-white shadow-rose-200'}`}>
                           {r.status === 'present' ? 'ASISTENCIA' : 'INASISTENCIA'}
                         </div>
                      </div>
                      <div className="p-12">
                        <div className="flex items-center gap-6 mb-10">
                           <div className="w-16 h-16 rounded-[2rem] bg-indigo-600 flex items-center justify-center text-white text-2xl font-black shadow-2xl shadow-indigo-100">
                              {s.alumno.charAt(0)}
                           </div>
                           <div className="flex flex-col">
                              <p className="font-black text-slate-900 leading-none mb-1.5 text-2xl tracking-tight">{s.alumno}</p>
                              <p className="text-[11px] text-slate-400 font-black uppercase tracking-[0.2em]">{r.time || 'Cierre Diario'} • {r.date}</p>
                           </div>
                        </div>
                        <div className="relative bg-indigo-50/40 p-10 rounded-[3.5rem] text-sm font-extrabold italic text-slate-600 leading-relaxed border border-indigo-100/30">
                           "Estimado(a) {s.padre}, confirmamos que {s.alumno} ha sido registrado con {r.status === 'present' ? 'asistencia' : 'inasistencia'} el día de hoy. Reporte procesado por el sistema inteligente Palmista."
                        </div>
                      </div>
                   </div>
                 );
               })}
            </div>
          </div>
        )}
      </main>

      {/* Navegación Inferior */}
      <nav className="fixed bottom-12 left-1/2 -translate-x-1/2 w-[calc(100%-3.5rem)] max-w-xl bg-slate-950/95 backdrop-blur-3xl rounded-[3.5rem] p-3.5 flex justify-between items-center shadow-[0_35px_60px_-15px_rgba(0,0,0,0.6)] z-[70] border border-white/10 ring-2 ring-white/5">
        {[
          { id: 'scan', label: 'Escanear', icon: 'M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z' },
          { id: 'list', label: 'Diario', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
          { id: 'students', label: 'Alumnos', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
          { id: 'reports', label: 'Reportes', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
        ].map(navItem => (
          <button 
            key={navItem.id}
            onClick={() => setView(navItem.id as any)}
            className={`relative flex-1 py-5 flex flex-col items-center gap-2.5 transition-all duration-500 group ${view === navItem.id ? 'text-white scale-110' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {view === navItem.id && (
              <div className="absolute inset-0 bg-white/5 rounded-[3rem] animate-pulse"></div>
            )}
            <svg className={`w-7 h-7 transition-all ${view === navItem.id ? 'stroke-[2.5px] text-indigo-500' : 'stroke-2'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={navItem.icon} /></svg>
            <span className="text-[9px] font-black uppercase tracking-[0.3em] font-sans">{navItem.label}</span>
            {view === navItem.id && (
              <div className="absolute -bottom-1.5 w-10 h-1.5 bg-indigo-500 rounded-full shadow-[0_0_20px_#6366f1]"></div>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
};

export default App;
