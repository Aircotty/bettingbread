import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { usePageTitle } from '../hooks/usePageTitle';
import { 
  Terminal,
  LogOut,
  ChevronRight,
  ArrowLeft,
  Users,
  Box,
  LayoutDashboard
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import PriceTicker from '../components/PriceTicker';
import Footer from '../components/Footer';

export default function Admin() {
  usePageTitle('Admin Dashboard');
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const canvasRef = useRef(null);
  const [stats, setStats] = useState({ revenue: 0, tiers: [], activity: [] });
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Particle Effect Logic
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    const particles = Array.from({ length: 30 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      size: Math.random() * 1.5 + 0.5,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(247, 157, 0, 0.12)';
      ctx.strokeStyle = 'rgba(247, 157, 0, 0.03)';

      particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
          if (dist < 180) {
            ctx.lineWidth = 0.3;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      });
      animationFrameId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  useEffect(() => {
    const fetchAdminData = async () => {
      try {
        const [statsRes, membersRes] = await Promise.all([
          api.get('/api/admin/stats'),
          api.get('/api/admin/members')
        ]);
        setStats(statsRes.data);
        setMembers(membersRes.data);
      } catch (err) {
        console.error('Admin Fetch Error:', err);
        setError(err.response?.data?.error || 'Failed to authorize admin access');
      } finally {
        setLoading(false);
      }
    };
    fetchAdminData();
  }, []);

  const filteredMembers = members.filter(m => 
    m.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.discord_id?.includes(searchTerm)
  );

  // Derived Stats
  const activeTrials = members.filter(m => m.tier === 'free_access').length;
  
  // MRR Calculation (Estimated)
  const weeklyCount = stats.tiers.find(t => t.tier === 'weekly')?.count || 0;
  const monthlyCount = stats.tiers.find(t => t.tier === 'pro_monthly')?.count || 0;
  const mrr = (weeklyCount * 10 * 4.33) + (monthlyCount * 99); // Normalized via average weeks/month

  const handleExport = () => {
    try {
      const csvContent = "data:text/csv;charset=utf-8," 
        + ["User,Subscription,Status,Expiry"].join(",") + "\n"
        + members.map(m => {
          const s = m.tier === 'free_trial' ? 'Trial' : m.tier === 'pro_monthly' ? 'Monthly' : m.tier === 'weekly' ? 'Weekly' : m.tier === 'lifetime' ? 'Lifetime' : 'None';
          return `${m.username},${s},${m.status},${m.expiry_date}`;
        }).join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `bettingbread_members_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error("Export Failed:", e);
    }
  };

  const handleRevoke = async (discordId, username) => {
    if (window.confirm(`Are you sure you want to completely revoke ${username}'s membership and remove their Discord access?`)) {
      try {
        await api.post(`/api/admin/members/${discordId}/revoke`);
        // Refresh the member data
        const [statsRes, membersRes] = await Promise.all([
          api.get('/api/admin/stats'),
          api.get('/api/admin/members')
        ]);
        setStats(statsRes.data);
        setMembers(membersRes.data);
      } catch (err) {
        console.error("Revoke failed:", err);
        alert("Failed to revoke membership. Please check console.");
      }
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bbg text-center py-32 px-6">
        <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none opacity-40" />
        <div className="relative w-24 h-24 mb-10">
          <div className="absolute inset-0 rounded-xl border-2 border-orange/10 rotate-45"></div>
          <div className="absolute inset-0 rounded-xl border-2 border-orange border-t-transparent animate-spin rotate-45"></div>
          <div className="absolute inset-0 flex items-center justify-center text-orange text-3xl font-brand">🍞</div>
        </div>
        <h2 className="font-brand text-3xl text-tx tracking-[0.3em] uppercase mb-3">Initializing Vault</h2>
        <p className="text-tx/60 font-display text-[10px] uppercase tracking-[5px]">Establishing Neural Link</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bbg text-center py-32 px-6">
        <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none opacity-40" />
        <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-6 border border-red-500/20">
          <Terminal size={40} className="text-red-500 animate-pulse" />
        </div>
        <h2 className="font-brand text-2xl text-tx tracking-widest uppercase mb-2">Access Denied</h2>
        <p className="text-red-400 font-display text-[10px] uppercase tracking-[4px] max-w-xs">{error}</p>
        <button onClick={() => navigate('/dashboard')} className="mt-8 px-8 py-3 bg-white/5 border border-white/10 text-tx font-display text-[10px] uppercase tracking-[3px] hover:bg-white/10 transition-colors">
          Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="relative bg-bbg text-tx font-body min-h-screen flex flex-col break-words overflow-x-hidden">
      <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none opacity-40 z-0" />
      
      {/* Upper Logic Bar */}
      <div className="fixed top-0 left-0 right-0 z-[10000] h-[46px] bg-bbg-surface border-b border-br flex items-center overflow-hidden w-full">
        <div className="font-display font-black text-[10px] tracking-[3px] uppercase text-white bg-orange h-full px-[24px] pl-[20px] pr-[32px] flex items-center shrink-0 z-20" style={{ clipPath: 'polygon(0 0, 100% 0, calc(100% - 12px) 100%, 0 100%)' }}>
          <div className="w-[7px] h-[7px] rounded-full bg-green-cash mr-2 animate-pulse"></div>LIVE
        </div>
        <PriceTicker />
      </div>

      <nav className="fixed top-[46px] left-0 right-0 z-50 flex justify-center h-20 bg-bbg/95 backdrop-blur-xl border-b border-br w-full">
        <div className="w-full max-w-[1400px] px-6 md:px-10 flex items-center justify-between">
          <div onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-90 transition-opacity cursor-pointer">
            <div className="w-[20px] h-[20px] rounded-full overflow-hidden border border-orange">
              <img src="/bettingBread-logo.jpg" alt="BettingBread" className="w-full h-full object-cover" />
            </div>
            <span className="font-brand text-sm tracking-[2px] uppercase">
              <span className="text-green-cash">BETTING</span> <span className="text-orange">BREAD</span>
            </span>
          </div>
          <div className="flex items-center gap-6">
            <button onClick={signOut} className="bg-orange/10 border border-orange/20 text-orange font-display font-bold text-[10px] uppercase tracking-[3px] px-6 py-2.5 rounded shadow-sm hover:bg-orange/20 transition-all flex items-center gap-2">
              <LogOut size={16} /> 
              <span>Exit Vault</span>
            </button>
          </div>
        </div>
      </nav>

      <main className="pt-32 px-6 md:px-10 pb-20 max-w-[1400px] mx-auto relative z-10 flex-grow">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 mb-12 animate-fade-down">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="px-2 py-0.5 bg-orange/10 border border-orange/20 text-orange font-bold text-[8px] uppercase tracking-[3px] rounded">Administrator Mode</span>
            </div>
            <h2 className="text-4xl md:text-5xl font-brand tracking-[2px] uppercase leading-none text-white">Administrator</h2>
            <p className="text-tx/60 font-display font-bold text-xs md:text-sm uppercase tracking-[0.3em] mt-3">Real-time financial telemetry and member oversight</p>
          </div>
          <button onClick={handleExport} className="bg-bbg-surface2 hover:bg-bbg-surface text-tx font-display font-bold text-[10px] uppercase tracking-widest px-8 py-4 rounded-lg flex items-center gap-3 border border-white/5 transition-all active:scale-95 shadow-2xl whitespace-nowrap group">
            <span className="material-symbols-outlined text-lg group-hover:animate-bounce">download</span>
            Export Intelligence
          </button>
        </div>

        {/* Revenue Overview: Bento Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-16 animate-fade-up">
          {/* Total Revenue */}
          <div className="surface-container p-8 rounded-xl border-l-[6px] border-orange relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
              <span className="material-symbols-outlined text-7xl">payments</span>
            </div>
            <p className="text-tx/60 font-display font-bold text-[10px] uppercase tracking-widest mb-3">Total Revenue</p>
            <h3 className="text-4xl font-brand tracking-[1px] text-tx">${stats.revenue?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h3>
            <div className="flex items-center gap-2 mt-6">
              <span className="text-green-cash text-[10px] font-bold bg-green-cash/10 px-2 py-0.5 rounded">+12.4%</span>
              <p className="text-[10px] text-tx/70 font-display font-bold uppercase tracking-[2px]">Verified Ledger</p>
            </div>
            <div className="mt-8 h-1 w-full bg-white/5 rounded-full overflow-hidden">
              <div className="h-full honey-gradient w-[84%]" />
            </div>
          </div>

          {/* MRR */}
          <div className="surface-container p-8 rounded-xl border-l-[6px] border-green-cash relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
              <span className="material-symbols-outlined text-7xl">trending_up</span>
            </div>
            <p className="text-tx/60 font-display font-bold text-[10px] uppercase tracking-widest mb-3">Monthly Recurring (MRR)</p>
            <h3 className="text-4xl font-brand tracking-[1px] text-tx">${mrr.toLocaleString(undefined, { maximumFractionDigits: 0 })}</h3>
            <div className="flex items-center gap-2 mt-6">
              <span className="text-green-cash text-[10px] font-bold bg-green-cash/10 px-2 py-0.5 rounded">High Growth</span>
              <p className="text-[10px] text-tx/70 font-display font-bold uppercase tracking-[2px]">Estimated Capacity</p>
            </div>
            <div className="mt-6 flex items-end gap-1.5 h-10">
              <div className="w-3 bg-white/5 h-3 rounded-t-sm" />
              <div className="w-3 bg-white/10 h-6 rounded-t-sm" />
              <div className="w-3 bg-green-cash/40 h-8 rounded-t-sm" />
              <div className="w-3 bg-green-cash h-10 rounded-t-sm" />
            </div>
          </div>

          {/* Active Trials */}
          <div className="surface-container p-8 rounded-xl relative overflow-hidden group border-l-[6px] border-[#3B82F6]/30">
            <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity text-blue-400">
               <span className="material-symbols-outlined text-7xl">bolt</span>
            </div>
            <p className="text-tx/60 font-display font-bold text-[10px] uppercase tracking-widest mb-3">Active Trials</p>
            <h3 className="text-4xl font-brand tracking-[1px] text-tx">{activeTrials}</h3>
            <div className="flex items-center gap-2 mt-6 text-orange">
              <span className="material-symbols-outlined text-base">group_add</span>
              <p className="text-[10px] font-display font-bold uppercase tracking-[2px]">Onboarding Peak</p>
            </div>
            <div className="absolute -bottom-6 -right-6 w-32 h-32 honey-gradient opacity-10 rounded-full blur-3xl animate-pulse" />
          </div>

          {/* Member Density */}
          <div className="surface-container p-8 rounded-xl relative overflow-hidden border-l-[6px] border-orange/40 group">
             <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
               <span className="material-symbols-outlined text-7xl">shield</span>
            </div>
            <p className="text-tx/60 font-display font-bold text-[10px] uppercase tracking-widest mb-3">Member Density</p>
            <h3 className="text-4xl font-brand tracking-[1px] text-tx">{members.length}</h3>
            <div className="flex items-center gap-2 mt-6 text-green-cash">
              <span className="material-symbols-outlined text-base">verified</span>
              <p className="text-[10px] font-display font-bold uppercase tracking-[2px]">Vault Secured</p>
            </div>
          </div>
        </div>

        {/* Main Grid: Table + Activity */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
          {/* Member Management Table */}
          <div className="xl:col-span-2 surface-container rounded-xl overflow-hidden">
            <div className="px-8 py-8 border-b border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-white/[0.02]">
              <div className="flex items-center gap-4">
                <div className="w-1.5 h-[32px] bg-orange"></div>
                <h4 className="font-brand text-3xl text-tx uppercase tracking-[1px] leading-none">
                  Members
                </h4>
              </div>
              <div className="flex items-center gap-4 w-full md:w-auto">
                <div className="relative flex-1 md:w-80">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-tx/30 text-lg">search</span>
                  <input 
                    type="text" 
                    placeholder="Search Directory..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-bbg border border-white/10 px-12 py-3 rounded text-[10px] text-tx font-display font-bold uppercase tracking-[3px] focus:outline-none focus:border-orange/30 transition-all placeholder:text-tx/10"
                  />
                </div>
                <span className="font-display font-bold text-[10px] text-green-cash bg-green-cash/10 px-4 py-2 rounded border border-green-cash/20 uppercase tracking-[2px] shrink-0 text-center">{members.length} Total</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left font-body min-w-[700px]">
                <thead>
                  <tr className="bg-bbg/40 text-tx/60 font-display font-bold text-[10px] uppercase tracking-[4px] border-b border-white/5">
                    <th className="px-8 py-6">Member Profile</th>
                    <th className="px-8 py-6">Subscription</th>
                    <th className="px-8 py-6">Availability</th>
                    <th className="px-8 py-6">Expiry</th>
                    <th className="px-8 py-6 text-right">Permissions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredMembers.map((m, idx) => (
                    <tr key={idx} className="hover:bg-white/[0.01] transition-all group">
                      <td className="px-8 py-8">
                        <div className="flex items-center gap-4">
                          {m.avatar ? (
                            <img src={m.avatar} className="w-10 h-10 rounded-full border border-white/10 opacity-80 group-hover:opacity-100 transition-opacity" alt="" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-orange/5 border border-orange/20 flex items-center justify-center text-orange text-sm font-brand">{m.username?.[0]?.toUpperCase()}</div>
                          )}
                          <div className="flex flex-col gap-0.5">
                            <span className="font-brand text-lg text-tx uppercase tracking-tight leading-none group-hover:text-orange transition-colors">{m.username}</span>
                            <span className="text-[9px] text-tx/30 uppercase tracking-[2px] font-bold">{m.discord_id}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-8">
                        <span className={`px-3 py-1 rounded text-[9px] font-bold uppercase tracking-[2px] ${m.tier === 'lifetime' ? 'bg-orange/10 text-orange' : 'bg-white/5 text-tx/60'}`}>
                          {m.tier === 'free_trial' ? 'Trial' : m.tier === 'pro_monthly' ? 'Monthly' : m.tier === 'weekly' ? 'Weekly' : m.tier === 'lifetime' ? 'Lifetime' : 'None'}
                        </span>
                      </td>
                      <td className="px-8 py-8">
                        <span className={`flex items-center gap-2 text-[9px] font-bold uppercase tracking-[2px] ${m.status === 'active' ? 'text-green-cash' : 'text-tx/70'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${m.status === 'active' ? 'bg-green-cash animate-pulse shadow-[0_0_8px_rgba(85,204,112,0.4)]' : 'bg-tx/10'}`} />
                          {m.status || 'Offline'}
                        </span>
                      </td>
                      <td className="px-8 py-8 text-tx/60 font-display text-[10px] uppercase tracking-[2px]">
                        {m.expiry_date ? new Date(m.expiry_date).toLocaleDateString() : (m.tier === 'lifetime' ? 'PERPETUAL' : 'N/A')}
                      </td>
                      <td className="px-8 py-8 text-right space-x-3 whitespace-nowrap">
                        <button className="p-2 rounded bg-white/5 text-tx/30 hover:text-green-cash hover:bg-green-cash/10 transition-all shadow-sm" title="View Profile">
                          <span className="material-symbols-outlined text-base">visibility</span>
                        </button>
                        {m.status === 'active' && m.tier !== 'lifetime' && (
                          <button 
                            onClick={() => handleRevoke(m.discord_id, m.username)}
                            className="p-2 rounded bg-white/5 text-tx/30 hover:text-red-500 hover:bg-red-500/10 transition-all shadow-sm"
                            title="Revoke Access"
                          >
                            <span className="material-symbols-outlined text-base">person_remove</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredMembers.length === 0 && (
                    <tr>
                      <td colSpan="5" className="px-8 py-32 text-center text-tx/70 font-display font-bold uppercase tracking-[5px]">No matching records found in vault</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-8 border-t border-white/5 flex justify-center bg-white/[0.01]">
              <button className="text-[10px] font-display font-black uppercase tracking-[5px] text-tx/70 hover:text-orange transition-colors">Scan Next Page Records</button>
            </div>
          </div>

          {/* Activity Log */}
          <div className="surface-container rounded-xl flex flex-col min-h-[600px]">
            <div className="px-8 py-8 border-b border-white/5 bg-white/[0.02]">
              <h4 className="font-brand text-3xl text-tx flex items-center gap-3 uppercase tracking-[1px] leading-none">
                <span className="material-symbols-outlined text-green-cash text-2xl font-bold">history</span>
                Latest activity
              </h4>
            </div>
            <div className="flex-1 overflow-y-auto p-8 space-y-10">
              {stats.activity?.length > 0 ? stats.activity.map((act, idx) => (
                <div key={idx} className="relative pl-8 border-l border-white/10 pb-2">
                  <div className={`absolute -left-[5px] top-0 w-2.5 h-2.5 rounded-full ${
                    act.event_type === 'signup' ? 'bg-blue-400' : 
                    act.event_type === 'purchase' ? 'bg-green-cash' : 
                    act.event_type === 'free_trial' ? 'bg-purple-500' :
                    act.event_type === 'revoked' ? 'bg-red-500' :
                    'bg-orange'
                  }`} />
                  <p className={`text-[10px] font-display font-black uppercase tracking-[3px] mb-2 ${
                    act.event_type === 'signup' ? 'text-blue-400' : 
                    act.event_type === 'purchase' ? 'text-green-cash' : 
                    act.event_type === 'free_trial' ? 'text-purple-500' :
                    act.event_type === 'revoked' ? 'text-red-500' :
                    'text-orange'
                  }`}>
                    {act.event_type === 'signup' ? 'New Registration' : 
                     act.event_type === 'purchase' ? 'Access Intake' : 
                     act.event_type === 'free_trial' ? 'Trial Activated' :
                     act.event_type === 'revoked' ? 'Access Revoked' :
                     act.event_type === 'expiration' ? 'Time Expired' :
                     'Protocol Event'}
                  </p>
                  <p className="text-sm text-tx/80 leading-relaxed font-medium">
                    {act.event_type === 'signup' && (
                      <>{act.username} signed up on the site</>
                    )}
                    {act.event_type === 'purchase' && (
                      <>{act.username} bought a <span className="text-tx font-bold uppercase">{act.tier === 'free_trial' ? 'Trial' : act.tier === 'pro_monthly' ? 'Monthly' : act.tier === 'weekly' ? 'Weekly' : act.tier === 'lifetime' ? 'Lifetime' : act.tier?.replace('_', ' ')}</span> subscription</>
                    )}
                    {act.event_type === 'free_trial' && (
                      <>{act.username} activated a free trial pass</>
                    )}
                    {act.event_type === 'expiration' && (
                      <>{act.username} membership expired</>
                    )}
                    {act.event_type === 'revoked' && (
                      <>{act.username} had their access manually revoked by admin</>
                    )}
                  </p>
                  <p className="text-[9px] text-tx/70 font-display mt-3 uppercase tracking-[3px] font-bold">
                    {new Date(act.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} • System Log
                  </p>
                </div>
              )) : (
                <div className="flex flex-col items-center justify-center h-full opacity-10">
                   <span className="material-symbols-outlined text-6xl mb-4">history</span>
                   <p className="text-[10px] font-display font-bold uppercase tracking-[4px]">Empty Audit Stream</p>
                </div>
              )}
            </div>
            <div className="p-8 border-t border-white/5 bg-bbg/50 rounded-b-xl mt-auto">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-display font-black text-tx/30 uppercase tracking-[3px]">Protocol History</span>
                <span className="material-symbols-outlined text-tx/30 cursor-pointer hover:text-orange transition-colors">filter_list</span>
              </div>
            </div>
          </div>
        </div>

      </main>

      <Footer className="z-[10001] mt-auto" />
    </div>
  );
}
