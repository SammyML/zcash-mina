import { CSSProperties, useCallback, useEffect, useState } from 'react';

type ApiStatus = {
  tokenAddress: string;
  bridgeAddress: string;
  totalMinted: string;
  totalBurned: string;
  netLocked: string;
  isPaused: boolean;
  nullifierRoot: string;
  accounts: { alias: string; address: string }[];
};

type MintPayload = {
  recipient: string;
  amount: number;
};

type BurnPayload = {
  burner: string;
  amount: number;
  zcashAddress: string;
};

const DEFAULT_Z_ADDR = 'zs1demoaddressforzkzecbridge';
const ZATOSHI_SCALE = 100_000_000;
const ZATOSHI_SCALE_BIG = BigInt(ZATOSHI_SCALE);

export default function App() {
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [mintLoading, setMintLoading] = useState(false);
  const [burnLoading, setBurnLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mintForm, setMintForm] = useState<MintPayload>({
    recipient: 'user1',
    amount: 0.5,
  });
  const [burnForm, setBurnForm] = useState<BurnPayload>({
    burner: 'user1',
    amount: 0.25,
    zcashAddress: DEFAULT_Z_ADDR,
  });
  const [mintAmountInput, setMintAmountInput] = useState('0.5');
  const [burnAmountInput, setBurnAmountInput] = useState('0.25');

  const refresh = useCallback(async () => {
    setRefreshLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/status');
      if (!response.ok) {
        throw new Error(`Status request failed (${response.status})`);
      }
      const payload = (await response.json()) as ApiStatus;
      setStatus(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setRefreshLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submitMint = async () => {
    setError(null);
    setMintLoading(true);
    try {
      const response = await fetch('/api/mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mintForm),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? 'Mint failed');
      }
      const payload = (await response.json()) as ApiStatus;
      setStatus(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setMintLoading(false);
    }
  };

  const submitBurn = async () => {
    setError(null);
    setBurnLoading(true);
    try {
      const response = await fetch('/api/burn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(burnForm),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? 'Burn failed');
      }
      const payload = (await response.json()) as ApiStatus;
      setStatus(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBurnLoading(false);
    }
  };

  const resetDemo = async () => {
    setError(null);
    setRefreshLoading(true);
    try {
      const response = await fetch('/api/reset', { method: 'POST' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? 'Reset failed');
      }
      const payload = (await response.json()) as ApiStatus;
      setStatus(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setRefreshLoading(false);
    }
  };

  return (
    <>
      {/* Sidebar Toggle Button */}
      <button
        style={{
          ...styles.sidebarToggle,
          left: sidebarOpen ? '320px' : '0',
        }}
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        <div style={styles.hamburger}>
          <div style={styles.hamburgerLine}></div>
          <div style={styles.hamburgerLine}></div>
          <div style={styles.hamburgerLine}></div>
        </div>
      </button>

      {/* Sidebar */}
      <div
        style={{
          ...styles.sidebar,
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
        }}
      >
        <h3 style={styles.sidebarTitle}>Contract Details</h3>
        <div style={styles.sidebarContent}>
          <div style={styles.sidebarItem}>
            <span style={styles.sidebarLabel}>Token Address</span>
            <span style={styles.sidebarValue}>{truncate(status?.tokenAddress) || '—'}</span>
          </div>
          <div style={styles.sidebarItem}>
            <span style={styles.sidebarLabel}>Bridge Address</span>
            <span style={styles.sidebarValue}>{truncate(status?.bridgeAddress) || '—'}</span>
          </div>
          <div style={styles.sidebarItem}>
            <span style={styles.sidebarLabel}>Total Minted</span>
            <span style={styles.sidebarValue}>{formatAmount(status?.totalMinted)} zkZEC</span>
          </div>
          <div style={styles.sidebarItem}>
            <span style={styles.sidebarLabel}>Total Burned</span>
            <span style={styles.sidebarValue}>{formatAmount(status?.totalBurned)} zkZEC</span>
          </div>
          <div style={styles.sidebarItem}>
            <span style={styles.sidebarLabel}>Net Locked</span>
            <span style={styles.sidebarValue}>{formatAmount(status?.netLocked)} ZEC</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={styles.wrapper}>
        <header style={styles.header}>
          <div>
            <p style={styles.eyebrow}>Umbra Bridge</p>
            <h1 style={styles.title}>Zcash ⇄ Mina</h1>
            <p style={styles.subtitle}>
              Run the local Mina light client, mint zkZEC with <strong>recursive ZK proof verification</strong>,
              and simulate shielded withdrawals.
            </p>
          </div>
          <div style={styles.headerActions}>
            <button
              style={{ ...styles.secondaryButton, opacity: refreshLoading ? 0.7 : 1 }}
              onClick={refresh}
              disabled={refreshLoading}
            >
              {refreshLoading ? 'Refreshing...' : 'Refresh'}
            </button>
            <button
              style={{ ...styles.primaryButton, opacity: refreshLoading ? 0.7 : 1 }}
              onClick={resetDemo}
              disabled={refreshLoading}
            >
              Reset Demo
            </button>
          </div>
        </header>

        {error && (
          <div style={styles.errorBanner}>
            <strong>Oops:</strong> {error}
          </div>
        )}

        <section style={styles.statsGrid}>
          <StatCard
            label="Nullifier Root"
            value={truncate(status?.nullifierRoot) || '—'}
            monospace
          />
          <StatCard
            label="Bridge Status"
            value={status?.isPaused ? 'Paused' : 'Live'}
          />
        </section>

        <section style={styles.formsGrid}>
          <div style={styles.card}>
            <h2>Mint zkZEC</h2>
            <p style={styles.cardCopy}>
              Simulate a shielded Zcash deposit. The demo server generates a <strong>mock ZK proof</strong>,
              verifies it recursively, and updates the nullifier set.
            </p>
            <label style={styles.label}>
              Recipient
              <select
                style={styles.input}
                value={mintForm.recipient}
                onChange={(event) =>
                  setMintForm({ ...mintForm, recipient: event.target.value })
                }
              >
                {(status?.accounts ?? []).map((account) => (
                  <option key={account.address} value={account.alias}>
                    {account.alias} ({truncate(account.address)})
                  </option>
                ))}
              </select>
            </label>
            <label style={styles.label}>
              Amount (ZEC)
              <input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                style={styles.input}
                value={mintAmountInput}
                onChange={(event) => {
                  const value = event.target.value;
                  setMintAmountInput(value);
                  const numValue = parseFloat(value);
                  if (!isNaN(numValue)) {
                    setMintForm({ ...mintForm, amount: numValue });
                  }
                }}
              />
            </label>
            <button
              style={styles.primaryButton}
              onClick={submitMint}
              disabled={mintLoading}
            >
              {mintLoading ? 'Verifying Proof...' : 'Mint zkZEC'}
            </button>
          </div>

          <div style={styles.card}>
            <h2>Burn zkZEC</h2>
            <p style={styles.cardCopy}>
              Burn tokens to queue a shielded withdrawal request back to Zcash.
            </p>
            <label style={styles.label}>
              Burner
              <select
                style={styles.input}
                value={burnForm.burner}
                onChange={(event) =>
                  setBurnForm({ ...burnForm, burner: event.target.value })
                }
              >
                {(status?.accounts ?? []).map((account) => (
                  <option key={account.address} value={account.alias}>
                    {account.alias} ({truncate(account.address)})
                  </option>
                ))}
              </select>
            </label>
            <label style={styles.label}>
              Amount (ZEC)
              <input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                style={styles.input}
                value={burnAmountInput}
                onChange={(event) => {
                  const value = event.target.value;
                  setBurnAmountInput(value);
                  const numValue = parseFloat(value);
                  if (!isNaN(numValue)) {
                    setBurnForm({ ...burnForm, amount: numValue });
                  }
                }}
              />
            </label>
            <label style={styles.label}>
              Zcash Address
              <input
                style={styles.input}
                value={burnForm.zcashAddress}
                onChange={(event) =>
                  setBurnForm({ ...burnForm, zcashAddress: event.target.value })
                }
              />
            </label>
            <button
              style={styles.primaryButton}
              onClick={submitBurn}
              disabled={burnLoading}
            >
              {burnLoading ? 'Processing...' : 'Burn zkZEC'}
            </button>
          </div>
        </section>

        {/* Architecture Diagram - Moved below forms */}
        <section style={styles.architectureSection}>
          <h2 style={styles.architectureTitle}>How It Works</h2>
          <p style={styles.architectureSubtitle}>
            Combining Zcash's privacy with Mina's programmability through recursive zero-knowledge proofs
          </p>

          <div style={styles.flowDiagram}>
            <div style={styles.flowStep}>
              <div style={{ ...styles.flowIcon, background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}></div>
              <h3 style={styles.flowStepTitle}>Zcash Privacy</h3>
              <p style={styles.flowStepDesc}>
                Shielded transactions with zk-SNARKs protect sender, receiver, and amount
              </p>
              <div style={styles.flowStepDetails}>
                <span>• Nullifiers</span>
                <span>• Commitments</span>
                <span>• Value Balance</span>
              </div>
            </div>

            <div style={styles.flowArrow}>→</div>

            <div style={styles.flowStep}>
              <div style={{ ...styles.flowIcon, background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)' }}></div>
              <h3 style={styles.flowStepTitle}>Recursive Verification</h3>
              <p style={styles.flowStepDesc}>
                ZcashVerifier ZkProgram validates proofs recursively on Mina
              </p>
              <div style={styles.flowStepDetails}>
                <span>• Batch Verification</span>
                <span>• Constant Size Proofs</span>
                <span>• O(1) Verification</span>
              </div>
            </div>

            <div style={styles.flowArrow}>→</div>

            <div style={styles.flowStep}>
              <div style={{ ...styles.flowIcon, background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}></div>
              <h3 style={styles.flowStepTitle}>Mina Programmability</h3>
              <p style={styles.flowStepDesc}>
                zkZEC tokens become programmable in Mina's zkApp ecosystem
              </p>
              <div style={styles.flowStepDetails}>
                <span>• Smart Contracts</span>
                <span>• DeFi Integration</span>
                <span>• Composability</span>
              </div>
            </div>
          </div>

          <div style={styles.techHighlights}>
            <div style={styles.techCard}>
              <span style={styles.techLabel}>Light Client</span>
              <span style={styles.techValue}>Tracks Zcash headers on-chain</span>
            </div>
            <div style={styles.techCard}>
              <span style={styles.techLabel}>Nullifier Set</span>
              <span style={styles.techValue}>Prevents double-spending</span>
            </div>
            <div style={styles.techCard}>
              <span style={styles.techLabel}>Merkle Proofs</span>
              <span style={styles.techValue}>Efficient state verification</span>
            </div>
          </div>
        </section>

        {(mintLoading || burnLoading || refreshLoading) && <p style={styles.footerNote}>Syncing with Mina Local Blockchain...</p>}
      </div>
    </>
  );
}

const StatCard = ({
  label,
  value,
  monospace,
}: {
  label: string;
  value: string;
  monospace?: boolean;
}) => (
  <div style={styles.statCard}>
    <p style={styles.statLabel}>{label}</p>
    <p
      style={{
        ...styles.statValue,
        fontFamily: monospace ? 'Source Code Pro, monospace' : undefined,
      }}
    >
      {value}
    </p>
  </div>
);

function truncate(value?: string) {
  if (!value) return '';
  return value.length > 12
    ? `${value.slice(0, 6)}…${value.slice(value.length - 4)}`
    : value;
}

function formatAmount(value?: string) {
  if (!value) return '—';
  try {
    const bigValue = BigInt(value);
    const whole = bigValue / ZATOSHI_SCALE_BIG;
    const fraction = bigValue % ZATOSHI_SCALE_BIG;
    const decimals = fraction.toString().padStart(8, '0').slice(0, 4);
    return `${whole.toString()}.${decimals}`;
  } catch (e) {
    console.error('Error formatting amount:', value, e);
    return 'Error';
  }
}

const styles: Record<string, CSSProperties> = {
  sidebarToggle: {
    position: 'fixed',
    top: '1.5rem',
    transform: 'none',
    zIndex: 9999,
    background: 'linear-gradient(135deg, rgba(99,102,241,1) 0%, rgba(14,165,233,1) 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: '0 8px 8px 0',
    padding: '0.75rem',
    cursor: 'pointer',
    transition: 'left 0.3s ease',
    boxShadow: '2px 0 10px rgba(0,0,0,0.1)',
  },
  hamburger: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    width: '20px',
  },
  hamburgerLine: {
    width: '100%',
    height: '2px',
    backgroundColor: '#fff',
    borderRadius: '2px',
  },
  sidebar: {
    position: 'fixed',
    left: 0,
    top: 0,
    bottom: 0,
    width: '320px',
    backgroundColor: '#fff',
    boxShadow: '2px 0 20px rgba(0,0,0,0.1)',
    zIndex: 9998,
    transition: 'transform 0.3s ease',
    overflowY: 'auto',
    padding: '2rem 1.5rem',
  },
  sidebarTitle: {
    margin: '0 0 1.5rem 0',
    fontSize: '1.25rem',
    fontWeight: 700,
    color: '#111827',
  },
  sidebarContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  sidebarItem: {
    padding: '1rem',
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  sidebarLabel: {
    fontSize: '0.75rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#6b7280',
  },
  sidebarValue: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#111827',
    wordBreak: 'break-all',
    fontFamily: 'Source Code Pro, monospace',
  },
  wrapper: {
    maxWidth: 1100,
    margin: '0 auto',
    padding: '2rem 1.5rem 4rem',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '1.5rem',
    flexWrap: 'wrap',
    marginBottom: '2rem',
  },
  eyebrow: {
    textTransform: 'uppercase',
    letterSpacing: '0.2em',
    fontSize: '0.75rem',
    margin: 0,
    color: '#6366f1',
  },
  title: {
    fontSize: '2.5rem',
    margin: '0.25rem 0',
  },
  subtitle: {
    margin: 0,
    maxWidth: 520,
    color: '#4b5563',
  },
  headerActions: {
    display: 'flex',
    gap: '0.75rem',
  },
  primaryButton: {
    background:
      'linear-gradient(135deg, rgba(99,102,241,1) 0%, rgba(14,165,233,1) 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: 999,
    padding: '0.75rem 1.5rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    color: '#111827',
    border: '2px solid #c7d2fe',
    borderRadius: 999,
    padding: '0.75rem 1.5rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  errorBanner: {
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    padding: '0.75rem 1rem',
    borderRadius: 12,
    marginBottom: '1rem',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '1rem',
    marginBottom: '2rem',
  },
  statCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    backdropFilter: 'blur(10px)',
    padding: '1rem',
    borderRadius: 16,
    boxShadow: '0 15px 35px rgba(15, 23, 42, 0.08)',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    cursor: 'default',
  },
  statLabel: {
    margin: 0,
    fontSize: '0.85rem',
    color: '#6b7280',
  },
  statValue: {
    margin: '0.35rem 0 0',
    fontSize: '1.1rem',
    fontWeight: 600,
    wordBreak: 'break-all',
  },
  formsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '1.5rem',
    marginBottom: '3rem',
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    backdropFilter: 'blur(20px)',
    borderRadius: 20,
    padding: '1.5rem',
    boxShadow: '0 25px 45px rgba(15, 23, 42, 0.08)',
    border: '1px solid rgba(255, 255, 255, 0.4)',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
    position: 'relative',
    overflow: 'hidden',
  },
  cardCopy: {
    marginTop: 0,
    marginBottom: '0.5rem',
    color: '#4b5563',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  input: {
    padding: '0.65rem 0.8rem',
    borderRadius: 12,
    border: '1px solid #e5e7eb',
    fontSize: '1rem',
    transition: 'all 0.2s ease',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
  architectureSection: {
    marginBottom: '3rem',
    padding: '2rem',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    backdropFilter: 'blur(20px)',
    borderRadius: 24,
    border: '1px solid rgba(255, 255, 255, 0.4)',
  },
  architectureTitle: {
    textAlign: 'center',
    fontSize: '2rem',
    fontWeight: 800,
    marginBottom: '0.5rem',
    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  architectureSubtitle: {
    textAlign: 'center',
    color: '#6b7280',
    marginBottom: '2rem',
    fontSize: '1.1rem',
  },
  flowDiagram: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    marginBottom: '2rem',
    flexWrap: 'wrap',
  },
  flowStep: {
    flex: 1,
    minWidth: '200px',
    padding: '1.5rem',
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    borderRadius: 16,
    border: '2px solid rgba(99, 102, 241, 0.1)',
    transition: 'all 0.3s ease',
    textAlign: 'center',
  },
  flowIcon: {
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '2rem',
    margin: '0 auto 1rem',
    boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
  },
  flowStepTitle: {
    fontSize: '1.1rem',
    fontWeight: 700,
    marginBottom: '0.5rem',
    color: '#111827',
  },
  flowStepDesc: {
    fontSize: '0.9rem',
    color: '#6b7280',
    marginBottom: '1rem',
    lineHeight: 1.5,
  },
  flowStepDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    fontSize: '0.85rem',
    color: '#4b5563',
    fontWeight: 500,
  },
  flowArrow: {
    fontSize: '2rem',
    color: '#6366f1',
    fontWeight: 700,
  },
  techHighlights: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem',
    marginTop: '2rem',
  },
  techCard: {
    padding: '1rem',
    backgroundColor: 'rgba(99, 102, 241, 0.05)',
    borderRadius: 12,
    border: '1px solid rgba(99, 102, 241, 0.2)',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  techLabel: {
    fontSize: '0.75rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#6366f1',
  },
  techValue: {
    fontSize: '0.9rem',
    color: '#374151',
    fontWeight: 500,
  },
  footerNote: {
    textAlign: 'center',
    marginTop: '2rem',
    color: '#6b7280',
  },
};
