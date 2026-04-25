import React from 'react';

export interface ErrorModalProps {
    title: string;
    message: string;
    type: 'insufficient_funds' | 'api_error' | 'network_error' | 'general_error';
    walletAddress?: string;
    requiredAmount?: string;
    currentBalance?: string;
    onClose: () => void;
    onAction?: () => void;
}

const ErrorModal: React.FC<ErrorModalProps> = ({
    title,
    message,
    type,
    walletAddress,
    requiredAmount,
    currentBalance,
    onClose,
    onAction,
}) => {
    const renderContent = () => {
        switch (type) {
            case 'insufficient_funds':
                return (
                    <div className="error-content">
                        <div className="error-icon">💰</div>
                        <h2>{title}</h2>
                        <p className="error-message">{message}</p>

                        {requiredAmount && currentBalance && (
                            <div className="balance-info">
                                <div className="balance-row">
                                    <span className="label">Required:</span>
                                    <span className="value required">{requiredAmount} USDC</span>
                                </div>
                                <div className="balance-row">
                                    <span className="label">Current:</span>
                                    <span className="value current">{currentBalance} USDC</span>
                                </div>
                            </div>
                        )}

                        {walletAddress && (
                            <div className="instructions">
                                <h3>How to add funds:</h3>
                                <ol>
                                    <li>Visit <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">Circle Faucet</a></li>
                                    <li>Enter your wallet address:
                                        <div className="wallet-address">
                                            <code>{walletAddress}</code>
                                            <button
                                                className="copy-btn"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(walletAddress);
                                                    alert('Address copied!');
                                                }}
                                                title="Copy address"
                                            >
                                                📋
                                            </button>
                                        </div>
                                    </li>
                                    <li>Select <strong>Arc Testnet</strong></li>
                                    <li>Request testnet USDC</li>
                                    <li>Wait 10-30 seconds for tokens to arrive</li>
                                    <li>Try your audit again</li>
                                </ol>
                            </div>
                        )}

                        <div className="actions">
                            <button
                                className="btn btn-primary"
                                onClick={() => {
                                    window.open(`https://faucet.circle.com?address=${walletAddress}&network=arc-testnet`, '_blank');
                                }}
                            >
                                Open Faucet
                            </button>
                            <button className="btn btn-secondary" onClick={onClose}>
                                Close
                            </button>
                        </div>
                    </div>
                );

            case 'api_error':
                return (
                    <div className="error-content">
                        <div className="error-icon">🤖</div>
                        <h2>{title}</h2>
                        <p className="error-message">{message}</p>

                        <div className="instructions">
                            <h3>Possible causes:</h3>
                            <ul>
                                <li>Gemini API rate limit exceeded</li>
                                <li>Network connectivity issues</li>
                                <li>API key configuration problem</li>
                            </ul>
                            <p className="help-text">Please wait a moment and try again. If the problem persists, contact support.</p>
                        </div>

                        <div className="actions">
                            {onAction && (
                                <button className="btn btn-primary" onClick={onAction}>
                                    Retry
                                </button>
                            )}
                            <button className="btn btn-secondary" onClick={onClose}>
                                Close
                            </button>
                        </div>
                    </div>
                );

            case 'network_error':
                return (
                    <div className="error-content">
                        <div className="error-icon">🌐</div>
                        <h2>{title}</h2>
                        <p className="error-message">{message}</p>

                        <div className="instructions">
                            <h3>Troubleshooting:</h3>
                            <ul>
                                <li>Check your internet connection</li>
                                <li>Verify Firebase emulator is running</li>
                                <li>Ensure backend services are accessible</li>
                            </ul>
                        </div>

                        <div className="actions">
                            {onAction && (
                                <button className="btn btn-primary" onClick={onAction}>
                                    Retry
                                </button>
                            )}
                            <button className="btn btn-secondary" onClick={onClose}>
                                Close
                            </button>
                        </div>
                    </div>
                );

            default:
                return (
                    <div className="error-content">
                        <div className="error-icon">⚠️</div>
                        <h2>{title}</h2>
                        <p className="error-message">{message}</p>

                        <div className="actions">
                            {onAction && (
                                <button className="btn btn-primary" onClick={onAction}>
                                    Retry
                                </button>
                            )}
                            <button className="btn btn-secondary" onClick={onClose}>
                                Close
                            </button>
                        </div>
                    </div>
                );
        }
    };

    return (
        <>
            <div className="audibit-error-overlay" onClick={onClose} />
            <div className="audibit-error-modal">
                {renderContent()}
            </div>

            <style>{`
        .audibit-error-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(4px);
          z-index: 2147483646;
          animation: fadeIn 0.2s ease-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .audibit-error-modal {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 90%;
          max-width: 500px;
          max-height: 80vh;
          background: #1a1b1e;
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          z-index: 2147483647;
          overflow: hidden;
          animation: slideIn 0.3s ease-out;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translate(-50%, -45%);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%);
          }
        }

        .error-content {
          padding: 32px;
          color: #ffffff;
          overflow-y: auto;
          max-height: 80vh;
        }

        .error-icon {
          font-size: 48px;
          text-align: center;
          margin-bottom: 16px;
        }

        h2 {
          font-size: 24px;
          font-weight: 700;
          margin: 0 0 16px 0;
          text-align: center;
          color: #e9ecef;
        }

        .error-message {
          font-size: 14px;
          line-height: 1.6;
          color: #adb5bd;
          text-align: center;
          margin: 0 0 24px 0;
        }

        .balance-info {
          background: #25262b;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 24px;
        }

        .balance-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
        }

        .balance-row:not(:last-child) {
          border-bottom: 1px solid #333;
        }

        .balance-row .label {
          font-size: 13px;
          color: #909296;
          font-weight: 500;
        }

        .balance-row .value {
          font-size: 14px;
          font-weight: 700;
          font-family: monospace;
        }

        .balance-row .value.required {
          color: #fa5252;
        }

        .balance-row .value.current {
          color: #ffd43b;
        }

        .instructions {
          background: #25262b;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 24px;
        }

        .instructions h3 {
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 12px 0;
          color: #4dabf7;
        }

        .instructions ol,
        .instructions ul {
          margin: 0;
          padding-left: 20px;
          color: #adb5bd;
        }

        .instructions li {
          font-size: 13px;
          line-height: 1.6;
          margin-bottom: 8px;
        }

        .instructions a {
          color: #4dabf7;
          text-decoration: none;
          font-weight: 600;
        }

        .instructions a:hover {
          text-decoration: underline;
        }

        .instructions strong {
          color: #e9ecef;
          font-weight: 600;
        }

        .wallet-address {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #2c2e33;
          padding: 8px 12px;
          border-radius: 6px;
          margin-top: 8px;
        }

        .wallet-address code {
          flex: 1;
          font-size: 11px;
          color: #82c91e;
          word-break: break-all;
          font-family: 'Courier New', monospace;
        }

        .copy-btn {
          background: #373a40;
          border: none;
          padding: 4px 8px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
          flex-shrink: 0;
        }

        .copy-btn:hover {
          background: #4dabf7;
          transform: scale(1.1);
        }

        .help-text {
          font-size: 12px;
          color: #909296;
          margin-top: 12px;
          font-style: italic;
        }

        .actions {
          display: flex;
          gap: 12px;
          justify-content: center;
        }

        .btn {
          padding: 12px 24px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          font-family: inherit;
        }

        .btn-primary {
          background: #228be6;
          color: white;
        }

        .btn-primary:hover {
          background: #1c7ed6;
          transform: translateY(-1px);
        }

        .btn-secondary {
          background: #373a40;
          color: #e9ecef;
        }

        .btn-secondary:hover {
          background: #495057;
        }

        /* Scrollbar styling */
        .error-content::-webkit-scrollbar {
          width: 8px;
        }

        .error-content::-webkit-scrollbar-track {
          background: #25262b;
        }

        .error-content::-webkit-scrollbar-thumb {
          background: #495057;
          border-radius: 4px;
        }

        .error-content::-webkit-scrollbar-thumb:hover {
          background: #5c5f66;
        }
      `}</style>
        </>
    );
};

export default ErrorModal;
