
import { GoogleGenAI } from "@google/genai";

export const generateAttendanceMessage = async (
  studentName: string,
  tutorName: string,
  status: 'present' | 'absent',
  time?: string
) => {
  // Always create a new instance inside the function to ensure up-to-date API key
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

  // Prompt ultra-específico con temperatura mínima para garantizar consistencia
  const prompt = status === 'present' 
    ? `Eres un asistente escolar oficial. Escribe un comunicado institucional para el tutor ${tutorName}. 
       EL MENSAJE DEBE SER EXACTAMENTE: "COMUNICADO: El estudiante ${studentName} ASISTIÓ A LA I.E. y registro su asistencia a las ${time}."
       No añadas saludos, ni despedidas, ni texto adicional.`
    : `Eres un asistente escolar oficial. Escribe una alerta para el tutor ${tutorName}.
       EL MENSAJE DEBE SER EXACTAMENTE: "ALERTA: Se informa que el estudiante ${studentName} NO ASISTIÓ A LA I.E. el día de hoy. Por favor, acercarse a la institución para justificar la inasistencia."`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        temperature: 0.1, // Mínima variabilidad para cumplir con el formato predeterminado
        maxOutputTokens: 100,
      }
    });
    
    let text = response.text?.trim() || "";
    
    // Validación de seguridad para asegurar que los términos clave estén presentes
    if (status === 'present' && (!text.includes("registro su asistencia") || !text.includes("ASISTIÓ A LA I.E."))) {
      return `COMUNICADO: El estudiante ${studentName} ASISTIÓ A LA I.E. y registro su asistencia a las ${time}.`;
    }
    
    if (status === 'absent' && !text.includes("NO ASISTIÓ A LA I.E.")) {
      return `ALERTA: Se informa que el estudiante ${studentName} NO ASISTIÓ A LA I.E. el día de hoy. Por favor, acercarse a la institución para justificar la inasistencia.`;
    }

    return text || (status === 'present' 
      ? `COMUNICADO: El estudiante ${studentName} ASISTIÓ A LA I.E. y registro su asistencia a las ${time}.`
      : `ALERTA: Se informa que el estudiante ${studentName} NO ASISTIÓ A LA I.E. Por favor, acercarse a la institución para la justificación respectiva.`);
  } catch (error) {
    console.error("Gemini API Error:", error);
    // Fallback manual idéntico al solicitado
    return status === 'present' 
      ? `COMUNICADO: El estudiante ${studentName} ASISTIÓ A LA I.E. y registro su asistencia a las ${time}.`
      : `ALERTA: Estimado(a) ${tutorName}, se le informa que el estudiante ${studentName} NO ASISTIÓ A LA I.E. el día de hoy. Por favor justificar.`);
  }
};
