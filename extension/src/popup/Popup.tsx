import React, { useEffect, useState, useCallback } from 'react';
import SplashScreen from './SplashScreen';
import {
  getOrCreateWallet, getConnectedWallet, disconnectWallet,
  getPaymentLogs, getWalletBalance, verifyWalletAddress,
  importWallet, listAvailableWallets
} from '../lib/circle-wallet';
import PaymentLog, { type PaymentLogItem } from '../components/PaymentLog';
import AgentStatusPanel, { type AgentStatus } from '../components/AgentStatusPanel';

const FUNCTIONS_BASE = import.meta.env.VITE_FUNCTIONS_BASE_URL || 'http://127.0.0.1:5001/w3bn3xt/us-central1';

interface AuditIssue {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  recommendation: string;
}

interface AgentResult {
  agentType: string;
  issues: AuditIssue[];
  cost: string;
  executionTime?: number;
  transactionId?: string;
}

interface AuditHistoryItem {
  id: string;
  url: string;
  type: string;
  issuesCount: number;
  cost: string;
  transactionId?: string;
  timestamp: number;
  issues?: AuditIssue[];
  agentResults?: AgentResult[];
}
type View = 'dashboard' | 'history' | 'payments';

interface AgentQuote {
  agentType: string;
  priceUsdc: number;
  gasBuffer: number;
  totalRequired: number;
  userBalance: number;
  canProceed: boolean;
  needsBridge: boolean;
  sourceChain?: string;
}

const AGENT_META: Record<string, { title: string; icon: string; desc: string; price: string }> = {
  ui: { title: 'UI Agent', icon: '🎨', desc: 'Visuals & Branding', price: '0.005' },
  ux: { title: 'UX Agent', icon: '🧠', desc: 'Flow & Accessibility', price: '0.008' },
  dom: { title: 'DOM Agent', icon: '🏗️', desc: 'Structure & Perf', price: '0.003' },
  security: { title: 'Security Agent', icon: '🛡️', desc: 'Vulnerabilities', price: '0.012' },
};

const IssueCard: React.FC<{ issue: AuditIssue }> = ({ issue }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <div className={`issue-card sev-${issue.severity}`} onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer' }}>
      <div className="issue-card-header">
        <span className={`sev-badge sev-${issue.severity}`}>{issue.severity?.toUpperCase()}</span>
        <span className="issue-title">{issue.title}</span>
        <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <>
          <p className="issue-desc">{issue.description}</p>
          {issue.recommendation && (
            <div className="issue-rec">💡 {issue.recommendation}</div>
          )}
        </>
      )}
    </div>
  );
};

