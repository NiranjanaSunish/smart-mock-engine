import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [contracts, setContracts] = useState([]);
  const [activeContract, setActiveContract] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    fetchContracts();
  }, []);

  const fetchContracts = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/contracts`);
      const data = await res.json();
      setContracts(data);
      if (data.length > 0 && !activeContract) setActiveContract(data[0]);
    } catch (e) {
      console.error(e);
    }
  };

const handleGenerate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/contracts/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });

      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`Server returned non-JSON (${res.status}): ${raw.slice(0, 120)}`);
      }

      if (!res.ok) {
        throw new Error(data.details || data.error || `HTTP ${res.status}`);
      }

      setActiveContract(data);
      setContracts(prev => [data, ...prev.filter(c => c._id !== data._id)]);
      setPrompt('');
    } catch (e) {
      alert(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const testLiveEndpoint = async (contract) => {
    setTestLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/mock/${contract.endpointPath}`, {
        method: contract.method
      });
      const data = await res.json();
      setTestResult({ status: res.status, data });
    } catch (e) {
      setTestResult({ error: 'Request failed to execute' });
    } finally {
      setTestLoading(false);
    }
  };

  const handleDelete = async (id) => {
    await fetch(`${API_BASE}/api/contracts/${id}`, { method: 'DELETE' });
    setContracts(contracts.filter(c => c._id !== id));
    if (activeContract?._id === id) setActiveContract(null);
  };

  const fillSample = (text) => setPrompt(text);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">
            SmartMock AI Engine
          </h1>
          <p className="text-xs text-slate-400">Natural Language to Production-Ready Mock REST Microservices</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => fillSample("E-commerce cart checkout with line items, coupon discount calculation, and shipping tiers")}
            className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded border border-slate-700"
          >
            Sample: Checkout API
          </button>
          <button 
            onClick={() => fillSample("IoT sensor metrics endpoint reporting temperature, battery life, and gateway status every 30 seconds")}
            className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded border border-slate-700"
          >
            Sample: IoT Metrics
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 max-w-7xl mx-auto w-full">
        {/* Left Panel: Prompt & Saved Contracts (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          <form onSubmit={handleGenerate} className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-3">
            <label className="text-sm font-semibold text-slate-300">Describe API Endpoint</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., User authentication endpoint returning JWT tokens and user permissions..."
              className="w-full h-32 bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm focus:outline-none focus:border-cyan-500"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-cyan-600 hover:bg-cyan-500 py-2.5 rounded-lg font-medium text-sm transition disabled:opacity-50"
            >
              {loading ? 'Synthesizing Contract & Mock...' : 'Synthesize REST Endpoint'}
            </button>
          </form>

          {/* Saved Endpoints List */}
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
            <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wider">Active Endpoints</h2>
            <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
              {contracts.length === 0 && <p className="text-xs text-slate-500">No mock endpoints generated yet.</p>}
              {contracts.map(c => (
                <div
                  key={c._id}
                  onClick={() => { setActiveContract(c); setTestResult(null); }}
                  className={`p-3 rounded-lg border cursor-pointer transition flex justify-between items-center ${
                    activeContract?._id === c._id ? 'border-cyan-500 bg-slate-800' : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        c.method === 'GET' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-amber-950 text-amber-400 border border-amber-800'
                      }`}>
                        {c.method}
                      </span>
                      <span className="text-xs font-mono text-slate-300 font-semibold truncate max-w-[150px]">{c.endpointPath}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 truncate max-w-[200px]">{c.title}</p>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDelete(c._id); }}
                    className="text-slate-500 hover:text-rose-400 text-xs px-2"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Panel: Contract Specification & Live Runner (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {activeContract ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
              {/* Endpoint Header Bar */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-100">{activeContract.title}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-mono text-xs text-cyan-400 bg-cyan-950/60 border border-cyan-800/80 px-2 py-0.5 rounded">
                      {activeContract.method} /api/mock/{activeContract.endpointPath}
                    </span>
                    <span className="text-xs text-slate-400">Status: {activeContract.statusCode}</span>
                  </div>
                </div>
                <button
                  onClick={() => testLiveEndpoint(activeContract)}
                  disabled={testLoading}
                  className="bg-indigo-600 hover:bg-indigo-500 text-xs px-4 py-2 rounded-lg font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
                >
                  {testLoading ? 'Calling Endpoint...' : '⚡ Hit Live Mock'}
                </button>
              </div>

              {/* Live Execution Output (Simulated Postman) */}
              {testResult && (
                <div className="bg-slate-950 border border-indigo-900/60 p-4 rounded-lg space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-indigo-400 font-mono font-semibold">Live Server Response</span>
                    <span className="bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded">
                      HTTP {testResult.status} OK
                    </span>
                  </div>
                  <pre className="text-xs text-emerald-300 font-mono bg-slate-900 p-3 rounded max-h-48 overflow-y-auto">
                    {JSON.stringify(testResult.data, null, 2)}
                  </pre>
                </div>
              )}

              {/* JSON Mock Data Specification */}
              <div>
                <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-2">Persisted Mock Response (MongoDB)</h3>
                <pre className="text-xs font-mono bg-slate-950 border border-slate-800 p-4 rounded-lg max-h-80 overflow-y-auto text-cyan-300">
                  {JSON.stringify(activeContract.mockResponse, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="h-full min-h-[400px] border border-dashed border-slate-800 rounded-xl flex items-center justify-center text-slate-500 text-sm">
              Synthesize a new API requirement or select an active endpoint from the left.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}