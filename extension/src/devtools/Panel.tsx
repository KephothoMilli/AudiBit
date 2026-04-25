import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AuditIssue, ExtensionMessage } from '../types';

interface AuditResult {
  auditId: string;
  issues: AuditIssue[];
  creditsUsed: number;
  timestamp: string;
}

const Panel: React.FC = () => {
  const [auditResults, setAuditResults] = useState<AuditResult | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<AuditIssue | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Listen for audit results from background script
    const messageListener = (message: ExtensionMessage) => {
      if (message.type === 'AUDIT_COMPLETE') {
        const transformedIssues: AuditIssue[] = message.results.issues.map((issue: any, index: number) => ({
          id: `issue-${index}`,
          type: issue.type || 'ux',
          severity: issue.severity,
          title: issue.title,
          description: issue.description,
          recommendation: issue.recommendation || 'No recommendation provided',
          selector: issue.element || issue.selector || 'N/A',
          fix: {
            type: 'code',
            recommendation: issue.recommendation || 'No recommendation provided',
            codeSnippet: issue.codeSnippet || generateCodeSnippet(issue),
          },
          cve: issue.cve,
        }));

        setAuditResults({
          auditId: Date.now().toString(),
          issues: transformedIssues,
          creditsUsed: 1,
          timestamp: new Date().toISOString(),
        });
        setLoading(false);
        if (transformedIssues.length > 0) {
          setSelectedIssue(transformedIssues[0]);
        }
      } else if (message.type === 'AUDIT_ERROR') {
        setLoading(false);
        console.error('Audit error:', message.error);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => chrome.runtime.onMessage.removeListener(messageListener);
  }, []);

  const generateCodeSnippet = (issue: any): string => {
    const element = issue.element || issue.selector || 'element';

    if (issue.type === 'accessibility') {
      if (issue.title.toLowerCase().includes('alt text')) {
        return `<img src="..." alt="Descriptive text here" />`;
      }
      if (issue.title.toLowerCase().includes('aria')) {
        return `<button aria-label="Descriptive label">\n  ${element}\n</button>`;
      }
      if (issue.title.toLowerCase().includes('label')) {
        return `<label for="input-id">Label text</label>\n<input id="input-id" type="text" />`;
      }
    }

    if (issue.type === 'responsive') {
      return `/* Use relative units instead of fixed pixels */\n.${element} {\n  width: 100%;\n  max-width: 600px;\n  font-size: 1rem;\n}`;
    }

    return `<!-- Fix for: ${issue.title} -->\n<!-- ${issue.recommendation} -->`;
  };

  const triggerAudit = () => {
    setLoading(true);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_DOM' }, (response) => {
          if (response?.dom) {
            chrome.runtime.sendMessage({
              type: 'TRIGGER_AUDIT',
              auditType: 'uiux',
              url: tabs[0].url || '',
              dom: response.dom,
            });
          }
        });
      }
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const highlightElement = (selector: string) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'HIGHLIGHT_ELEMENT',
          selector,
        });
      }
    });
  };

  const filteredIssues = auditResults?.issues.filter((issue) => {
    const typeMatch = filterType === 'all' || issue.type === filterType;
    const severityMatch = filterSeverity === 'all' || issue.severity === filterSeverity;
    return typeMatch && severityMatch;
  }) || [];

  const severityCounts = auditResults?.issues.reduce((acc, issue) => {
    acc[issue.severity] = (acc[issue.severity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  return (
    <div className="devtools-panel">
      <header className="panel-header">
        <div className="brand">
          <span className="logo">A</span>
          <h1>Audibit DevTools</h1>
        </div>
        <button onClick={triggerAudit} disabled={loading} className="audit-btn">
          {loading ? 'Analyzing...' : 'Run Audit'}
        </button>
      </header>

      {!auditResults && !loading && (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <h2>No Audit Results Yet</h2>
          <p>Click "Run Audit" to analyze the current page for UI/UX and accessibility issues.</p>
        </div>
      )}

      {loading && (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Analyzing page with AI...</p>
        </div>
      )}

      {auditResults && !loading && (
        <div className="panel-content">
          <aside className="sidebar">
            <div className="summary-cards">
              <div className="summary-card critical">
                <span className="count">{severityCounts.critical || 0}</span>
                <span className="label">Critical</span>
              </div>
              <div className="summary-card high">
                <span className="count">{severityCounts.high || 0}</span>
                <span className="label">High</span>
              </div>
              <div className="summary-card medium">
                <span className="count">{severityCounts.medium || 0}</span>
                <span className="label">Medium</span>
              </div>
              <div className="summary-card low">
                <span className="count">{severityCounts.low || 0}</span>
                <span className="label">Low</span>
              </div>
            </div>

            <div className="filters">
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)} title="Filter by Type">
                <option value="all">All Types</option>
                <option value="accessibility">Accessibility</option>
                <option value="ux">UX</option>
                <option value="responsive">Responsive</option>
                <option value="security">Security</option>
              </select>
              <select value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)} title="Filter by Severity">
                <option value="all">All Severities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div className="issues-list">
              {filteredIssues.map((issue) => (
                <div
                  key={issue.id}
                  className={`issue-item ${selectedIssue?.id === issue.id ? 'active' : ''}`}
                  onClick={() => setSelectedIssue(issue)}
                >
                  <div className={`severity-dot ${issue.severity}`}></div>
                  <div className="issue-info">
                    <div className="issue-title">{issue.title}</div>
                    <div className="issue-type">{issue.type}</div>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <main className="detail-panel">
            {selectedIssue ? (
              <>
                <div className="detail-header">
                  <div className={`severity-badge ${selectedIssue.severity}`}>
                    {selectedIssue.severity.toUpperCase()}
                  </div>
                  <span className="type-badge">{selectedIssue.type}</span>
                </div>

                <h2>{selectedIssue.title}</h2>
                <p className="description">{selectedIssue.description}</p>

                <div className="section">
                  <h3>Affected Element</h3>
                  <div className="code-block">
                    <code>{selectedIssue.selector}</code>
                    <button
                      onClick={() => highlightElement(selectedIssue.selector)}
                      className="action-btn"
                    >
                      Highlight
                    </button>
                  </div>
                </div>

                <div className="section">
                  <h3>Recommended Fix</h3>
                  <p className="recommendation">{selectedIssue.fix.recommendation}</p>
                  <div className="code-block">
                    <pre><code>{selectedIssue.fix.codeSnippet}</code></pre>
                    <button
                      onClick={() => copyToClipboard(selectedIssue.fix.codeSnippet)}
                      className="action-btn"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                {selectedIssue.cve && (
                  <div className="section cve-section">
                    <h3>Security Reference</h3>
                    <a
                      href={`https://cve.mitre.org/cgi-bin/cvename.cgi?name=${selectedIssue.cve}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {selectedIssue.cve}
                    </a>
                  </div>
                )}
              </>
            ) : (
              <div className="no-selection">
                <p>Select an issue from the list to view details</p>
              </div>
            )}
          </main>
        </div>
      )}

      <style>{`
        .devtools-panel {
          background: #1a1b1e;
          color: #e9ecef;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          height: 100vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .panel-header {
          padding: 12px 16px;
          background: #25262b;
          border-bottom: 1px solid #373a40;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .logo {
          background: #228be6;
          color: white;
          width: 24px;
          height: 24px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
        }

        h1 {
          font-size: 16px;
          margin: 0;
          color: #e9ecef;
        }

        .audit-btn {
          padding: 8px 16px;
          background: #228be6;
          color: white;
          border: none;
          border-radius: 6px;
          font-weight: bold;
          cursor: pointer;
          transition: background 0.2s;
        }

        .audit-btn:hover:not(:disabled) {
          background: #1c7ed6;
        }

        .audit-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .empty-state, .loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: calc(100vh - 60px);
          text-align: center;
          padding: 40px;
        }

        .empty-icon {
          font-size: 64px;
          margin-bottom: 16px;
        }

        .empty-state h2 {
          margin: 0 0 8px 0;
          color: #e9ecef;
        }

        .empty-state p {
          color: #909296;
          max-width: 400px;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 4px solid #373a40;
          border-top-color: #228be6;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 16px;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .loading-state p {
          color: #909296;
        }

        .panel-content {
          display: flex;
          flex: 1;
          overflow: hidden;
        }

        .sidebar {
          width: 320px;
          background: #25262b;
          border-right: 1px solid #373a40;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .summary-cards {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
          padding: 12px;
          border-bottom: 1px solid #373a40;
        }

        .summary-card {
          padding: 12px;
          border-radius: 6px;
          text-align: center;
        }

        .summary-card.critical { background: rgba(201, 42, 42, 0.2); border: 1px solid #c92a2a; }
        .summary-card.high { background: rgba(230, 119, 0, 0.2); border: 1px solid #e67700; }
        .summary-card.medium { background: rgba(250, 176, 5, 0.2); border: 1px solid #fab005; }
        .summary-card.low { background: rgba(92, 148, 13, 0.2); border: 1px solid #5c940d; }

        .summary-card .count {
          display: block;
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 4px;
        }

        .summary-card .label {
          display: block;
          font-size: 11px;
          text-transform: uppercase;
          opacity: 0.8;
        }

        .filters {
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          border-bottom: 1px solid #373a40;
        }

        .filters select {
          padding: 8px;
          background: #1a1b1e;
          color: #e9ecef;
          border: 1px solid #373a40;
          border-radius: 4px;
          font-size: 13px;
        }

        .issues-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }

        .issue-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.2s;
          margin-bottom: 4px;
        }

        .issue-item:hover {
          background: #2c2e33;
        }

        .issue-item.active {
          background: #373a40;
        }

        .severity-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .severity-dot.critical { background: #c92a2a; }
        .severity-dot.high { background: #e67700; }
        .severity-dot.medium { background: #fab005; }
        .severity-dot.low { background: #5c940d; }

        .issue-info {
          flex: 1;
          min-width: 0;
        }

        .issue-title {
          font-size: 13px;
          font-weight: 500;
          margin-bottom: 4px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .issue-type {
          font-size: 11px;
          color: #909296;
          text-transform: capitalize;
        }

        .detail-panel {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
        }

        .detail-header {
          display: flex;
          gap: 8px;
          margin-bottom: 16px;
        }

        .severity-badge {
          padding: 4px 12px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: bold;
        }

        .severity-badge.critical { background: #c92a2a; }
        .severity-badge.high { background: #e67700; }
        .severity-badge.medium { background: #fab005; color: #000; }
        .severity-badge.low { background: #5c940d; }

        .type-badge {
          padding: 4px 12px;
          border-radius: 4px;
          font-size: 11px;
          background: #373a40;
          text-transform: capitalize;
        }

        .detail-panel h2 {
          font-size: 24px;
          margin: 0 0 12px 0;
          color: #e9ecef;
        }

        .description {
          color: #adb5bd;
          line-height: 1.6;
          margin-bottom: 24px;
        }

        .section {
          margin-bottom: 24px;
        }

        .section h3 {
          font-size: 14px;
          text-transform: uppercase;
          color: #909296;
          margin: 0 0 12px 0;
          letter-spacing: 0.5px;
        }

        .recommendation {
          color: #adb5bd;
          line-height: 1.6;
          margin-bottom: 12px;
        }

        .code-block {
          background: #25262b;
          border: 1px solid #373a40;
          border-radius: 6px;
          padding: 12px;
          position: relative;
        }

        .code-block code {
          color: #82c91e;
          font-family: 'Courier New', monospace;
          font-size: 13px;
        }

        .code-block pre {
          margin: 0;
          overflow-x: auto;
        }

        .code-block .action-btn {
          position: absolute;
          top: 8px;
          right: 8px;
          padding: 4px 12px;
          background: #373a40;
          color: #e9ecef;
          border: none;
          border-radius: 4px;
          font-size: 11px;
          cursor: pointer;
          transition: background 0.2s;
        }

        .code-block .action-btn:hover {
          background: #495057;
        }

        .cve-section a {
          color: #4dabf7;
          text-decoration: none;
          font-family: monospace;
        }

        .cve-section a:hover {
          text-decoration: underline;
        }

        .no-selection {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: #909296;
        }
      `}</style>
    </div>
  );
};

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<Panel />);
}
