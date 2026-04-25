/**
 * Agent Status Panel
 * 
 * Shows real-time status of agent execution at the bottom of the popup
 */

import React from 'react';

export interface AgentStatus {
    agentType: 'ui' | 'ux' | 'dom' | 'security' | 'coordinator';
    status: 'idle' | 'analyzing' | 'settling' | 'complete' | 'error' | 'bridging';
    message: string;
    progress?: number; // 0-100
    timestamp: number;
}

interface AgentStatusPanelProps {
    status: AgentStatus | null;
}

const AgentStatusPanel: React.FC<AgentStatusPanelProps> = ({ status }) => {
    if (!status || status.status === 'idle') {
        return null;
    }

    const getAgentIcon = (type: string) => {
        switch (type) {
            case 'ui': return '🎨';
            case 'ux': return '🧠';
            case 'dom': return '🏗️';
            case 'security': return '🛡️';
            case 'coordinator': return '🚀';
            default: return '🤖';
        }
    };

    const getStatusColor = (s: string) => {
        switch (s) {
            case 'analyzing': return '#3b82f6';
            case 'settling': return '#f59e0b';
            case 'complete': return '#22c55e';
            case 'error': return '#ef4444';
            case 'bridging': return '#8b5cf6';
            default: return '#64748b';
        }
    };

    const getStatusText = (s: string) => {
        switch (s) {
            case 'analyzing': return 'Analyzing...';
            case 'settling': return 'Settling payment...';
            case 'complete': return 'Complete';
            case 'error': return 'Error';
            case 'bridging': return 'Bridging Funds...';
            default: return 'Processing...';
        }
    };

    return (
        <div className="agent-status-panel">
            <div className="status-content">
                <div className="status-icon">
                    {getAgentIcon(status.agentType)}
                </div>
                <div className="status-info">
                    <div className="status-header">
                        <span className="agent-name">
                            {status.agentType.toUpperCase()} Agent
                        </span>
                        <span
                            className="status-badge"
                            style={{ backgroundColor: getStatusColor(status.status) }}
                        >
                            {getStatusText(status.status)}
                        </span>
                    </div>
                    <div className="status-message">{status.message}</div>
                    {status.progress !== undefined && status.status === 'analyzing' && (
                        <div className="progress-bar">
                            <div
                                className="progress-fill"
                                style={{ width: `${status.progress}%` }}
                            />
                        </div>
                    )}
                </div>
            </div>

            <style>{`
        .agent-status-panel {
          background: rgba(30, 41, 59, 0.8);
          backdrop-filter: blur(12px);
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          padding: 16px;
          z-index: 1000;
          animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.4);
        }

        @keyframes slideUp {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        .status-content {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .status-icon {
          font-size: 32px;
          filter: drop-shadow(0 0 8px rgba(59, 130, 246, 0.5));
          animation: pulse 2s infinite cubic-bezier(0.4, 0, 0.6, 1);
        }

        @keyframes pulse {
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.1);
            opacity: 0.8;
          }
        }

        .status-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .status-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .agent-name {
          font-size: 14px;
          font-weight: 800;
          color: #ffffff;
          letter-spacing: 1px;
          text-transform: uppercase;
        }

        .status-badge {
          font-size: 10px;
          font-weight: 900;
          color: white;
          padding: 4px 10px;
          border-radius: 100px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }

        .status-message {
          font-size: 13px;
          color: #e2e8f0;
          line-height: 1.5;
          font-weight: 500;
        }

        .progress-bar {
          width: 100%;
          height: 6px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 100px;
          overflow: hidden;
          margin-top: 4px;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #8b5cf6, #3b82f6);
          background-size: 200% 100%;
          border-radius: 100px;
          transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
          animation: shimmer 2s infinite linear;
        }

        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
        </div>
    );
};

export default AgentStatusPanel;
