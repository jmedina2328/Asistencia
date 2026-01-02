
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
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.play();
          requestAnimationFrame(tick);
        }
      } catch (err) {
        setError("No se pudo acceder a la cámara. Por favor asegúrese de dar permisos.");
        console.error(err);
      }
    };

    const tick = () => {
      if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA && canvasRef.current) {
        const canvas = canvasRef.current;
        const video = videoRef.current;
        canvas.height = video.videoHeight;
        canvas.width = video.videoWidth;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });

          if (code && isScanning) {
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
    <div className="relative w-full max-w-md mx-auto aspect-square overflow-hidden rounded-2xl bg-slate-900 shadow-2xl border-4 border-indigo-500">
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-white bg-rose-600/90">
          <p>{error}</p>
        </div>
      ) : (
        <>
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute inset-0 border-[40px] border-black/30 pointer-events-none">
            <div className="absolute inset-0 border-2 border-indigo-400 animate-pulse m-8"></div>
          </div>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 px-4 py-2 rounded-full text-white text-sm font-medium backdrop-blur-md">
            Apunta al código QR del estudiante
          </div>
        </>
      )}
    </div>
  );
};

export default QRScanner;
