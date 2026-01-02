
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const generateAttendanceMessage = async (
  studentName: string,
  parentName: string,
  status: 'present' | 'absent',
  time?: string
) => {
  const prompt = status === 'present' 
    ? `Genera un mensaje corto y profesional para un padre de familia llamado ${parentName} informando que su hijo(a) ${studentName} ha ingresado a la institución a las ${time}. El tono debe ser informativo y tranquilizador.`
    : `Genera un mensaje urgente pero cordial para un padre de familia llamado ${parentName} informando que su hijo(a) ${studentName} no se ha registrado en la institución hoy. Solicita amablemente que se comunique para justificar la inasistencia.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        temperature: 0.7,
        maxOutputTokens: 150,
      }
    });
    return response.text;
  } catch (error) {
    console.error("Error generating message:", error);
    return status === 'present' 
      ? `Hola ${parentName}, le informamos que ${studentName} ingresó a las ${time}.`
      : `Hola ${parentName}, le informamos que ${studentName} no se ha presentado hoy. Por favor contacte a la institución.`;
  }
};
