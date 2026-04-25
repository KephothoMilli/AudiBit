import React, { useEffect, useState } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
  const [phase, setPhase] = useState<'logo' | 'brand' | 'tagline' | 'exit'>('logo');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('brand'),    500);
    const t2 = setTimeout(() => setPhase('tagline'),  1100);
    const t3 = setTimeout(() => setPhase('exit'),     2200);
    const t4 = setTimeout(() => onComplete(),         2800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [onComplete]);

  return (
    <div className={`splash ${phase === 'exit' ? 'splash--exit' : ''}`}>
      {/* Subtle geometric background */}
      <div className="splash__bg" />

      <div className={`splash__content ${phase !== 'logo' ? 'splash__content--up' : ''}`}>
        <div className="splash__logo">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="12" fill="url(#logoAzure)" />
            <path d="M24 12L36 34H12L24 12Z" fill="white" opacity="0.95" />
            <path d="M24 24L30 34H18L24 24Z" fill="#1e1b4b" opacity="0.4" />
            <defs>
              <linearGradient id="logoAzure" x1="0" y1="0" x2="48" y2="48">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#4338ca" />
              </linearGradient>
            </defs>
          </svg>
          <div className="splash__logo-shadow" />
        </div>

        <div className={`splash__brand ${phase === 'brand' || phase === 'tagline' ? 'splash__brand--visible' : ''}`}>
          <h1 className="splash__brand-name">Audi<span className="text-azure">Bit</span></h1>
          <p className={`splash__tagline ${phase === 'tagline' ? 'splash__tagline--visible' : ''}`}>
            Economic OS for Web Audits
          </p>
        </div>
      </div>

      <div className={`splash__loader ${phase === 'tagline' || phase === 'exit' ? 'splash__loader--visible' : ''}`}>
        <div className="splash__loader-bar" />
      </div>

      <style>{`
        .splash {
          position: fixed;
          top: 0;
          left: 0;
          width: 420px;
          height: 600px;
          background: #ffffff;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          transition: opacity 0.6s ease;
          overflow: hidden;
          font-family: 'Inter', -apple-system, sans-serif;
        }
        .splash--exit { opacity: 0; pointer-events: none; }

        .splash__bg {
          position: absolute;
          inset: 0;
          background-image: radial-gradient(circle at 50% 50%, #f8fafc 0%, #ffffff 100%);
          opacity: 0.6;
        }

        .splash__content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
          transition: transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .splash__content--up { transform: translateY(-16px); }

        .splash__logo {
          position: relative;
          filter: drop-shadow(0 10px 15px rgba(59, 130, 246, 0.2));
          animation: logoScale 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes logoScale {
          from { transform: scale(0.6); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }

        .splash__logo-shadow {
          position: absolute;
          bottom: -10px;
          left: 50%;
          transform: translateX(-50%);
          width: 30px;
          height: 4px;
          background: rgba(0, 0, 0, 0.05);
          filter: blur(4px);
          border-radius: 50%;
        }

        .splash__brand {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          opacity: 0;
          transform: translateY(12px);
          transition: all 0.6s ease;
        }
        .splash__brand--visible { opacity: 1; transform: translateY(0); }

        .splash__brand-name {
          font-size: 32px;
          font-weight: 800;
          color: #0f172a;
          letter-spacing: -1px;
        }
        .text-azure { color: #3b82f6; }

        .splash__tagline {
          font-size: 13px;
          font-weight: 500;
          color: #64748b;
          letter-spacing: 0.5px;
          opacity: 0;
          transition: opacity 0.5s ease 0.2s;
        }
        .splash__tagline--visible { opacity: 1; }

        .splash__loader {
          position: absolute;
          bottom: 60px;
          width: 120px;
          height: 3px;
          background: #f1f5f9;
          border-radius: 10px;
          overflow: hidden;
          opacity: 0;
          transition: opacity 0.3s ease;
        }
        .splash__loader--visible { opacity: 1; }

        .splash__loader-bar {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #6366f1);
          width: 0%;
          border-radius: 10px;
          animation: fillLoader 1.5s ease-in-out forwards;
        }
        @keyframes fillLoader {
          from { width: 0%; }
          to { width: 100%; }
        }
      `}</style>
    </div>
  );
};

export default SplashScreen;