const Popup: React.FC = () => {
  const [splash, setSplash] = useState(true);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string>('0.000000');
  const [computeCredits, setComputeCredits] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [view, setView] = useState<View>('dashboard');
  const [audits, setAudits] = useState<AuditHistoryItem[]>([]);
  const [selectedAudit, setSelectedAudit] = useState<AuditHistoryItem | null>(null);
  const [paymentLogs, setPaymentLogs] = useState<PaymentLogItem[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [creatingNewWallet, setCreatingNewWallet] = useState(false);
  const [importAddress, setImportAddress] = useState('');
  const [importStatus, setImportStatus] = useState<'idle' | 'verifying' | 'importing' | 'success' | 'error'>('idle');
  const [importMessage, setImportMessage] = useState('');
  const [availableWallets, setAvailableWallets] = useState<Array<any>>([]);
  const [loadingWallets, setLoadingWallets] = useState(false);
  // Legacy modal/bridge state (kept for wallet details modal compatibility)
  const [activeModal, setActiveModal] = useState<'none' | 'import' | 'details' | 'confirm_new_wallet' | 'bridge'>('none');
  const [crossChainBalances, setCrossChainBalances] = useState<any>(null);
  const [bridgingStatus, setBridgingStatus] = useState<'idle' | 'checking' | 'bridging' | 'success' | 'error'>('idle');

  // ── Payment confirmation modal ──────────────────────────────────────────────
  const [pendingAgent, setPendingAgent] = useState<string | null>(null);
  const [agentQuote, setAgentQuote] = useState<AgentQuote | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  // ── Expandable rows ─────────────────────────────────────────────────────────
  const [expandedSettlement, setExpandedSettlement] = useState<string | null>(null);

  const showNotification = useCallback((message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 6000);
  }, []);

  // Fetch wallet balance from backend
  const fetchWalletBalance = useCallback(async (addr: string) => {
    setLoadingBalance(true);
    try {
      const balances = await getWalletBalance(addr);
      const usdcToken = balances.find(
        (b) => b.token.symbol === 'USDC' || b.token.symbol.toLowerCase().includes('usdc')
      );
      if (usdcToken) {
        setUsdcBalance(parseFloat(usdcToken.amount).toFixed(6));
      } else {
        setUsdcBalance('0.000000');
      }
    } catch (error) {
      console.error('Failed to fetch wallet balance:', error);
      setUsdcBalance('0.000000');
    } finally {
      setLoadingBalance(false);
    }
  }, []);

  const loadData = useCallback(async (addr: string) => {
    const r = await chrome.storage.local.get([
      `credits_${addr}`,
      `audits_${addr}`,
      `settlements_${addr}`,
    ]);
    setComputeCredits((r[`credits_${addr}`] as number) || 0);
    setAudits((r[`audits_${addr}`] as AuditHistoryItem[]) || []);

    // Load cached settlements immediately (no network needed)
    const cached = (r[`settlements_${addr}`] as any[]) || [];
    if (cached.length > 0) setPaymentLogs(cached);

    // Fetch real USDC balance
    await fetchWalletBalance(addr);

    // Fetch fresh settlements from Firestore and update cache
    try {
      const logs = await getPaymentLogs(addr);
      setPaymentLogs(logs);
      await chrome.storage.local.set({ [`settlements_${addr}`]: logs });
    } catch {
      // Already showing cached data — silent fail is fine
    }
  }, [fetchWalletBalance]);

  useEffect(() => {
    (async () => {
      const addr = await getConnectedWallet();
      setWalletAddress(addr);
      if (addr) await loadData(addr);
      setLoading(false);
    })();

    const interval = setInterval(async () => {
      const addr = await getConnectedWallet();
      if (addr && view === 'dashboard') {
        await fetchWalletBalance(addr);
        try {
          const logs = await getPaymentLogs(addr);
          setPaymentLogs(logs);
          await chrome.storage.local.set({ [`settlements_${addr}`]: logs });
        } catch { /* silent */ }
      }
    }, 10000);

    const storageListener = (c: any) => {
      if (c.circleWalletAddress) {
        const a = c.circleWalletAddress.newValue || null;
        setWalletAddress(a);
        if (a) loadData(a);
      }
      if (walletAddress && (c[`audits_${walletAddress}`] || c[`credits_${walletAddress}`])) {
        loadData(walletAddress);
      }
    };

    const messageListener = (msg: any) => {
      if (msg.type === 'AUDIT_COMPLETE') {
        if (walletAddress) loadData(walletAddress);
        setAgentStatus(null); // Clear status on complete
      }
      if (msg.type === 'AUDIT_ERROR') {
        showNotification(msg.error, 'error');
        setAgentStatus(null); // Clear status on error
      }
      if (msg.type === 'AGENT_STATUS') {
        // Update agent status from background script
        setAgentStatus(msg.status);
      }
    };

    chrome.storage.onChanged.addListener(storageListener);
    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.storage.onChanged.removeListener(storageListener);
      chrome.runtime.onMessage.removeListener(messageListener);
      clearInterval(interval);
    };
  }, [loadData, view, walletAddress]);

  const connect = async () => {
    setConnecting(true);
    try {
      const a = await getOrCreateWallet();
      setWalletAddress(a);
      await loadData(a);
    } catch (error) {
      console.error('Wallet creation error:', error);
      showNotification('Failed to initialize Arc Wallet. Check your connection.', 'error');
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    await disconnectWallet();
    setWalletAddress(null);
    setUsdcBalance('0.000000');
    setComputeCredits(0);
    setAudits([]);
  };

  const createNewWallet = async () => {
    setCreatingNewWallet(true);
    try {
      await disconnectWallet();
      const newAddr = await getOrCreateWallet();
      setWalletAddress(newAddr);
      await loadData(newAddr);
      showNotification(`New wallet created: ${newAddr}`, 'success');
    } catch (error) {
      console.error('New wallet creation error:', error);
      showNotification('Failed to create new wallet. Check your connection.', 'error');
    } finally {
      setCreatingNewWallet(false);
    }
  };

  const handleBridge = async (fromChain: 'Ethereum_Sepolia' | 'Solana_Devnet') => {
    try {
      setBridgingStatus('bridging');
      const address = await getConnectedWallet();
      if (!address) return;

      const resp = await fetch(
        `${FUNCTIONS_BASE}/${fromChain === 'Ethereum_Sepolia' ? 'bridgeFromEthereum' : 'bridgeFromSolana'}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Wallet-Address': address },
          body: JSON.stringify({ amount: '1.0' }),
        }
      );
      const result = await resp.json();

      if (result.success) {
        setBridgingStatus('success');
        showNotification('Bridge transaction submitted!', 'success');
        if (walletAddress) await fetchWalletBalance(walletAddress);
      } else {
        setBridgingStatus('error');
        showNotification(result.message || 'Bridge failed', 'error');
      }
    } catch (err: any) {
      setBridgingStatus('error');
      showNotification(err.message || 'Bridge failed', 'error');
    }
  };

  const fetchCrossChainBalances = async () => {
    try {
      const address = await getConnectedWallet();
      if (!address) return;

      const resp = await fetch(`${FUNCTIONS_BASE}/getWalletBalance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Wallet-Address': address },
      });
      const data = await resp.json();
      setCrossChainBalances(data);
    } catch (err) {
      console.error('Failed to fetch cross-chain balances:', err);
    }
  };

  useEffect(() => {
    if (activeModal === 'details') {
      fetchCrossChainBalances();
    }
  }, [activeModal]);

  const openImportModal = async () => {
    setActiveModal('import');
    setImportStatus('idle');
    setImportMessage('');
    setImportAddress('');

    // Load available wallets
    setLoadingWallets(true);
    try {
      const result = await listAvailableWallets();
      setAvailableWallets(result.wallets);
    } catch (error) {
      console.error('Failed to load available wallets:', error);
    } finally {
      setLoadingWallets(false);
    }
  };

  const handleVerifyWallet = async () => {
    if (!importAddress || !/^0x[a-fA-F0-9]{40}$/.test(importAddress)) {
      setImportStatus('error');
      setImportMessage('Invalid wallet address format. Must be 0x followed by 40 hex characters.');
      return;
    }

    setImportStatus('verifying');
    setImportMessage('Verifying wallet address...');

    try {
      const result = await verifyWalletAddress(importAddress);

      if (!result.valid || !result.exists) {
        setImportStatus('error');
        setImportMessage(result.message || 'Wallet not found in your Circle account.');
        return;
      }

      if (result.alreadyImported) {
        setImportStatus('error');
        setImportMessage('This wallet is already imported.');
        return;
      }

      setImportStatus('success');
      setImportMessage(`✅ Wallet verified! Blockchain: ${result.wallet?.blockchain}`);
    } catch (error: any) {
      setImportStatus('error');
      setImportMessage(error.message || 'Failed to verify wallet.');
    }
  };

  const handleImportWallet = async (address?: string) => {
    const addrToImport = address || importAddress;

    if (!addrToImport || !/^0x[a-fA-F0-9]{40}$/.test(addrToImport)) {
      setImportStatus('error');
      setImportMessage('Invalid wallet address format.');
      return;
    }

    setImportStatus('importing');
    setImportMessage('Importing wallet...');

    try {
      const result = await importWallet(addrToImport);

      setImportStatus('success');
      setImportMessage(`✅ ${result.message}`);

      // Update UI with imported wallet
      setWalletAddress(result.wallet.address);
      await loadData(result.wallet.address);

      // Close modal after 2 seconds
      setTimeout(() => {
        setActiveModal('none');
      }, 2000);
    } catch (error: any) {
      setImportStatus('error');
      setImportMessage(error.message || 'Failed to import wallet.');
    }
  };

  const copyWalletAddress = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      showNotification('Wallet address copied to clipboard!', 'success');
    }
  };

  // ── Step 1: fetch quote, open confirmation modal ───────────────────────────
  const triggerAudit = useCallback(async (type: 'ui' | 'ux' | 'dom' | 'security') => {
    if (!walletAddress) return;
    setPendingAgent(type);
    setAgentQuote(null);
    setLoadingQuote(true);

    try {
      const resp = await fetch(`${FUNCTIONS_BASE}/getAgentQuote?agent=${type}`, {
        headers: { 'X-Wallet-Address': walletAddress },
      });
      const quote: AgentQuote = await resp.json();
      setAgentQuote(quote);
    } catch {
      // Fallback: build quote from local data if backend unreachable
      const price = parseFloat(AGENT_META[type].price);
      const bal = parseFloat(usdcBalance);
      setAgentQuote({
        agentType: type, priceUsdc: price, gasBuffer: 0.001,
        totalRequired: price + 0.001, userBalance: bal,
        canProceed: bal >= price + 0.001, needsBridge: false,
      });
    } finally {
      setLoadingQuote(false);
    }
  }, [walletAddress, usdcBalance]);

  // ── Step 2: user confirms → dispatch to service worker ────────────────────
  const confirmAndRunAudit = useCallback(() => {
    if (!pendingAgent || !walletAddress) return;
    const type = pendingAgent as 'ui' | 'ux' | 'dom' | 'security';
    setPendingAgent(null);
    setAgentQuote(null);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        setAgentStatus({
          agentType: type, status: 'analyzing',
          message: `Charging ${AGENT_META[type].price} USDC → ${type.toUpperCase()} Agent…`,
          progress: 5, timestamp: Date.now(),
        });
        chrome.runtime.sendMessage({
          type: 'TRIGGER_AUDIT', auditType: type,
          url: tabs[0].url || '', walletAddress,
        });
      }
    });
  }, [pendingAgent, walletAddress]);

  // ── Wand activation ────────────────────────────────────────────────────────
  const [wandActive, setWandActive] = useState(false);

  const toggleWand = useCallback(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]?.id) return;
      try {
        const response = await chrome.tabs.sendMessage(tabs[0].id, {
          type: 'WAND_TOGGLE',
        });
        setWandActive(response?.active ?? !wandActive);
      } catch {
        // Content script may not be loaded on restricted pages
        showNotification('Wand is not available on this page. Navigate to a regular website first.', 'warning');
      }
    });
  }, [wandActive, showNotification]);

  if (splash) return <SplashScreen onComplete={() => setSplash(false)} />;
  if (loading) return (
    <div className="p-loading">
      <div className="loading-inner">
        <svg className="gear-spin" viewBox="0 0 64 64" width="52" height="52" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M32 20a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm0 20a8 8 0 1 1 0-16 8 8 0 0 1 0 16z"
            fill="url(#gearGrad)"
          />
          <path
            d="M54.6 27.2l-3.4-.6a20.2 20.2 0 0 0-1.6-3.8l2-2.8a2 2 0 0 0-.2-2.6l-4.8-4.8a2 2 0 0 0-2.6-.2l-2.8 2a20.2 20.2 0 0 0-3.8-1.6l-.6-3.4A2 2 0 0 0 35 8h-6a2 2 0 0 0-2 1.6l-.6 3.4a20.2 20.2 0 0 0-3.8 1.6l-2.8-2a2 2 0 0 0-2.6.2l-4.8 4.8a2 2 0 0 0-.2 2.6l2 2.8a20.2 20.2 0 0 0-1.6 3.8l-3.4.6A2 2 0 0 0 8 29v6a2 2 0 0 0 1.6 2l3.4.6a20.2 20.2 0 0 0 1.6 3.8l-2 2.8a2 2 0 0 0 .2 2.6l4.8 4.8a2 2 0 0 0 2.6.2l2.8-2a20.2 20.2 0 0 0 3.8 1.6l.6 3.4A2 2 0 0 0 29 56h6a2 2 0 0 0 2-1.6l.6-3.4a20.2 20.2 0 0 0 3.8-1.6l2.8 2a2 2 0 0 0 2.6-.2l4.8-4.8a2 2 0 0 0 .2-2.6l-2-2.8a20.2 20.2 0 0 0 1.6-3.8l3.4-.6A2 2 0 0 0 56 35v-6a2 2 0 0 0-1.4-1.8z"
            fill="url(#gearGrad)"
            opacity="0.85"
          />
          <defs>
            <linearGradient id="gearGrad" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
              <stop stopColor="#3b82f6" />
              <stop offset="1" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>
        </svg>
        <span className="loading-text">Starting AudiBit...</span>
        <span className="loading-sub">Connecting to Arc Testnet</span>
      </div>
    </div>
  );

  return (
    <div className="app">
      {/* ── Professional Header ── */}
      <header className="header">
        <div className="brand">
          <div className="logo-icon">
            <svg width="24" height="24" viewBox="0 0 48 48" fill="none">
              <rect width="48" height="48" rx="10" fill="url(#AzureGrad)" />
              <path d="M24 12L36 34H12L24 12Z" fill="white" />
              <defs><linearGradient id="AzureGrad" x1="0" y1="0" x2="48" y2="48"><stop stopColor="#3b82f6" /><stop offset="1" stopColor="#4338ca" /></linearGradient></defs>
            </svg>
          </div>
          <span className="brand-name">Audi<span className="text-azure">Bit</span></span>
        </div>
        <div className="header-actions">
          {walletAddress && <div className="arc-status"><span>Arc Testnet</span><div className="status-dot pulse" /></div>}
        </div>
      </header>

      {!walletAddress ? (
        /* ── Modern Connect Screen ── */
        <div className="connect-screen">
          <div className="hero-asset">
            <div className="floating-card">
              <div className="card-logo">Arc</div>
              <div className="card-number">•••• •••• •••• {Math.floor(Math.random() * 9000) + 1000}</div>
            </div>
          </div>
          <h2 className="title">Professional Web Audits</h2>
          <p className="subtitle">Instant AI analysis with real-time USDC settlement on the Arc L1 blockchain.</p>
          <button className="btn btn-primary btn-lg" onClick={connect} disabled={connecting}>
            {connecting ? 'Creating Wallet...' : 'Connect Arc Wallet'}
          </button>
          <button className="btn btn-secondary btn-lg" onClick={openImportModal} style={{ marginTop: '12px' }}>
            Import Existing Wallet
          </button>
          <div className="trust-badges">
            <span>Powered by Circle Nanopayments</span>
          </div>
        </div>
      ) : (
        <>
          {/* ── Tabs ── */}
          <nav className="tabs">
            {(['dashboard', 'history', 'payments'] as View[]).map(v => (
              <button key={v} className={`tab-btn ${view === v ? 'tab-btn-active' : ''}`} onClick={() => setView(v)}>
                <span className="tab-icon">{v === 'dashboard' ? '📊' : v === 'history' ? '📜' : '💸'}</span>
                {v === 'dashboard' ? 'Overview' : v === 'history' ? 'Logs' : 'Settlements'}
              </button>
            ))}
          </nav>

          {/* ── Main View ── */}
          <main className={`main ${agentStatus ? 'main-with-status' : ''}`}>
            {view === 'dashboard' && (
              <div className="dashboard">
                {/* Card Grid */}
                <div className="card-grid">
                  <div className="card card-hero">
                    <div className="card-label">Economic Activity</div>
                    <div className="card-value">{paymentLogs.reduce((s, l) => s + l.computeUnits, 0)} <span className="unit">CU</span></div>
                    <div className="card-sub">Compute Units consumed on Arc</div>
                  </div>

                  <div className="card">
                    <div className="card-label">
                      USDC Balance
                      {walletAddress && (
                        <button
                          onClick={() => fetchWalletBalance(walletAddress)}
                          disabled={loadingBalance}
                          style={{
                            marginLeft: '8px',
                            background: 'none',
                            border: 'none',
                            cursor: loadingBalance ? 'not-allowed' : 'pointer',
                            fontSize: '12px',
                            opacity: loadingBalance ? 0.5 : 1
                          }}
                          title="Refresh balance"
                        >
                          🔄
                        </button>
                      )}
                    </div>
                    <div className="card-value">
                      {loadingBalance ? (
                        <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Loading...</span>
                      ) : (
                        <>
                          {parseFloat(usdcBalance).toFixed(4)} <span className="unit">USDC</span>
                        </>
                      )}
                    </div>
                    <div className="card-sub">
                      Available for audits
                      {walletAddress && parseFloat(usdcBalance) === 0 && (
                        <button
                          onClick={() => window.open(`https://faucet.circle.com?address=${walletAddress}`, '_blank')}
                          style={{
                            marginTop: '6px',
                            padding: '4px 8px',
                            background: 'var(--azure)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '10px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            display: 'block',
                            width: '100%'
                          }}
                          title="Get free USDC from Circle faucet"
                        >
                          💰 Get USDC (Arc Testnet)
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="card">
                    <div className="card-label">Compute Credits</div>
                    <div className="card-value">{computeCredits} <span className="unit">CU</span></div>
                    <div className="card-sub">Usage tracking credits</div>
                  </div>
                </div>

                {/* Audit Grid */}
                <div className="section-header">AudiBit Agents</div>
                <div className="audit-grid">
                  {(Object.entries(AGENT_META) as [string, typeof AGENT_META[string]][]).map(([id, agent]) => (
                    <div key={id} className="audit-card" onClick={() => triggerAudit(id as any)}>
                      <div className={`audit-icon icon-${id}`}>{agent.icon}</div>
                      <div className="audit-info">
                        <div className="audit-title">{agent.title}</div>
                        <div className="audit-price">{agent.price} USDC / scan</div>
                      </div>
                      <div className="agent-desc">{agent.desc}</div>
                    </div>
                  ))}
                </div>

                {/* Wand — voice-first assistant */}
                <div
                  className={`wand-card ${wandActive ? 'wand-active' : ''}`}
                  onClick={toggleWand}
                >
                  <div className="wand-left">
                    <div className="wand-icon-wrap">
                      <span className="wand-icon">🪄</span>
                      {wandActive && <span className="wand-listening-ring" />}
                    </div>
                    <div className="wand-info">
                      <div className="wand-title">
                        Wand
                        {wandActive && <span className="wand-live-badge">LIVE</span>}
                      </div>
                      <div className="wand-desc">
                        {wandActive
                          ? 'Listening — point at anything and speak'
                          : 'Voice-first browser assistant · 0.002 USDC / query'}
                      </div>
                    </div>
                  </div>
                  <div className="wand-shortcut">
                    <kbd>Ctrl</kbd><span>+</span><kbd>Space</kbd>
                  </div>
                </div>

                {/* Settlement Activity */}
                <div className="section-header">Live Settlement Log</div>
                <PaymentLog logs={paymentLogs.slice(0, 5)} />
              </div>
            )}

            {view === 'history' && (
              <div className="history-view">
                {selectedAudit ? (
                  /* ── Issue Detail Panel ── */
                  <div className="issue-detail">
                    <button
                      className="back-btn"
                      onClick={() => setSelectedAudit(null)}
                    >
                      ← Back to Logs
                    </button>

                    <div className="detail-header">
                      <span className={`badge badge-${selectedAudit.type}`}>
                        {AGENT_META[selectedAudit.type]?.icon} {selectedAudit.type.toUpperCase()}
                      </span>
                      <span className="record-date">
                        {new Date(selectedAudit.timestamp).toLocaleDateString('en-GB')}
                      </span>
                    </div>

                    <div className="detail-url" title={selectedAudit.url}>
                      {selectedAudit.url}
                    </div>

                    <div className="detail-meta">
                      <span className={selectedAudit.issuesCount > 0 ? 'text-danger' : 'text-success'}>
                        {selectedAudit.issuesCount} Issue{selectedAudit.issuesCount !== 1 ? 's' : ''} Found
                      </span>
                      {selectedAudit.cost && (
                        <span className="text-azure">{selectedAudit.cost} USDC</span>
                      )}
                    </div>

                    {(!selectedAudit.issues || selectedAudit.issues.length === 0) ? (
                      <div className="empty-state" style={{ marginTop: '20px' }}>
                        ✅ No issues found on this page.
                      </div>
                    ) : (
                      <div className="issue-list">
                        {/* Per-agent breakdown if available */}
                        {selectedAudit.agentResults && selectedAudit.agentResults.length > 0 ? (
                          selectedAudit.agentResults.map((ar, ai) => (
                            <div key={ai} className="agent-section">
                              <div className="agent-section-header">
                                <span className={`badge badge-${ar.agentType}`}>
                                  {AGENT_META[ar.agentType]?.icon} {ar.agentType.toUpperCase()}
                                </span>
                                <span className="agent-section-meta">
                                  {ar.issues.length} issue{ar.issues.length !== 1 ? 's' : ''}
                                  {ar.cost ? ` · ${ar.cost} USDC` : ''}
                                </span>
                              </div>
                              {ar.issues.length === 0 ? (
                                <div className="agent-no-issues">✅ No issues</div>
                              ) : (
                                ar.issues.map((issue, i) => (
                                  <IssueCard key={i} issue={issue} />
                                ))
                              )}
                            </div>
                          ))
                        ) : (
                          selectedAudit.issues.map((issue, i) => (
                            <IssueCard key={i} issue={issue} />
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  /* ── Audit Record List ── */
                  <>
                    <div className="section-header">Audit Records</div>
                    {audits.length === 0 ? (
                      <div className="empty-state">No audits recorded yet.</div>
                    ) : (
                      <div className="record-list">
                        {audits.map(a => (
                          <div
                            key={a.id}
                            className="record-card"
                            onClick={() => setSelectedAudit(a)}
                            style={{ cursor: 'pointer' }}
                          >
                            <div className="record-header">
                              <span className={`badge badge-${a.type}`}>
                                {AGENT_META[a.type]?.icon} {a.type.toUpperCase()}
                              </span>
                              <span className="record-date">
                                {new Date(a.timestamp).toLocaleDateString('en-GB')}
                              </span>
                            </div>
                            <div className="record-url">{a.url}</div>
                            <div className="record-footer">
                              <span className={a.issuesCount > 0 ? 'text-danger' : 'text-success'}>
                                {a.issuesCount} Issues Found
                              </span>
                              <span className="record-chevron">
                                {a.cost ? `${a.cost} USDC` : ''} ›
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {view === 'payments' && (
              <div className="payments-view">
                <div className="section-header">Arc L1 Settlement History</div>
                {paymentLogs.length === 0 ? (
                  <div className="empty-state">No settlements on Arc yet.</div>
                ) : (
                  <div className="settlement-list">
                    {paymentLogs.map((log) => {
                      const isOpen = expandedSettlement === log.id;
                      return (
                        <div key={log.id} className="settlement-card">
                          <div
                            className="settlement-row"
                            onClick={() => setExpandedSettlement(isOpen ? null : log.id)}
                          >
                            <div className="settlement-left">
                              <div className="settlement-desc">{log.description}</div>
                              <div className="settlement-tx">
                                TX: {log.transactionId?.slice(0, 14)}…
                              </div>
                            </div>
                            <div className="settlement-right">
                              <div className="settlement-amount">
                                {(parseFloat(log.amount) || 0).toFixed(4)} USDC
                              </div>
                              <div className="settlement-cu">{log.computeUnits} CU</div>
                            </div>
                            <span className="expand-chevron">{isOpen ? '▲' : '▼'}</span>
                          </div>

                          {isOpen && (
                            <div className="settlement-detail">
                              <div className="sdet-row">
                                <span className="sdet-label">Circle TX ID</span>
                                <span className="sdet-val mono">{log.transactionId}</span>
                              </div>
                              {log.txHash && (
                                <div className="sdet-row">
                                  <span className="sdet-label">On-chain Hash</span>
                                  <span className="sdet-val mono">{log.txHash}</span>
                                </div>
                              )}
                              <div className="sdet-row">
                                <span className="sdet-label">Amount</span>
                                <span className="sdet-val">{log.amount} USDC</span>
                              </div>
                              <div className="sdet-row">
                                <span className="sdet-label">Compute Units</span>
                                <span className="sdet-val">{log.computeUnits} CU</span>
                              </div>
                              <div className="sdet-row">
                                <span className="sdet-label">Status</span>
                                <span className={`sdet-val status-${log.status}`}>
                                  {log.status}
                                </span>
                              </div>
                              <div className="sdet-row">
                                <span className="sdet-label">Date</span>
                                <span className="sdet-val">
                                  {new Date(log.createdAt).toLocaleString()}
                                </span>
                              </div>
                              {log.txHash ? (
                                <a
                                  href={`https://testnet.arcscan.app/tx/${log.txHash}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="explorer-link"
                                >
                                  View on Arc Testnet Explorer ↗
                                </a>
                              ) : (
                                <span className="explorer-pending">
                                  ⏳ On-chain hash pending confirmation
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </main>

          {/* Agent Status Panel - Now integrated into the bottom of the main area */}
          <AgentStatusPanel status={agentStatus} />

          {/* ── Payment Confirmation Modal ── */}
          {pendingAgent && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 2147483647, padding: '20px',
            }}>
              <div style={{
                background: '#0f172a', borderRadius: '20px', padding: '28px',
                width: '100%', maxWidth: '360px', border: '1px solid rgba(59,130,246,0.3)',
                boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
                fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
              }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                  <span style={{ fontSize: '28px' }}>{AGENT_META[pendingAgent]?.icon}</span>
                  <div>
                    <div style={{ color: 'white', fontWeight: 700, fontSize: '16px' }}>
                      {AGENT_META[pendingAgent]?.title}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>
                      Arc Testnet · Circle Nanopayment
                    </div>
                  </div>
                </div>

                {loadingQuote ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: 'rgba(255,255,255,0.6)' }}>
                    Fetching quote…
                  </div>
                ) : agentQuote ? (
                  <>
                    {/* Price breakdown */}
                    <div style={{
                      background: 'rgba(255,255,255,0.05)', borderRadius: '12px',
                      padding: '16px', marginBottom: '16px',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px' }}>Agent fee</span>
                        <span style={{ color: 'white', fontWeight: 600, fontSize: '13px' }}>
                          {agentQuote.priceUsdc.toFixed(6)} USDC
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px' }}>Gas buffer</span>
                        <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px' }}>
                          {agentQuote.gasBuffer.toFixed(6)} USDC
                        </span>
                      </div>
                      <div style={{
                        borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '10px',
                        display: 'flex', justifyContent: 'space-between',
                      }}>
                        <span style={{ color: 'white', fontWeight: 700, fontSize: '14px' }}>Total</span>
                        <span style={{ color: '#3b82f6', fontWeight: 700, fontSize: '14px' }}>
                          {agentQuote.totalRequired.toFixed(6)} USDC
                        </span>
                      </div>
                    </div>

                    {/* Balance status */}
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      marginBottom: '16px', fontSize: '12px',
                    }}>
                      <span style={{ color: 'rgba(255,255,255,0.5)' }}>Your balance</span>
                      <span style={{
                        color: agentQuote.canProceed ? '#10b981' : '#ef4444',
                        fontWeight: 600,
                      }}>
                        {agentQuote.userBalance.toFixed(6)} USDC
                        {agentQuote.canProceed ? ' ✓' : ' ✗'}
                      </span>
                    </div>

                    {/* Bridge notice */}
                    {agentQuote.needsBridge && (
                      <div style={{
                        background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)',
                        borderRadius: '10px', padding: '12px', marginBottom: '16px', fontSize: '12px',
                        color: '#fbbf24',
                      }}>
                        ⚡ Your wallet is on <strong>{agentQuote.sourceChain}</strong>.
                        USDC will be bridged to Arc Testnet via Circle CCTP before payment.
                      </div>
                    )}

                    {/* Insufficient balance warning */}
                    {!agentQuote.canProceed && (
                      <div style={{
                        background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
                        borderRadius: '10px', padding: '12px', marginBottom: '16px', fontSize: '12px',
                        color: '#fca5a5',
                      }}>
                        Insufficient balance. Need{' '}
                        <strong>{(agentQuote.totalRequired - agentQuote.userBalance).toFixed(6)} more USDC</strong>.{' '}
                        <a
                          href={`https://faucet.circle.com?address=${walletAddress}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#60a5fa', textDecoration: 'underline' }}
                        >
                          Get USDC →
                        </a>
                      </div>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        onClick={() => { setPendingAgent(null); setAgentQuote(null); }}
                        style={{
                          flex: 1, padding: '12px', background: 'rgba(255,255,255,0.08)',
                          border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px',
                          color: 'white', cursor: 'pointer', fontSize: '14px', fontWeight: 600,
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={confirmAndRunAudit}
                        disabled={!agentQuote.canProceed}
                        style={{
                          flex: 2, padding: '12px',
                          background: agentQuote.canProceed
                            ? 'linear-gradient(135deg,#3b82f6,#8b5cf6)'
                            : 'rgba(255,255,255,0.1)',
                          border: 'none', borderRadius: '10px',
                          color: agentQuote.canProceed ? 'white' : 'rgba(255,255,255,0.3)',
                          cursor: agentQuote.canProceed ? 'pointer' : 'not-allowed',
                          fontSize: '14px', fontWeight: 700,
                        }}
                      >
                        {agentQuote.canProceed
                          ? `Pay ${agentQuote.priceUsdc.toFixed(4)} USDC & Run`
                          : 'Insufficient Balance'}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )}

          {/* ── Notification Banner ── */}
          {notification && (
            <div style={{
              position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
              background: notification.type === 'error' ? '#ef4444'
                : notification.type === 'success' ? '#10b981'
                  : notification.type === 'warning' ? '#f59e0b'
                    : '#3b82f6',
              color: 'white', padding: '12px 20px', borderRadius: '12px',
              fontSize: '13px', fontWeight: 600, zIndex: 2147483646,
              maxWidth: '360px', textAlign: 'center',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}>
              {notification.message}
            </div>
          )}

          {/* ── Footer ── */}
          <footer className="footer">
            <div className="wallet-info" onClick={() => setActiveModal('details')} style={{ cursor: 'pointer' }}>
              <span className="wallet-dot" />
              <span className="wallet-addr">{walletAddress.slice(0, 10)}...{walletAddress.slice(-6)}</span>
              <span className="wallet-expand">{activeModal === 'details' ? '▲' : '▼'}</span>
            </div>
            <button className="logout-btn" onClick={disconnect}>Disconnect</button>
          </footer>

          {/* ── Notification ── */}
          {notification && (
            <div className={`notification notification-${notification.type}`}>
              {notification.type === 'success' ? '✅' : notification.type === 'error' ? '❌' : 'ℹ️'}
              {notification.message}
            </div>
          )}

          {/* ── Import Wallet Modal ── */}
          {activeModal === 'import' && (
            <div className="wallet-modal">
              <div className="modal-content">
                <div className="modal-header">
                  <h3>Import Existing Wallet</h3>
                  <button className="close-btn" onClick={() => setActiveModal('none')}>×</button>
                </div>
                <div className="modal-body">
                  <div className="import-section">
                    <label>Enter Wallet Address</label>
                    <input
                      type="text"
                      className="wallet-input"
                      placeholder="0x..."
                      value={importAddress}
                      onChange={(e) => setImportAddress(e.target.value)}
                      disabled={importStatus === 'verifying' || importStatus === 'importing'}
                    />
                    <div className="import-actions">
                      <button
                        className="btn btn-secondary"
                        onClick={handleVerifyWallet}
                        disabled={!importAddress || importStatus === 'verifying' || importStatus === 'importing'}
                      >
                        {importStatus === 'verifying' ? 'Verifying...' : 'Verify'}
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() => handleImportWallet()}
                        disabled={importStatus !== 'success' && importStatus !== 'idle'}
                      >
                        {importStatus === 'importing' ? 'Importing...' : 'Import'}
                      </button>
                    </div>
                    {importMessage && (
                      <div className={`import-message ${importStatus === 'error' ? 'error' : importStatus === 'success' ? 'success' : 'info'}`}>
                        {importMessage}
                      </div>
                    )}
                  </div>

                  <div className="divider">
                    <span>OR</span>
                  </div>

                  <div className="import-section">
                    <label>Select from Your Circle Wallets</label>
                    {loadingWallets ? (
                      <div className="loading-wallets">Loading wallets...</div>
                    ) : availableWallets.length === 0 ? (
                      <div className="empty-wallets">No Arc wallets found in your Circle account.</div>
                    ) : (
                      <div className="wallet-list">
                        {availableWallets.map((wallet) => (
                          <div key={wallet.address} className="wallet-list-item">
                            <div className="wallet-list-info">
                              <div className="wallet-list-address">
                                {wallet.address.slice(0, 10)}...{wallet.address.slice(-8)}
                              </div>
                              <div className="wallet-list-blockchain">{wallet.blockchain}</div>
                            </div>
                            {wallet.imported ? (
                              <span className="wallet-imported-badge">✓ Imported</span>
                            ) : (
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => handleImportWallet(wallet.address)}
                                disabled={importStatus === 'importing'}
                              >
                                Import
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="import-info">
                    <p>💡 <strong>Bring Your Own Wallet (BYOW)</strong></p>
                    <p>Import an existing Circle wallet created with the same API credentials. The wallet must be on Arc Testnet or Arc Mainnet.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Wallet Details Modal ── */}
          {activeModal === 'details' && (
            <div className="wallet-modal">
              <div className="modal-content">
                <div className="modal-header">
                  <h3>Wallet Details</h3>
                  <button className="close-btn" onClick={() => setActiveModal('none')}>×</button>
                </div>
                <div className="modal-body">
                  <div className="wallet-detail-section">
                    <label>Wallet Address</label>
                    <div className="wallet-address-display">
                      <code>{walletAddress}</code>
                      <button className="copy-btn" onClick={copyWalletAddress} title="Copy address">
                        📋
                      </button>
                    </div>
                  </div>
                  <div className="wallet-detail-section">
                    <label>Network</label>
                    <div className="network-badge">
                      <span className="status-dot pulse" />
                      Arc Testnet (L1)
                    </div>
                  </div>

                  <div className="section-header">Cross-Chain Liquidity</div>
                  <div className="bridge-info-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                    <div className="bridge-card" style={{ padding: '8px', border: '1px solid var(--border)', borderRadius: '8px' }}>
                      <div className="bridge-card-label" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Ethereum (Sepolia)</div>
                      <div className="bridge-card-value" style={{ fontWeight: 'bold', fontSize: '12px' }}>
                        {crossChainBalances?.ethereumBalance || '0.00'} <span className="unit">USDC</span>
                      </div>
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => handleBridge('Ethereum_Sepolia')}
                        disabled={bridgingStatus === 'bridging' || parseFloat(crossChainBalances?.ethereumBalance || '0') === 0}
                        style={{ marginTop: '4px', fontSize: '10px', width: '100%' }}
                      >
                        Bridge
                      </button>
                    </div>
                    <div className="bridge-card" style={{ padding: '8px', border: '1px solid var(--border)', borderRadius: '8px' }}>
                      <div className="bridge-card-label" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Solana (Devnet)</div>
                      <div className="bridge-card-value" style={{ fontWeight: 'bold', fontSize: '12px' }}>
                        {crossChainBalances?.solanaBalance || '0.00'} <span className="unit">USDC</span>
                      </div>
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => handleBridge('Solana_Devnet')}
                        disabled={bridgingStatus === 'bridging' || parseFloat(crossChainBalances?.solanaBalance || '0') === 0}
                        style={{ marginTop: '4px', fontSize: '10px', width: '100%' }}
                      >
                        Bridge
                      </button>
                    </div>
                  </div>

                  {bridgingStatus !== 'idle' && (
                    <div className={`bridge-status-banner ${bridgingStatus}`} style={{ fontSize: '11px', marginBottom: '10px', padding: '4px' }}>
                      {bridgingStatus === 'checking' && '🔍 Checking cross-chain funds...'}
                      {bridgingStatus === 'bridging' && '🌉 Bridging in progress (10-30s)...'}
                      {bridgingStatus === 'success' && '✅ Bridge successful!'}
                      {bridgingStatus === 'error' && '❌ Bridge failed.'}
                    </div>
                  )}

                  <div className="wallet-detail-section">
                    <label>Balance</label>
                    <div className="balance-display">
                      {loadingBalance ? 'Loading...' : `${parseFloat(usdcBalance).toFixed(6)} USDC`}
                    </div>
                  </div>
                  <div className="wallet-actions">
                    <button
                      className="btn btn-secondary btn-block"
                      onClick={() => setActiveModal('confirm_new_wallet')}
                      disabled={creatingNewWallet}
                    >
                      {creatingNewWallet ? 'Creating...' : '🔄 Create New Wallet'}
                    </button>
                    <button
                      className="btn btn-secondary btn-block"
                      onClick={() => setActiveModal('import')}
                    >
                      📥 Import Existing Wallet
                    </button>
                    <p className="wallet-warning">
                      ⚠️ Managed by Circle Arc API.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Confirm New Wallet Modal ── */}
          {activeModal === 'confirm_new_wallet' && (
            <div className="wallet-modal">
              <div className="modal-content">
                <div className="modal-header">
                  <h3>Create New Wallet?</h3>
                  <button className="close-btn" onClick={() => setActiveModal('details')}>×</button>
                </div>
                <div className="modal-body">
                  <p className="subtitle">This will disconnect your current wallet. Any funds in the current wallet will remain on the Arc blockchain, but you will need its address to access it later.</p>
                  <div className="wallet-actions">
                    <button className="btn btn-primary btn-block" onClick={createNewWallet}>
                      Confirm & Create
                    </button>
                    <button className="btn btn-secondary btn-block" onClick={() => setActiveModal('details')}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        
        :root {
          --primary: #3b82f6;
          --primary-dark: #2563eb;
          --bg: #f8fafc;
          --surface: #ffffff;
          --border: #e2e8f0;
          --text-main: #0f172a;
          --text-muted: #64748b;
          --azure: #3b82f6;
          --indigo: #4338ca;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }
        
        .app {
          width: 420px; height: 600px;
          background: var(--bg);
          color: var(--text-main);
          font-family: 'Inter', -apple-system, sans-serif;
          display: flex; flex-direction: column;
          overflow: hidden;
        }

        /* Header */
        .header {
          padding: 16px; background: var(--surface);
          border-bottom: 1px solid var(--border);
          display: flex; justify-content: space-between; align-items: center;
        }
        .brand { display: flex; align-items: center; gap: 10px; }
        .brand-name { font-size: 18px; font-weight: 800; letter-spacing: -0.5px; }
        .text-azure { color: var(--azure); }
        .arc-status {
          background: #f1f5f9; padding: 4px 10px; border-radius: 100px;
          font-size: 10px; font-weight: 700; color: var(--text-muted);
          display: flex; align-items: center; gap: 6px; text-transform: uppercase;
        }
        .status-dot { width: 6px; height: 6px; background: #22c55e; border-radius: 50%; }
        .pulse { animation: pulse 2s infinite; }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }

        /* Connect Screen */
        .connect-screen {
          flex: 1; padding: 40px 30px; display: flex; flex-direction: column; align-items: center; text-align: center;
        }
        .hero-asset { margin-bottom: 30px; }
        .floating-card {
           width: 200px; height: 120px;
           background: linear-gradient(135deg, #3b82f6, #4338ca);
           border-radius: 16px; padding: 20px; color: white;
           box-shadow: 0 20px 40px rgba(59, 130, 246, 0.3);
           display: flex; flex-direction: column; justify-content: space-between;
           animation: float 4s ease-in-out infinite;
        }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        .card-logo { font-weight: 900; font-style: italic; opacity: 0.8; }
        .card-number { font-family: monospace; font-size: 14px; opacity: 0.9; }
        .title { font-size: 22px; font-weight: 800; margin-bottom: 12px; }
        .subtitle { font-size: 13px; color: var(--text-muted); line-height: 1.6; margin-bottom: 30px; }
        .trust-badges { margin-top: auto; font-size: 11px; color: var(--text-muted); font-weight: 600; opacity: 0.6; }

        /* Dashboard */
        .tabs { display: flex; background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 8px; gap: 4px; }
        .tab-btn {
          flex: 1; padding: 12px 8px; background: none; border: none;
          font-size: 11px; font-weight: 700; color: var(--text-muted);
          cursor: pointer; transition: all 0.2s;
          display: flex; flex-direction: column; align-items: center; gap: 4px;
          border-bottom: 3px solid transparent;
        }
        .tab-icon { font-size: 16px; margin-bottom: 2px; transition: transform 0.2s; }
        .tab-btn:hover .tab-icon { transform: translateY(-2px); }
        .tab-btn-active { color: var(--azure); border-bottom-color: var(--azure); }
        .tab-btn-active .tab-icon { transform: scale(1.1); }
        
        .main { flex: 1; padding: 16px; overflow-y: auto; transition: padding 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .main-with-status { padding-bottom: 100px; }
        
        .card-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
        .card {
           background: var(--surface); border: 1px solid var(--border);
           border-radius: 12px; padding: 14px; display: flex; flex-direction: column;
        }
        .card-hero { grid-column: span 2; border-left: 4px solid var(--azure); }
        .card-label { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; display: flex; align-items: center; }
        .card-value { font-size: 24px; font-weight: 800; color: var(--text-main); }
        .unit { font-size: 12px; font-weight: 500; color: var(--text-muted); }
        .card-sub { font-size: 11px; color: var(--text-muted); margin-top: 4px; }

        .section-header { font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 10px; margin-top: 20px; }
        
        .audit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .audit-card {
           background: var(--surface); border: 1px solid var(--border);
           border-radius: 12px; padding: 12px; display: flex; flex-direction: column; align-items: center; gap: 8px;
           cursor: pointer; transition: all 0.2s; text-align: center;
        }
        .audit-card:hover { border-color: var(--azure); transform: translateY(-4px) scale(1.02); box-shadow: 0 12px 24px rgba(59, 130, 246, 0.15); }
        .audit-icon { font-size: 24px; width: 48px; height: 48px; background: #f1f5f9; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: all 0.3s; }
        .audit-card:hover .audit-icon { transform: rotate(10deg) scale(1.1); }
        .icon-ui { color: #3b82f6; background: #eff6ff; }
        .icon-ux { color: #8b5cf6; background: #f5f3ff; }
        .icon-dom { color: #10b981; background: #ecfdf5; }
        .icon-security { color: #ef4444; background: #fef2f2; }
        .audit-title { font-size: 13px; font-weight: 700; color: var(--text-main); }
        .audit-price { font-size: 10px; color: var(--azure); font-weight: 600; }
        .agent-desc { font-size: 10px; color: var(--text-muted); }

        /* Wand card */
        .wand-card {
          margin-top: 10px;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 12px; padding: 14px 16px;
          display: flex; align-items: center; justify-content: space-between;
          cursor: pointer; transition: border-color 0.2s, box-shadow 0.2s;
        }
        .wand-card:hover { border-color: #8b5cf6; box-shadow: 0 4px 14px rgba(139,92,246,0.12); }
        .wand-card.wand-active {
          border-color: #8b5cf6;
          background: linear-gradient(135deg, rgba(139,92,246,0.06), rgba(59,130,246,0.06));
          box-shadow: 0 0 0 2px rgba(139,92,246,0.25);
        }
        .wand-left { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
        .wand-icon-wrap { position: relative; flex-shrink: 0; }
        .wand-icon { font-size: 26px; display: block; }
        .wand-listening-ring {
          position: absolute; inset: -5px; border-radius: 50%;
          border: 2px solid #8b5cf6;
          animation: wand-ring-pulse 1.2s ease-in-out infinite;
        }
        @keyframes wand-ring-pulse {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50%       { transform: scale(1.25); opacity: 0.3; }
        }
        .wand-info { min-width: 0; }
        .wand-title {
          font-size: 14px; font-weight: 700; color: var(--text-main);
          display: flex; align-items: center; gap: 6px;
        }
        .wand-live-badge {
          font-size: 9px; font-weight: 800; letter-spacing: 0.5px;
          background: #8b5cf6; color: white;
          padding: 2px 6px; border-radius: 4px;
          animation: wand-badge-blink 1.4s ease-in-out infinite;
        }
        @keyframes wand-badge-blink {
          0%, 100% { opacity: 1; } 50% { opacity: 0.5; }
        }
        .wand-desc { font-size: 10px; color: var(--text-muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wand-shortcut {
          display: flex; align-items: center; gap: 3px;
          flex-shrink: 0; margin-left: 10px;
        }
        .wand-shortcut kbd {
          background: #f1f5f9; border: 1px solid #cbd5e1;
          border-radius: 4px; padding: 2px 5px;
          font-size: 9px; font-weight: 700; color: var(--text-muted);
          font-family: monospace;
        }
        .wand-shortcut span { font-size: 9px; color: var(--text-muted); }

        /* Records */
        .record-list { display: flex; flex-direction: column; gap: 10px; }
        .record-card {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 12px; padding: 14px;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .record-card:hover { border-color: var(--azure); box-shadow: 0 2px 12px rgba(59,130,246,0.12); }
        .record-header { display: flex; justify-content: space-between; margin-bottom: 8px; align-items: center; }
        .record-url { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 8px; }
        .record-footer { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; align-items: center; }
        .record-chevron { color: var(--text-muted); font-size: 13px; }
        .badge { font-size: 9px; font-weight: 800; padding: 3px 8px; border-radius: 6px; text-transform: uppercase; display: inline-flex; align-items: center; gap: 4px; }
        .badge-ui { background: #eff6ff; color: #1d4ed8; }
        .badge-ux { background: #f5f3ff; color: #6d28d9; }
        .badge-dom { background: #ecfdf5; color: #065f46; }
        .badge-security { background: #fee2e2; color: #b91c1c; }
        .badge-uiux { background: #e0f2fe; color: #0369a1; }
        .text-danger { color: #ef4444; }
        .text-success { color: #10b981; }

        /* Issue Detail Panel */
        .issue-detail { display: flex; flex-direction: column; gap: 12px; }
        .back-btn {
          background: none; border: none; color: var(--azure); font-size: 13px;
          font-weight: 600; cursor: pointer; padding: 0; text-align: left;
          display: flex; align-items: center; gap: 4px;
        }
        .back-btn:hover { text-decoration: underline; }
        .detail-header { display: flex; justify-content: space-between; align-items: center; }
        .detail-url {
          font-size: 11px; color: var(--text-muted); word-break: break-all;
          background: var(--bg); padding: 8px 10px; border-radius: 8px;
          border: 1px solid var(--border);
        }
        .detail-meta { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; }
        .issue-list { display: flex; flex-direction: column; gap: 10px; }
        .issue-card {
          background: var(--surface); border-radius: 10px; padding: 12px;
          border-left: 3px solid var(--border);
        }
        .issue-card.sev-critical { border-left-color: #ef4444; }
        .issue-card.sev-high     { border-left-color: #f97316; }
        .issue-card.sev-medium   { border-left-color: #f59e0b; }
        .issue-card.sev-low      { border-left-color: #3b82f6; }
        .issue-card.sev-info     { border-left-color: #10b981; }
        .issue-card-header { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px; }
        .sev-badge {
          font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 4px;
          text-transform: uppercase; white-space: nowrap; flex-shrink: 0;
        }
        .sev-badge.sev-critical { background: #fee2e2; color: #b91c1c; }
        .sev-badge.sev-high     { background: #ffedd5; color: #c2410c; }
        .sev-badge.sev-medium   { background: #fef3c7; color: #92400e; }
        .sev-badge.sev-low      { background: #eff6ff; color: #1d4ed8; }
        .sev-badge.sev-info     { background: #ecfdf5; color: #065f46; }
        .issue-title { font-size: 13px; font-weight: 700; color: var(--text-main); line-height: 1.4; }
        .issue-desc { font-size: 12px; color: var(--text-muted); line-height: 1.6; margin: 0 0 6px; }
        .issue-rec {
          font-size: 11px; color: #065f46; background: #ecfdf5;
          border-radius: 6px; padding: 6px 10px; line-height: 1.5;
        }

        /* Agent section grouping in detail view */
        .agent-section { margin-bottom: 14px; }
        .agent-section-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 8px; padding-bottom: 6px;
          border-bottom: 1px solid var(--border);
        }
        .agent-section-meta { font-size: 11px; color: var(--text-muted); font-weight: 600; }
        .agent-no-issues { font-size: 12px; color: #10b981; padding: 6px 0; }

        /* Settlements */
        .settlement-list { display: flex; flex-direction: column; gap: 8px; }
        .settlement-card {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 12px; overflow: hidden;
        }
        .settlement-row {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 14px; cursor: pointer;
          transition: background 0.15s;
        }
        .settlement-row:hover { background: #f8fafc; }
        .settlement-left { flex: 1; min-width: 0; }
        .settlement-desc { font-size: 13px; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .settlement-tx { font-size: 11px; color: var(--text-muted); font-family: monospace; margin-top: 2px; }
        .settlement-right { text-align: right; flex-shrink: 0; }
        .settlement-amount { font-size: 13px; font-weight: 700; color: var(--azure); }
        .settlement-cu { font-size: 10px; color: var(--text-muted); background: #f1f5f9; padding: 1px 6px; border-radius: 4px; margin-top: 2px; display: inline-block; }
        .expand-chevron { font-size: 10px; color: var(--text-muted); flex-shrink: 0; }
        .settlement-detail {
          border-top: 1px solid var(--border); padding: 12px 14px;
          background: #f8fafc; display: flex; flex-direction: column; gap: 8px;
        }
        .sdet-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; font-size: 12px; }
        .sdet-label { color: var(--text-muted); font-weight: 600; flex-shrink: 0; }
        .sdet-val { color: var(--text-main); text-align: right; word-break: break-all; }
        .sdet-val.mono { font-family: monospace; font-size: 10px; }
        .sdet-val.status-confirmed, .sdet-val.status-completed { color: #10b981; font-weight: 700; }
        .sdet-val.status-pending { color: #f59e0b; font-weight: 700; }
        .sdet-val.status-failed { color: #ef4444; font-weight: 700; }
        .explorer-link {
          font-size: 11px; color: var(--azure); text-decoration: none;
          font-weight: 600; margin-top: 4px;
        }
        .explorer-link:hover { text-decoration: underline; }
        .explorer-pending {
          font-size: 11px; color: var(--text-muted); font-style: italic;
          margin-top: 4px;
        }

        /* Footer */
        .footer {
          padding: 12px 16px; background: var(--surface); border-top: 1px solid var(--border);
          display: flex; justify-content: space-between; align-items: center;
        }
        .wallet-info { display: flex; align-items: center; gap: 8px; }
        .wallet-dot { width: 6px; height: 6px; background: #22c55e; border-radius: 50%; }
        .wallet-addr { font-family: monospace; font-size: 11px; color: var(--text-muted); }
        .wallet-expand { font-size: 10px; color: var(--text-muted); margin-left: 4px; }
        .logout-btn { background: none; border: none; font-size: 11px; font-weight: 600; color: #ef4444; cursor: pointer; }

        /* Wallet Modal */
        .wallet-modal {
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(4px);
          display: flex; align-items: flex-end; z-index: 1000;
          animation: fadeIn 0.2s;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .modal-content {
          width: 100%; background: var(--surface);
          border-radius: 16px 16px 0 0; padding: 20px;
          animation: slideUp 0.3s;
        }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .modal-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 20px;
        }
        .modal-header h3 { font-size: 18px; font-weight: 700; }
        .close-btn {
          background: none; border: none; font-size: 28px;
          color: var(--text-muted); cursor: pointer; line-height: 1;
        }
        .modal-body { display: flex; flex-direction: column; gap: 16px; }
        .wallet-detail-section label {
          display: block; font-size: 11px; font-weight: 700;
          color: var(--text-muted); text-transform: uppercase;
          margin-bottom: 8px; letter-spacing: 0.5px;
        }
        .wallet-address-display {
          display: flex; align-items: center; gap: 8px;
          background: #f1f5f9; padding: 12px; border-radius: 8px;
        }
        .wallet-address-display code {
          flex: 1; font-size: 11px; color: var(--text-main);
          word-break: break-all; font-family: 'Courier New', monospace;
        }
        .copy-btn {
          background: var(--azure); border: none; padding: 6px 10px;
          border-radius: 6px; cursor: pointer; font-size: 14px;
          transition: all 0.2s;
        }
        .copy-btn:hover { transform: scale(1.1); }
        .network-badge {
          background: #ecfdf5; color: #059669; padding: 10px 14px;
          border-radius: 8px; font-size: 13px; font-weight: 600;
          display: inline-flex; align-items: center; gap: 8px;
        }
        .balance-display {
          font-size: 24px; font-weight: 800; color: var(--azure);
        }
        .wallet-actions {
          margin-top: 8px; display: flex; flex-direction: column; gap: 12px;
        }
        .btn-secondary:hover { background: #e2e8f0; }

        /* Notifications */
        .notification {
          position: absolute;
          top: 70px;
          left: 16px;
          right: 16px;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 10px;
          z-index: 2000;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          animation: slideDown 0.3s ease-out;
        }
        @keyframes slideDown {
          from { transform: translateY(-20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .notification-success { background: #ecfdf5; color: #059669; border-left: 4px solid #10b981; }
        .notification-error { background: #fef2f2; color: #dc2626; border-left: 4px solid #ef4444; }
        .notification-info { background: #eff6ff; color: #2563eb; border-left: 4px solid #3b82f6; }
        .btn { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
        .btn:active { transform: scale(0.95); }
        .badge-security { background: #fee2e2; color: #991b1b; }
        .record-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }

        /* Bridging Styles */
        .bridge-info-grid {
          margin: 12px 0;
        }
        .bridge-card {
          background: #f8fafc;
          transition: all 0.2s ease;
        }
        .bridge-card:hover {
          border-color: var(--azure) !important;
          background: #f1f5f9;
        }
        .bridge-status-banner {
          border-radius: 6px;
          text-align: center;
          font-weight: 600;
        }
        .bridge-status-banner.bridging { background: #eff6ff; color: #1d4ed8; }
        .bridge-status-banner.success { background: #f0fdf4; color: #166534; }
        .bridge-status-banner.error { background: #fef2f2; color: #991b1b; }

        /* Notification */
        .notification { transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .wallet-warning {
          font-size: 11px; color: #f59e0b; background: #fffbeb;
          padding: 10px; border-radius: 6px; line-height: 1.5;
          border-left: 3px solid #f59e0b;
        }

        /* Buttons */
        .btn { border: none; cursor: pointer; font-family: inherit; font-weight: 700; transition: all 0.2s; border-radius: 8px; }
        .btn-primary { background: var(--azure); color: white; }
        .btn-lg { width: 100%; padding: 14px; font-size: 15px; }
        .btn:disabled { opacity: 0.5; }

        .p-loading {
          flex: 1; display: flex; align-items: center; justify-content: center;
          background: var(--bg);
        }
        .loading-inner {
          display: flex; flex-direction: column; align-items: center; gap: 14px;
        }
        .gear-spin {
          animation: gear-rotate 1.8s linear infinite;
          filter: drop-shadow(0 4px 16px rgba(59,130,246,0.35));
        }
        @keyframes gear-rotate {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        .loading-text {
          font-size: 15px; font-weight: 700; color: var(--text-main);
          letter-spacing: -0.3px;
        }
        .loading-sub {
          font-size: 11px; color: var(--text-muted); font-weight: 500;
          letter-spacing: 0.2px;
        }
        .empty-state { padding: 40px; text-align: center; color: var(--text-muted); font-size: 13px; }

        /* Import Wallet Modal */
        .import-section { margin-bottom: 20px; }
        .wallet-input {
          width: 100%; padding: 12px; border: 1px solid var(--border);
          border-radius: 8px; font-size: 13px; font-family: monospace;
          margin-bottom: 12px;
        }
        .wallet-input:focus { outline: none; border-color: var(--azure); }
        .import-actions {
          display: flex; gap: 8px; margin-bottom: 12px;
        }
        .import-actions .btn { flex: 1; }
        .import-message {
          padding: 10px; border-radius: 6px; font-size: 12px;
          line-height: 1.5;
        }
        .import-message.error {
          background: #fef2f2; color: #b91c1c; border-left: 3px solid #ef4444;
        }
        .import-message.success {
          background: #ecfdf5; color: #059669; border-left: 3px solid #10b981;
        }
        .import-message.info {
          background: #eff6ff; color: #1e40af; border-left: 3px solid #3b82f6;
        }
        .divider {
          text-align: center; margin: 20px 0; position: relative;
        }
        .divider::before {
          content: ''; position: absolute; top: 50%; left: 0; right: 0;
          height: 1px; background: var(--border);
        }
        .divider span {
          background: var(--surface); padding: 0 12px; position: relative;
          font-size: 11px; font-weight: 700; color: var(--text-muted);
        }
        .wallet-list {
          max-height: 200px; overflow-y: auto; border: 1px solid var(--border);
          border-radius: 8px;
        }
        .wallet-list-item {
          padding: 12px; display: flex; justify-content: space-between;
          align-items: center; border-bottom: 1px solid var(--border);
        }
        .wallet-list-item:last-child { border-bottom: none; }
        .wallet-list-info { flex: 1; }
        .wallet-list-address {
          font-family: monospace; font-size: 12px; font-weight: 600;
          color: var(--text-main);
        }
        .wallet-list-blockchain {
          font-size: 10px; color: var(--text-muted); margin-top: 2px;
        }
        .wallet-imported-badge {
          font-size: 11px; color: #059669; font-weight: 600;
          background: #ecfdf5; padding: 4px 8px; border-radius: 4px;
        }
        .loading-wallets, .empty-wallets {
          padding: 20px; text-align: center; color: var(--text-muted);
          font-size: 12px;
        }
        .import-info {
          background: #fffbeb; border: 1px solid #fbbf24;
          border-radius: 8px; padding: 12px; font-size: 11px;
          line-height: 1.6; color: #92400e;
        }
        .import-info p { margin: 4px 0; }
        .import-info strong { font-weight: 700; }
      `}</style>
    </div>
  );
};

export default Popup;
