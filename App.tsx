
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { INITIAL_STUDENTS } from './constants';
import { Student, AttendanceRecord, AttendanceStatus } from './types';
import QRScanner from './components/QRScanner';
import { generateAttendanceMessage } from './services/geminiService';

// Extender la interfaz para guardar el mensaje generado
interface ExtendedAttendanceRecord extends AttendanceRecord {
  generatedMessage?: string;
}

const App: React.FC = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<ExtendedAttendanceRecord[]>([]);
  const [view, setView] = useState<'scan' | 'list' | 'students' | 'reports'>('scan');
  const [isScanning, setIsScanning] = useState(true);
  const [notifications, setNotifications] = useState<{ id: string; msg: string; type: 'success' | 'alert' | 'info' }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  
  // Estado para selección múltiple
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const lastScannedRef = useRef<{ id: string; time: number } | null>(null);

  const dateKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);

  const displayDate = useMemo(() => new Date().toLocaleDateString('es-ES', { 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
  }), []);

  useEffect(() => {
    // Usar una versión de DB consistente para evitar colisiones con versiones anteriores
    const dbVersion = 'palmista_db_v12_pro';
    const storedStudents = localStorage.getItem(dbVersion);
    let currentStudents: Student[] = [];
    if (storedStudents) {
      currentStudents = JSON.parse(storedStudents);
    } else {
      currentStudents = INITIAL_STUDENTS;
      localStorage.setItem(dbVersion, JSON.stringify(currentStudents));
    }
    setStudents(currentStudents);

    const storedRecords = localStorage.getItem(`palmista_att_${dateKey}`);
    if (storedRecords) {
      setRecords(JSON.parse(storedRecords));
    } else {
      const initialRecords: ExtendedAttendanceRecord[] = currentStudents.map(s => ({
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
    localStorage.setItem('palmista_db_v12_pro', JSON.stringify(students));
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
    if (!confirm("¿Está seguro de eliminar a este estudiante?")) return;
    setStudents(prev => prev.filter(s => s.id !== id));
    setRecords(prev => prev.filter(r => r.studentId !== id));
    setSelectedIds(prev => prev.filter(sid => sid !== id));
    addNotification("Estudiante eliminado", "info");
  };

  const deleteSelectedStudents = () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`¿Está seguro de eliminar a los ${selectedIds.length} estudiantes seleccionados?`)) return;
    
    setStudents(prev => prev.filter(s => !selectedIds.includes(s.id)));
    setRecords(prev => prev.filter(r => !selectedIds.includes(r.studentId)));
    setSelectedIds([]);
    addNotification(`${selectedIds.length} estudiantes eliminados`, "info");
  };

  const toggleSelectStudent = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    const filteredIds = filteredStudents.map(s => s.id);
    if (selectedIds.length === filteredIds.length && filteredIds.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredIds);
    }
  };

  const sendWhatsApp = (phone: string, message: string) => {
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length === 9) cleanPhone = '51' + cleanPhone;
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  const parseScannedData = (data: string) => {
    let parsed: any = null;
    let targetId = data.trim();

    // 1. Intentar detectar JSON (con soporte para comillas relajadas)
    const jsonMatch = data.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        let rawJson = jsonMatch[0];
        // Normalizar JSON: convertir comillas simples a dobles y asegurar comillas en llaves
        let normalizedJson = rawJson
          .replace(/'/g, '"')
          .replace(/([{,])\s*([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
        parsed = JSON.parse(normalizedJson);
      } catch (e) {
        console.warn("Error parseando JSON, intentando modo texto estructurado.");
      }
    }

    // 2. Si no es JSON o falló, intentar parsear texto estructurado (Key:Value)
    if (!parsed) {
      const lines = data.split(/[\n|;,]/);
      const tempMap: any = {};
      lines.forEach(line => {
        const parts = line.split(/[:=]/);
        if (parts.length >= 2) {
          const key = parts[0].trim().toUpperCase();
          const value = parts.slice(1).join(':').trim();
          tempMap[key] = value;
        }
      });

      if (Object.keys(tempMap).length >= 2) {
        parsed = {
          ID: tempMap.ID || tempMap.DNI || tempMap.CODIGO || tempMap.DNI_AQUI,
          alumno: tempMap.ALUMNO || tempMap.NOMBRE || tempMap.ESTUDIANTE || tempMap["USUARIO EJEMPLO"],
          GS: tempMap.GS || tempMap.GRADO || tempMap.SECCION || tempMap.GRADO_SECCION,
          Tutor: tempMap.TUTOR || tempMap.PADRE || tempMap.APODERADO,
          contacto: tempMap.CONTACTO || tempMap.CELULAR || tempMap.TELEFONO || tempMap.WHATSAPP
        };
      }
    }

    if (parsed) {
      targetId = (parsed.ID || parsed.id || parsed.dni || parsed.DNI || targetId).toString();
    }

    return { parsed, targetId };
  };

  const handleScan = useCallback(async (data: string) => {
    if (isProcessing || !data) return;
    
    const { parsed, targetId } = parseScannedData(data);

    // Evitar escaneos duplicados inmediatos (cooldown de 4 segundos)
    const now = Date.now();
    if (lastScannedRef.current?.id === targetId && now - lastScannedRef.current.time < 4000) return;
    lastScannedRef.current = { id: targetId, time: now };

    setIsProcessing(true);
    setIsScanning(false);

    const time = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const existingStudent = students.find(s => s.id === targetId);

    if (existingStudent) {
      const record = records.find(r => r.studentId === existingStudent.id);
      if (record?.status === 'present') {
        addNotification(`${existingStudent.alumno} ya registró ingreso.`, 'info');
      } else {
        try {
          const msg = await generateAttendanceMessage(existingStudent.alumno, existingStudent.tutor, 'present', time);
          setRecords(prev => prev.map(r => 
            r.studentId === existingStudent.id 
              ? { ...r, status: 'present', time, notificationSent: true, generatedMessage: msg }
              : r
          ));
          // ENVÍO AUTOMÁTICO A WHATSAPP
          sendWhatsApp(existingStudent.contacto, msg);
          addNotification(`Ingreso Exitoso y Reporte Enviado: ${existingStudent.alumno}`, 'success');
        } catch (err) {
          addNotification(`Error al procesar reporte IA para ${existingStudent.alumno}`, 'alert');
        }
      }
    } else {
      // Intentar auto-registro si el QR trae la información completa de Palmista QR Assistant
      const studentName = parsed?.alumno || parsed?.nombre || parsed?.["Usuario ejemplo"];
      if (studentName) {
        const newStudent: Student = {
          id: targetId,
          alumno: studentName,
          grado: parsed.GS || parsed.grado || 'S/G',
          tutor: parsed.Tutor || parsed.tutor || parsed["Padre/tutor"] || 'Sin Tutor',
          contacto: parsed.contacto || parsed.celular || 'S/N',
        };
        
        try {
          const msg = await generateAttendanceMessage(newStudent.alumno, newStudent.tutor, 'present', time);
          setStudents(prev => [...prev, newStudent]);
          setRecords(prev => [...prev, {
            studentId: newStudent.id,
            date: dateKey,
            time,
            status: 'present',
            notificationSent: true,
            justificationReceived: false,
            generatedMessage: msg
          }]);
          // ENVÍO AUTOMÁTICO A WHATSAPP PARA NUEVO REGISTRO
          sendWhatsApp(newStudent.contacto, msg);
          addNotification(`Nuevo Alumno Registrado y Reporte Enviado: ${newStudent.alumno}`, 'success');
        } catch (err) {
          addNotification(`Error en auto-registro de ${newStudent.alumno}`, 'alert');
        }
      } else {
        addNotification(`QR Detectado: ID ${targetId} no existe en la base de datos.`, 'alert');
      }
    }

    setTimeout(() => {
      setIsProcessing(false);
      setIsScanning(true);
    }, 1500);
  }, [records, students, isProcessing, dateKey, addNotification]);

  const markAbsences = async () => {
    const pending = records.filter(r => r.status === 'pending');
    if (pending.length === 0) return addNotification("No hay asistencias pendientes por cerrar.", 'info');

    if (!confirm(`¿Cerrar jornada escolar? Se generarán reportes de inasistencia para ${pending.length} estudiantes.`)) return;

    setIsProcessing(true);
    const updatedRecords = [...records];
    for (const rec of pending) {
      const s = students.find(std => std.id === rec.studentId);
      if (s) {
        const msg = await generateAttendanceMessage(s.alumno, s.tutor, 'absent');
        const index = updatedRecords.findIndex(r => r.studentId === rec.studentId);
        updatedRecords[index] = { ...updatedRecords[index], status: 'absent', notificationSent: true, generatedMessage: msg };
        // No enviamos automático en cierre de jornada para no saturar el navegador con 50 pestañas
      }
    }
    setRecords(updatedRecords);
    setIsProcessing(false);
    addNotification("Jornada cerrada con éxito. Los reportes de falta están listos en la sección Reportes.", 'alert');
  };

  const filteredStudents = useMemo(() => students.filter(s => 
    s.alumno.toLowerCase().includes(searchTerm.toLowerCase()) || s.id.includes(searchTerm)
  ), [students, searchTerm]);

  return (
    <div className="min-h-screen bg-slate-50 pb-36 font-sans antialiased">
      <header className="bg-white/95 backdrop-blur-2xl border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4 cursor-pointer group" onClick={() => setView('scan')}>
            <div className="bg-indigo-600 p-2.5 rounded-xl shadow-lg shadow-indigo-100 group-hover:scale-110 transition-transform">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 leading-none mb-1">Palmista <span className="text-indigo-600">Assistant</span></h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Envío Automático Activo • {displayDate}</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="hidden sm:block text-right">
              <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Estado</p>
              <p className="text-sm font-black text-indigo-600">{students.length} alumnos registrados</p>
            </div>
          </div>
        </div>
      </header>

      <div className="fixed top-24 right-4 left-4 z-[100] pointer-events-none flex flex-col gap-3 max-w-md mx-auto sm:mr-8 sm:ml-auto">
        {notifications.map(n => (
          <div key={n.id} className={`p-5 rounded-[2rem] shadow-2xl border-l-[12px] pointer-events-auto animate-in slide-in-from-right overflow-hidden relative ${
            n.type === 'success' ? 'bg-white border-emerald-500' : n.type === 'alert' ? 'bg-white border-rose-500' : 'bg-white border-indigo-500'
          }`}>
             <p className="text-sm font-extrabold text-slate-800 leading-tight">{n.msg}</p>
             <div className="absolute bottom-0 left-0 h-1 bg-slate-100 w-full">
                <div className={`h-full transition-all duration-[6000ms] ease-linear ${n.type === 'success' ? 'bg-emerald-500' : n.type === 'alert' ? 'bg-rose-500' : 'bg-indigo-500'}`} style={{width: '0%'}}></div>
             </div>
          </div>
        ))}
      </div>

      <main className="max-w-7xl mx-auto p-6 sm:p-10">
        {view === 'scan' && (
          <div className="flex flex-col items-center gap-10 animate-in zoom-in">
            <div className="text-center space-y-3 max-w-xl">
              <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-600 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest mb-2 border border-emerald-100">
                 <span className="w-2 h-2 bg-emerald-600 rounded-full animate-ping"></span>
                 WhatsApp Auto-Sync Activado
              </div>
              <h2 className="text-5xl font-black text-slate-900 tracking-tighter">Panel de <span className="text-indigo-600">Registro</span></h2>
              <p className="text-slate-500 font-bold leading-relaxed">Los reportes se enviarán <span className="text-indigo-900 font-black">automáticamente</span> al WhatsApp del tutor al detectar el QR.</p>
              <div className="flex gap-2 justify-center">
                <button onClick={() => setShowHelp(!showHelp)} className="bg-white border-2 border-slate-100 px-6 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:border-indigo-600 transition-colors shadow-sm">Configuración de Formato</button>
              </div>
            </div>

            {showHelp && (
              <div className="w-full max-w-lg bg-slate-950 text-indigo-100 p-8 rounded-[3rem] font-mono text-[11px] shadow-2xl animate-in zoom-in border-4 border-indigo-500/20">
                <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-3">
                   <span className="text-emerald-400 font-black">ESTRUCTURA SOPORTADA</span>
                   <span className="text-slate-500">v8.2</span>
                </div>
                <pre className="whitespace-pre-wrap leading-relaxed">
{`{
  "ID": "74859632",
  "alumno": "JUAN PEREZ",
  "GS": "3ro Secundaria",
  "Tutor": "MARIA PEREZ",
  "contacto": "987654321"
}`}
                </pre>
                <p className="mt-4 text-[9px] text-slate-500 italic">Nota: Asegúrese de permitir pop-ups en su navegador para que el envío automático funcione correctamente.</p>
              </div>
            )}

            <div className="w-full max-w-md relative group">
              <div className="absolute -inset-4 bg-gradient-to-tr from-indigo-500 to-emerald-500 rounded-[4rem] blur-3xl opacity-10 group-hover:opacity-20 transition-opacity"></div>
              <div className="relative">
                <QRScanner onScan={handleScan} isScanning={isScanning} />
                {isProcessing && (
                  <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-md rounded-[2.5rem] flex items-center justify-center z-20">
                    <div className="flex flex-col items-center gap-4">
                       <div className="w-16 h-16 border-4 border-white border-t-indigo-500 rounded-full animate-spin"></div>
                       <span className="font-black text-white text-xs tracking-[0.3em]">PROCESANDO Y ENVIANDO...</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <button onClick={markAbsences} className="w-full max-w-md bg-slate-950 hover:bg-black text-white font-black py-8 rounded-[3rem] shadow-2xl transition-all flex items-center justify-center gap-6 text-2xl group relative overflow-hidden">
              <span className="relative z-10 flex items-center gap-4">
                 <svg className="w-8 h-8 text-indigo-500 group-hover:scale-125 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
                 Cerrar Diario del Día
              </span>
              <div className="absolute inset-0 bg-indigo-600/10 -translate-x-full group-hover:translate-x-0 transition-transform duration-500"></div>
            </button>
          </div>
        )}

        {view === 'list' && (
          <div className="space-y-8 animate-in slide-in-from-bottom-6">
            <div className="flex justify-between items-end px-4">
               <div>
                 <h2 className="text-4xl font-black text-slate-900 tracking-tighter">Reporte <span className="text-indigo-600">Diario</span></h2>
                 <p className="text-slate-500 font-bold">Bitácora de hoy ({records.length} total)</p>
               </div>
               <button onClick={() => { if(confirm("¿Desea limpiar los registros de hoy?")) setRecords(records.map(r => ({...r, status: 'pending', time: null, notificationSent: false, generatedMessage: ''})))}} className="text-rose-600 text-[10px] font-black uppercase tracking-widest border-2 border-rose-50 px-5 py-2 rounded-xl hover:bg-rose-50 transition-colors">Reiniciar Diario</button>
            </div>
            
            <div className="bg-white rounded-[4rem] shadow-2xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr className="text-[11px] font-black text-slate-300 uppercase tracking-[0.2em]">
                      <th className="px-12 py-8">Estudiante / DNI</th>
                      <th className="px-12 py-8">Estado de Asistencia</th>
                      <th className="px-12 py-8">Hora Registro</th>
                      <th className="px-12 py-8 text-center">Reporte WhatsApp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {records.map(r => {
                      const s = students.find(std => std.id === r.studentId);
                      return (
                        <tr key={r.studentId} className="hover:bg-indigo-50/30 transition-all group">
                          <td className="px-12 py-8">
                             <div className="font-black text-slate-900 text-lg group-hover:text-indigo-600 transition-colors">{s?.alumno || 'DNI: ' + r.studentId}</div>
                             <div className="text-[10px] text-slate-400 font-bold font-mono tracking-tighter">{s?.grado || 'Sin Grado'}</div>
                          </td>
                          <td className="px-12 py-8">
                            <span className={`px-5 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 w-fit shadow-sm ${
                              r.status === 'present' ? 'bg-emerald-500 text-white' : 
                              r.status === 'absent' ? 'bg-rose-500 text-white' : 
                              'bg-slate-200 text-slate-500'
                            }`}>
                              <div className={`w-1.5 h-1.5 rounded-full ${r.status === 'present' ? 'bg-white animate-pulse' : 'bg-current'}`}></div>
                              {r.status === 'present' ? 'Presente' : r.status === 'absent' ? 'Ausente' : 'En Espera'}
                            </span>
                          </td>
                          <td className="px-12 py-8 text-sm font-black text-slate-600 tabular-nums">{r.time || '--:--'}</td>
                          <td className="px-12 py-8 text-center">
                            {r.notificationSent ? (
                              <div className="inline-flex items-center gap-1.5 text-indigo-600 font-black text-[10px] uppercase bg-indigo-50 px-3 py-1.5 rounded-full">
                                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                                Enviado
                              </div>
                            ) : <span className="text-[10px] text-slate-200 font-bold">No enviado</span>}
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
          <div className="space-y-8 animate-in slide-in-from-bottom-6">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6 px-4">
              <div>
                <h2 className="text-4xl font-black text-slate-900 tracking-tighter">Base <span className="text-indigo-600">Estudiantil</span></h2>
                <p className="text-slate-500 font-bold">Gestión centralizada de matriculados</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-4 w-full lg:w-auto">
                <div className="relative flex-1 sm:w-80">
                  <input 
                    type="text" 
                    placeholder="Buscar alumno o ID..." 
                    value={searchTerm} 
                    onChange={e => setSearchTerm(e.target.value)} 
                    className="bg-white border-4 border-slate-100 rounded-[2rem] pl-14 pr-6 py-4 text-sm font-bold focus:border-indigo-600 outline-none w-full shadow-xl shadow-slate-200/40 transition-all" 
                  />
                  <svg className="w-6 h-6 absolute left-5 top-1/2 -translate-y-1/2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                </div>
                {selectedIds.length > 0 && (
                  <button 
                    onClick={deleteSelectedStudents}
                    className="bg-rose-600 text-white px-8 py-4 rounded-[2rem] font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 animate-in zoom-in shadow-xl shadow-rose-100 active:scale-95 transition-transform"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    Eliminar Selección ({selectedIds.length})
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4 bg-white/50 p-4 rounded-3xl border border-slate-100">
               <input 
                type="checkbox" 
                className="w-6 h-6 rounded-xl border-2 border-slate-200 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                checked={selectedIds.length === filteredStudents.length && filteredStudents.length > 0}
                onChange={toggleSelectAll}
               />
               <span className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Seleccionar Todos los Resultados</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
              {filteredStudents.map(s => (
                <div key={s.id} className={`bg-white p-10 rounded-[4rem] border-4 transition-all relative group overflow-hidden ${selectedIds.includes(s.id) ? 'border-indigo-600 shadow-2xl scale-[1.02]' : 'border-transparent shadow-sm hover:shadow-xl'}`}>
                  <div className="absolute top-0 right-0 w-32 h-32 bg-slate-50/50 rounded-bl-[4rem] -mr-8 -mt-8 group-hover:bg-indigo-50/80 transition-colors"></div>
                  
                  {/* Selector Múltiple */}
                  <input 
                    type="checkbox" 
                    className="absolute top-10 left-10 w-7 h-7 rounded-xl border-2 border-slate-200 text-indigo-600 focus:ring-indigo-500 z-10 cursor-pointer"
                    checked={selectedIds.includes(s.id)}
                    onChange={() => toggleSelectStudent(s.id)}
                  />
                  
                  {/* Botón eliminar individual */}
                  <button 
                    onClick={() => deleteStudent(s.id)} 
                    className="absolute top-8 right-8 p-3 bg-rose-50 text-rose-500 rounded-2xl opacity-0 group-hover:opacity-100 transition-all z-10 hover:bg-rose-500 hover:text-white shadow-sm"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>

                  <div className="pt-12 flex flex-col items-center text-center">
                    <div className="w-24 h-24 bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-[2.5rem] flex items-center justify-center text-4xl font-black text-white mb-6 shadow-2xl shadow-indigo-100 group-hover:rotate-6 transition-all">
                      {s.alumno[0]}
                    </div>
                    <h3 className="text-2xl font-black text-slate-900 mb-2 leading-tight tracking-tight">{s.alumno}</h3>
                    <div className="px-5 py-1.5 bg-indigo-50 text-indigo-700 rounded-full text-[10px] font-black uppercase tracking-widest mb-8 border border-indigo-100">{s.grado}</div>
                    
                    <div className="w-full space-y-4 pt-8 border-t border-slate-50">
                      <div className="flex justify-between items-center px-2">
                        <span className="text-[10px] text-slate-300 font-black uppercase tracking-widest">Identificación</span>
                        <span className="text-sm font-black text-slate-700 font-mono">{s.id}</span>
                      </div>
                      <div className="flex justify-between items-center px-2">
                        <span className="text-[10px] text-slate-300 font-black uppercase tracking-widest">Tutor</span>
                        <span className="text-sm font-extrabold text-slate-800">{s.tutor}</span>
                      </div>
                      <div className="flex justify-between items-center px-2">
                        <span className="text-[10px] text-slate-300 font-black uppercase tracking-widest">WhatsApp</span>
                        <span className="text-sm font-black text-emerald-600 tracking-tighter">{s.contacto}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === 'reports' && (
          <div className="space-y-8 animate-in slide-in-from-bottom-6">
            <div className="px-4">
               <h2 className="text-4xl font-black text-slate-900 tracking-tighter">Centro de <span className="text-indigo-600">Notificaciones</span></h2>
               <p className="text-slate-500 font-bold">Historial de reportes gestionados por Palmista Assistant</p>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
              {records.filter(r => r.notificationSent).map(r => {
                const s = students.find(stud => stud.id === r.studentId);
                if (!s) return null;
                return (
                  <div key={r.studentId} className="bg-white rounded-[4rem] shadow-xl border border-slate-100 flex flex-col group overflow-hidden transition-all hover:shadow-2xl">
                    <div className="bg-slate-50 p-10 flex justify-between items-center border-b border-slate-100">
                      <div className="flex items-center gap-6">
                        <div className="w-16 h-16 bg-indigo-600 rounded-[1.5rem] flex items-center justify-center text-white text-3xl font-black shadow-lg">
                          {s.alumno[0]}
                        </div>
                        <div>
                          <p className="font-black text-slate-900 text-xl leading-none mb-1.5">{s.alumno}</p>
                          <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{r.time || 'Ausente'} • {r.date}</p>
                        </div>
                      </div>
                      <div className={`px-5 py-2 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-sm ${r.status === 'present' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
                        {r.status === 'present' ? 'ENTRADA' : 'FALTA'}
                      </div>
                    </div>
                    
                    <div className="p-10 flex flex-col gap-8">
                       <div className="relative">
                          <div className="absolute -left-4 top-0 w-1 h-full bg-indigo-100 rounded-full"></div>
                          <p className="text-base text-slate-600 font-medium italic leading-relaxed">
                            "{r.generatedMessage || "Sincronizando reporte..."}"
                          </p>
                       </div>

                       <div className="flex flex-col gap-3">
                          <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest text-center">Re-enviar Reporte a {s.tutor}</p>
                          <button 
                            onClick={() => sendWhatsApp(s.contacto, r.generatedMessage || "")}
                            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black py-6 rounded-[2.5rem] transition-all flex items-center justify-center gap-4 shadow-xl shadow-emerald-100 active:scale-95 group"
                          >
                            <svg className="w-7 h-7 group-hover:rotate-12 transition-transform" fill="currentColor" viewBox="0 0 24 24"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766 0-3.187-2.59-5.771-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.744-2.834-2.521-2.921-2.637-.087-.117-.708-.941-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217s.231.001.332.005c.109.004.258-.041.404.314.159.386.541 1.32.588 1.417.049.098.082.213.017.346s-.097.215-.195.328c-.099.114-.208.254-.297.34-.099.097-.202.203-.087.401.115.197.511.844 1.1 1.369.758.677 1.397.887 1.597.986s.311.083.426-.05c.115-.132.511-.595.648-.793s.273-.165.462-.097c.187.068 1.182.557 1.385.66s.339.155.388.242c.049.087.049.505-.095.91z"/></svg>
                            Enviar a WhatsApp
                          </button>
                       </div>
                    </div>
                  </div>
                );
              })}
              {records.filter(r => r.notificationSent).length === 0 && (
                <div className="col-span-full py-20 text-center bg-white rounded-[4rem] border-4 border-dashed border-slate-100">
                   <p className="text-slate-300 font-black uppercase tracking-[0.3em]">No hay reportes hoy</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <nav className="fixed bottom-8 left-1/2 -translate-x-1/2 w-[calc(100%-3rem)] max-w-lg bg-slate-950/95 backdrop-blur-2xl rounded-[3.5rem] p-2 flex justify-around items-center shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6)] z-50 border border-white/10 ring-1 ring-white/5">
        {[
          { id: 'scan', label: 'Escanear', icon: 'M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z' },
          { id: 'list', label: 'Diario', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
          { id: 'students', label: 'Alumnos', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
          { id: 'reports', label: 'Reportes', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
        ].map(nav => (
          <button key={nav.id} onClick={() => setView(nav.id as any)} className={`flex flex-col items-center p-4 transition-all relative ${view === nav.id ? 'text-indigo-400 scale-110' : 'text-slate-500 hover:text-slate-300'}`}>
            <svg className={`w-7 h-7 transition-all ${view === nav.id ? 'stroke-[2.5px]' : 'stroke-2'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={nav.icon} /></svg>
            <span className="text-[9px] font-black uppercase mt-1.5 tracking-[0.2em]">{nav.label}</span>
            {view === nav.id && <div className="absolute -bottom-1 w-12 h-1 bg-indigo-500 rounded-full shadow-[0_0_15px_#6366f1]"></div>}
          </button>
        ))}
      </nav>
    </div>
  );
};

export default App;
