import React from 'react';

export interface PaymentLogItem {
  id: string;
  amount: string;
  computeUnits: number;
  description: string;
  status: 'pending' | 'completed' | 'failed' | 'confirmed';
  transactionId: string;
  txHash?: string;
  chain?: string;
  createdAt: number;
}

interface PaymentLogProps {
  logs: PaymentLogItem[];
}

const PaymentLog: React.FC<PaymentLogProps> = ({ logs }) => {
  return (
    <div className="payment-log">
      <div className="log-list">
        {logs.length === 0 ? (
          <div className="log-empty">No settlements on Arc yet</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="log-item">
              <div className="log-main">
                <div className="log-desc">{log.description}</div>
                <div className="log-tx">TX: {log.transactionId?.slice(0, 12)}...</div>
              </div>
              <div className="log-meta">
                <div className="log-amount">{(parseFloat(log.amount) || 0).toFixed(4)} USDC</div>
                <div className="log-cu">{log.computeUnits} CU</div>
              </div>
            </div>
          ))
        )}
      </div>

      <style>{`
        .payment-log {
          background: #ffffff;
          border-radius: 12px;
          display: flex;
          flex-direction: column;
        }
        .log-list {
          display: flex;
          flex-direction: column;
          gap: 1px;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          overflow: hidden;
        }
        .log-empty {
          background: #ffffff;
          text-align: center;
          padding: 30px 20px;
          color: #94a3b8;
          font-size: 12px;
          font-weight: 500;
        }
        .log-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 14px;
          background: #ffffff;
          transition: background 0.2s;
        }
        .log-item:hover { background: #f8fafc; }
        
        .log-main {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .log-desc {
          font-size: 13px;
          font-weight: 600;
          color: #1e293b;
        }
        .log-tx {
          font-size: 10px;
          color: #94a3b8;
          font-family: monospace;
        }
        
        .log-meta {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
        }
        .log-amount {
          font-size: 13px;
          font-weight: 700;
          color: #3b82f6;
        }
        .log-cu {
          font-size: 10px;
          font-weight: 600;
          color: #64748b;
          background: #f1f5f9;
          padding: 1px 6px;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
};

export default PaymentLog;
