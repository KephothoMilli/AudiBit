import React, { useState } from 'react';
import type { HeuristicResult } from '../dom-monitor';

interface OverlayProps {
  issues: HeuristicResult[];
  onAuditRequest: () => void;
  onDismiss: () => void;
}

const Overlay: React.FC<OverlayProps> = ({ issues, onAuditRequest, onDismiss }) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (issues.length === 0) return null;

  const currentIssue = issues[currentIndex];

  return (
    <div className="audibit-overlay-card">
      <div className="header">
        <span className="logo">Audibit Sentinel</span>
        <button onClick={onDismiss} className="close-btn">&times;</button>
      </div>
      
      <div className="content">
        <div className={`severity-badge ${currentIssue.severity}`}>
          {currentIssue.severity.toUpperCase()}
        </div>
        <h3>{currentIssue.title}</h3>
        <p>{currentIssue.description}</p>
        <div className="selector-code">
          <code>{currentIssue.selector}</code>
        </div>
      </div>

      <div className="footer">
        <div className="pagination">
          <button 
            disabled={currentIndex === 0} 
            onClick={() => setCurrentIndex(i => i - 1)}
          >
            &larr;
          </button>
          <span>{currentIndex + 1} / {issues.length}</span>
          <button 
            disabled={currentIndex === issues.length - 1} 
            onClick={() => setCurrentIndex(i => i + 1)}
          >
            &rarr;
          </button>
        </div>
        <button onClick={onAuditRequest} className="audit-btn">
          Run Detailed AI Audit
        </button>
      </div>

      <style>{`
        .audibit-overlay-card {
          position: fixed;
          bottom: 24px;
          right: 24px;
          width: 320px;
          background: #1a1b1e;
          color: #ffffff;
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          z-index: 1000000;
          border: 1px solid #333;
          overflow: hidden;
          animation: slideUp 0.3s ease-out;
        }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .header {
          padding: 12px 16px;
          background: #25262b;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #333;
        }
        .logo { font-weight: bold; color: #4dabf7; font-size: 14px; }
        .close-btn { background: none; border: none; color: #909296; cursor: pointer; font-size: 20px; }
        .content { padding: 16px; }
        .severity-badge { 
          display: inline-block; 
          padding: 2px 8px; 
          border-radius: 4px; 
          font-size: 10px; 
          font-weight: bold;
          margin-bottom: 8px;
        }
        .critical { background: #c92a2a; }
        .high { background: #e67700; }
        .medium { background: #fab005; color: #000; }
        .low { background: #5c940d; }
        h3 { font-size: 16px; margin: 0 0 8px 0; color: #e9ecef; }
        p { font-size: 13px; color: #adb5bd; line-height: 1.4; margin: 0 0 12px 0; }
        .selector-code { 
          background: #2c2e33; 
          padding: 8px; 
          border-radius: 4px; 
          font-family: monospace; 
          font-size: 11px;
          color: #82c91e;
          overflow-x: auto;
        }
        .footer { padding: 12px 16px; background: #25262b; border-top: 1px solid #333; }
        .pagination { display: flex; justify-content: center; align-items: center; gap: 12px; margin-bottom: 12px; }
        .pagination button { background: #373a40; border: none; color: white; border-radius: 4px; padding: 4px 8px; cursor: pointer; }
        .pagination button:disabled { opacity: 0.3; cursor: not-allowed; }
        .pagination span { font-size: 12px; color: #adb5bd; }
        .audit-btn { 
          width: 100%; 
          padding: 10px; 
          background: #228be6; 
          color: white; 
          border: none; 
          border-radius: 6px; 
          font-weight: bold; 
          cursor: pointer;
          transition: background 0.2s;
        }
        .audit-btn:hover { background: #1c7ed6; }
      `}</style>
    </div>
  );
};

export default Overlay;
