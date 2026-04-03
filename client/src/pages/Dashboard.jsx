import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { LogOut, Crown, CreditCard, ArrowRight, ShieldCheck, Zap } from 'lucide-react';
import { usePageTitle } from '../hooks/usePageTitle';
import PriceTicker from '../components/PriceTicker';
import Footer from '../components/Footer';

function CountdownTimer({ expiryDate }) {
  const [timeLeft, setTimeLeft] = useState({ h: '00', m: '00', s: '00' });

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date();
      const expiry = new Date(expiryDate);
      const difference = expiry - now;

      if (difference <= 0) return { h: '00', m: '00', s: '00', expired: true };

      const hours = Math.floor((difference / (1000 * 60 * 60)));
      const minutes = Math.floor((difference / 1000 / 60) % 60);
      const seconds = Math.floor((difference / 1000) % 60);

      return {
        h: hours.toString().padStart(2, '0'),
        m: minutes.toString().padStart(2, '0'),
        s: seconds.toString().padStart(2, '0')
      };
    };

    const timer = setInterval(() => setTimeLeft(calculateTimeLeft()), 1000);
    setTimeLeft(calculateTimeLeft());
    return () => clearInterval(timer);
  }, [expiryDate]);

    <div className="flex flex-col items-center w-full max-w-[280px] mx-auto">
      <span className="text-[10px] font-black uppercase tracking-[4px] text-orange mb-3 opacity-100">Time Remaining</span>
      <div className="flex justify-center gap-3 font-brand text-3xl md:text-4xl text-green-cash w-full">
        <div className="bg-bbg-surface2 border border-br px-3 py-2 shadow-inner">{timeLeft.h}<span className="text-[10px] font-display ml-1 text-tx opacity-60 uppercase font-bold">h</span></div>
        <div className="bg-bbg-surface2 border border-br px-3 py-2 shadow-inner">{timeLeft.m}<span className="text-[10px] font-display ml-1 text-tx opacity-60 uppercase font-bold">m</span></div>
        <div className="bg-bbg-surface2 border border-br px-3 py-2 shadow-inner">{timeLeft.s}<span className="text-[10px] font-display ml-1 text-tx opacity-60 uppercase font-bold">s</span></div>
      </div>
    </div>
}

