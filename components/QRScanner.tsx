
import React, { useRef, useEffect, useState } from 'react';

interface QRScannerProps {
  onScan: (data: string) => void;
  isScanning: boolean;
}

declare const jsQR: any;

const QRScanner: React.FC<QRScannerProps> = ({ onScan, isScanning }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let animationId: number;

    const startCamera = async () => {
      try {
        const constraints = {
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            focusMode: 'continuous' as any
          }
        };
        
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          await videoRef.current.play();
          requestAnimationFrame(tick);
        }
      } catch (err) {
        setError("Error al acceder a la cámara. Por favor, otorgue permisos.");
        console.error(err);
      }
    };

    const tick = () => {
      if (!isScanning) return;

      if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA && canvasRef.current) {
        const canvas = canvasRef.current;
        const video = videoRef.current;
        
        // Mantener una resolución de escaneo eficiente
        const displayWidth = 640;
        const scale = displayWidth / video.videoWidth;
        canvas.width = displayWidth;
        canvas.height = video.videoHeight * scale;
        
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          
          // Motor de detección jsQR con intentos de inversión para códigos en pantallas o impresos
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "attemptBoth",
          });

          if (code && code.data) {
            onScan(code.data);
          }
        }
      }
      animationId = requestAnimationFrame(tick);
    };

    if (isScanning) {
      startCamera();
    } else {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      cancelAnimationFrame(animationId);
    };
  }, [isScanning, onScan]);

  return (
    <div className="relative w-full max-w-md mx-auto aspect-square overflow-hidden rounded-[2.5rem] bg-black shadow-2xl border-4 border-indigo-500 ring-4 ring-indigo-500/20 group">
      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center text-white bg-rose-900/90 backdrop-blur-md">
          <svg className="w-16 h-16 mb-4 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <p className="font-black text-sm uppercase tracking-widest">{error}</p>
        </div>
      ) : (
        <>
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" />
          <canvas ref={canvasRef} className="hidden" />
          
          {/* Superposición de Visor */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-64 h-64 border-2 border-white/30 rounded-3xl relative">
              <div className="absolute -top-1 -left-1 w-12 h-12 border-t-8 border-l-8 border-indigo-500 rounded-tl-2xl"></div>
              <div className="absolute -top-1 -right-1 w-12 h-12 border-t-8 border-r-8 border-indigo-500 rounded-tr-2xl"></div>
              <div className="absolute -bottom-1 -left-1 w-12 h-12 border-b-8 border-l-8 border-indigo-500 rounded-bl-2xl"></div>
              <div className="absolute -bottom-1 -right-1 w-12 h-12 border-b-8 border-r-8 border-indigo-500 rounded-br-2xl"></div>
              
              {/* Animación de línea de escaneo */}
              <div className="absolute top-0 left-0 w-full h-1 bg-indigo-400 shadow-[0_0_15px_#6366f1] animate-[scan_2s_ease-in-out_infinite]"></div>
            </div>
          </div>
          
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-indigo-600/90 backdrop-blur-xl px-6 py-2 rounded-full border border-white/20">
            <p className="text-[10px] font-black text-white uppercase tracking-[0.3em] whitespace-nowrap">Alinee el código QR</p>
          </div>
        </>
      )}
      <style>{`
        @keyframes scan {
          0%, 100% { top: 5%; opacity: 0.2; }
          50% { top: 95%; opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default QRScanner;
