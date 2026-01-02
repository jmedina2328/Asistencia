
import { GoogleGenAI } from "@google/genai";

export const generateAttendanceMessage = async (
  studentName: string,
  parentName: string,
  status: 'present' | 'absent',
  time?: string
) => {
  // Always create a new instance inside the function to ensure up-to-date API key
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

  const prompt = status === 'present' 
    ? `Eres un asistente escolar automatizado. Escribe un mensaje de WhatsApp/Texto extremadamente corto y profesional para el representante ${parentName}. Infórmale que el estudiante ${studentName} ingresó a la escuela a las ${time}. Sé cordial.`
    : `Eres un asistente escolar automatizado. Escribe un mensaje urgente pero muy amable para el representante ${parentName}. Infórmale que el estudiante ${studentName} no se ha registrado hoy. Solicita que se acerque a la institución para justificar la falta. Sé breve.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        temperature: 0.5,
        maxOutputTokens: 100,
      }
    });
    
    return response.text?.trim() || (status === 'present' 
      ? `Confirmamos el ingreso de ${studentName} a las ${time}.`
      : `Reportamos la inasistencia de ${studentName}. Por favor justificar.`);
  } catch (error) {
    console.error("Gemini API Error:", error);
    return status === 'present' 
      ? `Hola ${parentName}, le informamos que ${studentName} ingresó a las ${time}.`
      : `Hola ${parentName}, le informamos que ${studentName} no se ha presentado hoy. Por favor contacte a la institución.`;
  }
};