export default function Dashboard() {
  usePageTitle('Dashboard');
  const canvasRef = useRef(null);
  const { user, signOut, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [membership, setMembership] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W, H, particles = [];
    let animationFrameId;

    const resize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    class Particle {
      constructor() {
        this.x = Math.random() * W;
        this.y = Math.random() * H;
        this.vx = (Math.random() - 0.5) * 0.18;
        this.vy = (Math.random() - 0.5) * 0.18;
        this.r = Math.random() * 1.2 + 0.4;
        this.isOrange = Math.random() < 0.35;
      }
      update() {
        this.x += this.vx;
        this.y += this.vy;
        if (this.x < 0 || this.x > W) this.vx *= -1;
        if (this.y < 0 || this.y > H) this.vy *= -1;
      }
      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fillStyle = this.isOrange ? 'rgba(242, 100, 25, 0.4)' : 'rgba(45, 84, 38, 0.3)';
        ctx.fill();
      }
    }

    for (let i = 0; i < 80; i++) particles.push(new Particle());

    const drawLines = () => {
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 100) {
            const a = (1 - d / 120) * 0.12;
            const isO = particles[i].isOrange || particles[j].isOrange;
            ctx.strokeStyle = isO ? `rgba(242, 100, 25, ${a})` : `rgba(45, 84, 38, ${a * 1.4})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }
    };

    const loop = () => {
      ctx.clearRect(0, 0, W, H);
      drawLines();
      particles.forEach(p => { p.update(); p.draw(); });
      animationFrameId = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  useEffect(() => {
    if (user?.isAdmin) {
      navigate('/admin');
      return;
    }
    
    const fetchDashboard = async () => {
      try {
        const { data } = await api.get('/api/dashboard/profile');
        setMembership(data.membership);
        setTransactions(data.transactions || []);
      } catch (err) {
        console.error('Error fetching dashboard info:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, [user]);

  const handleUpgrade = async (newTier) => {
    try {
      const { data } = await api.post('/api/payment/create-checkout', { tier: newTier });
      window.location.href = data.url;
    } catch (err) {
      alert('Error creating checkout session');
    }
  };

  const handleCancel = async () => {
    if (!confirm('Cancel your subscription?')) return;
    try {
      await api.post('/api/payment/cancel');
      window.location.reload();
    } catch (err) {
      alert('Error cancelling subscription');
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bbg text-center py-32">
        <div className="relative w-20 h-20 mb-8">
          <div className="absolute inset-0 rounded-full border-4 border-orange/20"></div>
          <div className="absolute inset-0 rounded-full border-4 border-orange border-t-transparent animate-spin"></div>
          <div className="absolute inset-0 flex items-center justify-center font-brand text-orange text-xl">BB</div>
        </div>
        <h2 className="text-3xl font-black font-headline text-[#F79D00] tracking-tighter uppercase mb-1">Command Center</h2>
        <p className="text-[#E5E2E1]/40 font-label text-sm uppercase tracking-widest">Real-time data and member oversight</p>
      </div>
    );
  }

  return (
    <div className="relative bg-bbg text-tx font-body min-h-screen break-words overflow-x-hidden">
      <canvas ref={canvasRef} className="fixed inset-0 z-0 pointer-events-none opacity-55"></canvas>
      <div className="fixed inset-0 z-[9998] pointer-events-none" style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.035) 3px, rgba(0,0,0,0.035) 4px)' }}></div>

      <div className="fixed top-0 left-0 right-0 z-[10000] h-[46px] bg-bbg-surface border-b border-br flex items-center overflow-hidden w-full">
        <div className="font-display font-black text-[10px] tracking-[3px] uppercase text-white bg-orange h-full px-[24px] pl-[20px] pr-[32px] flex items-center shrink-0 z-20" style={{ clipPath: 'polygon(0 0, 100% 0, calc(100% - 12px) 100%, 0 100%)' }}>
          <div className="w-[7px] h-[7px] rounded-full bg-green-cash mr-2 animate-pulse"></div>LIVE
        </div>
        <PriceTicker />
      </div>

      <nav className="fixed top-[46px] left-0 right-0 z-50 flex items-center justify-center h-20 md:h-[80px] bg-[#050804]/94 backdrop-blur-xl border-b border-br w-full">
        <div className="w-full max-w-[1200px] mx-auto px-6 md:px-8 flex items-center justify-between">
          <div onClick={() => navigate('/')} className="flex items-end gap-2.5 hover:opacity-90 transition-opacity cursor-pointer">
            <div className="w-[22px] h-[22px] rounded-full overflow-hidden border border-orange flex-shrink-0 translate-y-[3px]">
              <img src="/bettingBread-logo.jpg" alt="BettingBread" className="w-full h-full object-cover" />
            </div>
            <span className="font-brand text-base tracking-[2px] text-green-cash whitespace-nowrap leading-none">
              BETTING <span className="text-orange">BREAD</span>
            </span>
          </div>
          <div className="flex items-center gap-6">
            <button onClick={signOut} className="font-display font-black text-[12px] tracking-[2px] uppercase text-white bg-orange/20 border border-orange/40 hover:bg-orange hover:text-white transition-all px-6 py-2.5 clip-path-lbl flex items-center gap-2">
              <LogOut size={14} />
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      <main className="relative z-10 w-full pt-[160px] pb-20">
        <div className="w-full max-w-[1200px] mx-auto px-6 md:px-8">
          
          {/* UNIFIED PROFILE HERO */}
          <div className="mb-12 animate-fade-up">
            <div className="bg-bbg-surface/40 backdrop-blur-xl border border-white/10 relative overflow-hidden ring-1 ring-white/5 shadow-[0_0_50px_rgba(242,100,25,0.05)]">
              <div className="absolute top-0 right-0 p-4 opacity-[0.03]">
                <ShieldCheck size={160} strokeWidth={1} className="text-orange" />
              </div>
              
              <div className="flex flex-col lg:flex-row items-stretch">
                {/* User Info Section */}
                <div className="p-8 md:p-10 flex flex-col md:flex-row items-center gap-8 border-b lg:border-b-0 lg:border-r border-white/5 flex-grow">
                  <div className="relative shrink-0">
                    <img 
                      src={user?.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'} 
                      alt={user?.username} 
                      className="w-28 h-28 md:w-32 md:h-32 rounded-none border border-orange/40 p-1.5 bg-bbg shadow-[0_0_30px_rgba(242,100,25,0.15)] object-cover" 
                    />
                    <div className="absolute -bottom-2 -right-2 bg-green-cash w-8 h-8 flex items-center justify-center border-4 border-bbg">
                      <div className="w-2.5 h-2.5 bg-white animate-pulse"></div>
                    </div>
                  </div>
                  
                  <div className="flex flex-col text-center md:text-left">
                    <div className="flex bg-white/5 border border-white/10 px-3 py-1 mb-3 items-center gap-3 w-fit mx-auto md:mx-0">
                      <div className="w-1.5 h-1.5 bg-green-cash rounded-full animate-pulse"></div>
                      <span className="text-[10px] font-black text-green-cash uppercase tracking-[3px]">Authorized Operator</span>
                    </div>
                    <h2 className="text-4xl md:text-6xl font-brand text-white tracking-tighter uppercase leading-none mb-2">{user?.username}</h2>
                    <span className="text-tx font-display text-[11px] uppercase tracking-[4px] opacity-40">User Node: {user?.discord_id}</span>
                  </div>
                </div>

                {/* Membership Status Section */}
                <div className="p-8 md:p-10 bg-white/[0.02] flex flex-col justify-center min-w-[320px]">
                  <div className="mb-6">
                    <span className="font-display font-black uppercase text-[10px] tracking-[4px] text-orange/60 block mb-2">Access Level</span>
                    <div className="font-brand text-4xl md:text-5xl tracking-tighter text-green-cash uppercase leading-none">
                      {membership?.tier === 'free_trial' ? 'Free Trial' : membership?.tier === 'weekly' ? 'Weekly' : membership?.tier === 'pro_monthly' ? 'Pro Monthly' : membership?.tier === 'lifetime' ? 'Lifetime' : 'No Access'}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
                    <div className={`flex items-center gap-2 font-display text-[10px] font-black tracking-[2px] uppercase bg-black/20 px-3 py-1.5 border border-white/5 ${membership?.status === 'active' ? 'text-green-cash' : (membership ? 'text-red-400' : 'text-tx/40')}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${membership?.status === 'active' ? 'bg-green-cash animate-pulse shadow-[0_0_8px_#40E56C]' : (membership ? 'bg-red-400' : 'bg-tx/20')}`}></div>
                      {membership?.status === 'active' ? 'Active Session' : (membership ? 'Access Expired' : 'New User')}
                    </div>
                    
                    {membership?.expiry_date && membership?.tier !== 'lifetime' && (
                      <div className="text-white/40 text-[10px] font-black tracking-[2px] uppercase">
                        Ends: {new Date(membership.expiry_date).toLocaleDateString()}
                      </div>
                    )}
                  </div>

                  {membership?.tier !== 'lifetime' && membership?.status === 'active' && (
                    <div className="mt-8 pt-6 border-t border-white/5">
                      <CountdownTimer expiryDate={membership.expiry_date} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* PRIMARY PRICING GRID (PAID FOCUS) */}
          {membership?.tier !== 'lifetime' && (
            <div className="mb-20 animate-fade-up">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Weekly Plan */}
                <div className={`surface-container p-8 rounded-xl border border-white/5 flex flex-col justify-between transition-all hover:border-orange/30 group ${membership?.tier === 'weekly' ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div>
                    <div className="flex justify-between items-start mb-6">
                      <span className="text-[10px] font-black uppercase tracking-[3px] text-tx/60">Standard Entry</span>
                      <Zap size={18} className="text-tx/70 group-hover:text-orange transition-colors" />
                    </div>
                    <h3 className="font-brand text-3xl text-white uppercase mb-2">Weekly</h3>
                    <div className="flex items-end gap-1 mb-6">
                      <span className="text-4xl font-brand text-tx">$10</span>
                      <span className="text-[10px] text-tx/30 uppercase font-bold tracking-widest pb-1">/ Week</span>
                    </div>
                    <ul className="space-y-3 mb-10">
                      {['Real-time Alpha', 'Discord Access', 'Weekly Analysis', 'Secure Ticker'].map((f, i) => (
                        <li key={i} className="flex items-center gap-2 text-[11px] text-tx/60 uppercase tracking-wider font-bold">
                          <div className="w-1 h-1 bg-green-cash rounded-full" /> {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <button onClick={() => handleUpgrade('weekly')} className="w-full py-4 bg-white/5 border border-white/10 text-tx font-display font-black text-[11px] uppercase tracking-[3px] hover:bg-white/10 transition-all">
                    Initialize Weekly
                  </button>
                </div>

                {/* Pro Monthly Plan */}
                <div className={`surface-container p-8 rounded-xl border border-white/5 flex flex-col justify-between transition-all hover:border-orange/30 group relative ${membership?.tier === 'pro_monthly' ? 'opacity-50 pointer-events-none' : ''}`}>
                   <div className="absolute top-0 right-0 bg-white/5 text-tx/70 text-[8px] font-black px-3 py-1 uppercase tracking-[2px]">Recurring</div>
                   <div>
                    <div className="flex justify-between items-start mb-6">
                      <span className="text-[10px] font-black uppercase tracking-[3px] text-tx/60">Performance Lead</span>
                      <Crown size={18} className="text-tx/70 group-hover:text-orange transition-colors" />
                    </div>
                    <h3 className="font-brand text-3xl text-white uppercase mb-2">Pro <span className="text-orange">Monthly</span></h3>
                    <div className="flex items-end gap-1 mb-6">
                      <span className="text-4xl font-brand text-white">$99</span>
                      <span className="text-[10px] text-tx/30 uppercase font-bold tracking-widest pb-1">/ Month</span>
                    </div>
                    <ul className="space-y-3 mb-10">
                      {['Priority Alpha', 'Bot Signals', 'Full Historical Data', '24/7 Neural Support'].map((f, i) => (
                        <li key={i} className="flex items-center gap-2 text-[11px] text-tx/60 uppercase tracking-wider font-bold">
                          <div className="w-1 h-1 bg-green-cash rounded-full" /> {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <button onClick={() => handleUpgrade('pro_monthly')} className="w-full py-4 bg-white/5 border border-white/10 text-tx font-display font-black text-[11px] uppercase tracking-[3px] hover:bg-white/10 transition-all">
                    Evolve Access
                  </button>
                </div>

                {/* Lifetime Plan (BEST VALUE) */}
                <div className="surface-container p-8 rounded-xl border-2 border-orange/40 flex flex-col justify-between transition-all hover:border-orange group relative shadow-[0_0_40px_rgba(242,100,25,0.05)] bg-gradient-to-b from-orange/5 to-transparent">
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-orange text-white text-[9px] font-black px-4 py-1.5 uppercase tracking-[3px] shadow-[0_0_20px_rgba(242,100,25,0.4)]">Ultimate Value</div>
                  <div>
                    <div className="flex justify-between items-start mb-6">
                      <span className="text-[10px] font-black uppercase tracking-[3px] text-orange/80">Sovereign Asset</span>
                      <ShieldCheck size={20} className="text-orange" />
                    </div>
                    <h3 className="font-brand text-4xl text-white uppercase mb-2">Lifetime</h3>
                    <div className="flex items-end gap-1 mb-6">
                      <span className="text-5xl font-brand text-white">$299</span>
                      <span className="text-[10px] text-tx/30 uppercase font-bold tracking-widest pb-1">One Time</span>
                    </div>
                    <ul className="space-y-3 mb-10">
                      {['Permanent Access', 'All Future Updates', 'Exclusive VIP Hub', 'Governance Voting'].map((f, i) => (
                        <li key={i} className="flex items-center gap-2 text-[11px] text-white/80 uppercase tracking-wider font-bold">
                          <div className="w-1 h-1 bg-orange rounded-full animate-pulse" /> {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <button onClick={() => handleUpgrade('lifetime')} className="w-full py-5 bg-orange text-white font-display font-black text-[12px] uppercase tracking-[4px] hover:bg-orange-hot transition-all shadow-[0_10px_30px_rgba(242,100,25,0.3)] hover:-translate-y-1">
                    Secure Forever
                  </button>
                </div>

              </div>

              {/* MISSABLE FREE TRIAL CTA */}
              {!membership && !user?.trial_used && (
                <div className="mt-8 flex justify-center">
                  <button 
                    onClick={async () => { try { await api.post('/api/dashboard/trial'); window.location.reload(); } catch (err) { alert(err.response?.data?.error || 'Failed to start trial'); } }}
                    className="text-[10px] font-display font-bold uppercase tracking-[4px] text-tx/70 hover:text-tx transition-colors px-6 py-3 border border-transparent hover:border-white/5 rounded-full"
                  >
                    Still want to try for 3 days? <span className="underline decoration-white/10">Activate Access Pass</span>
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="lg:col-span-2 space-y-8">
              

              {/* TRANSACTIONS */}
              <div className="bg-bbg-surface/20 backdrop-blur-md border border-white/5 p-10 relative overflow-hidden ring-1 ring-white/5">
                <div className="flex items-center gap-3 mb-10 pb-6 border-b border-white/5 relative z-10">
                  <div className="w-1.5 h-[22px] bg-orange/60"></div>
                  <h2 className="font-display font-black text-sm tracking-[4px] text-white uppercase">History</h2>
                </div>
                {transactions.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-display">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-[3px] text-orange border-b border-white/5">
                          <th className="pb-4 font-bold">Tier</th>
                          <th className="pb-4 font-bold">Amount</th>
                          <th className="pb-4 font-bold">Status</th>
                          <th className="pb-4 font-bold text-right">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 font-bold">
                        {transactions.map((t) => (
                          <tr key={t.id} className="text-xs group hover:bg-white/[0.02] transition-colors">
                            <td className="py-5 text-green-cash uppercase tracking-widest">{t.tier.replace('_', ' ')}</td>
                            <td className="py-5 text-green-cash/80">${(t.amount_total / 100).toFixed(2)}</td>
                            <td className="py-5">
                              <span className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-widest border ${t.status === 'complete' ? 'border-green-cash/30 text-green-cash bg-green-cash/5' : 'border-orange/30 text-orange bg-orange/5'}`}>{t.status}</span>
                            </td>
                            <td className="py-5 text-tx text-[10px] text-right opacity-70 capitalize font-bold">{new Date(t.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-tx-muted text-center py-20 opacity-30">No transaction data available</div>
                )}
              </div>
            </div>

          </div>
        </div>
      </main>

      <Footer />

      <style dangerouslySetInnerHTML={{ __html: `
        .clip-path-lbl { clip-path: polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%); }
        .animate-fade-up { animation: fadeUp 0.6s ease backwards; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
      `}} />
    </div>
  );
}