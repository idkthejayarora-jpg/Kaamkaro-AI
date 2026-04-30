import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Eye, EyeOff, Phone, Lock, AlertCircle, User, UserPlus, LogIn } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  // Login fields
  const [phone,    setPhone]    = useState('');
  const [password, setPassword] = useState('');

  // Signup fields
  const [name,     setName]     = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPass,  setRegPass]  = useState('');
  const [confPass, setConfPass] = useState('');

  const [showPass,  setShowPass]  = useState(false);
  const [showPass2, setShowPass2] = useState(false);
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(false);

  const { login, register } = useAuth();
  const navigate = useNavigate();

  const switchMode = (m: typeof mode) => {
    setMode(m); setError('');
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!phone.trim() || !password.trim()) { setError('Please enter your credentials.'); return; }
    setLoading(true);
    try {
      await login(phone.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Invalid credentials. Please try again.');
    } finally { setLoading(false); }
  };

  const handleSignup = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim() || !regPhone.trim() || !regPass) { setError('All fields are required.'); return; }
    if (regPass !== confPass) { setError('Passwords do not match.'); return; }
    if (regPass.length < 4) { setError('Password must be at least 4 characters.'); return; }
    setLoading(true);
    try {
      await register(name.trim(), regPhone.trim(), regPass);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Registration failed. Please try again.');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-dark-500 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-gold/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-gold/5 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gold/3 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gold mb-4 shadow-lg gold-glow">
            <Sparkles size={28} className="text-dark-500" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">
            Kaamkaro <span className="text-gold">AI</span>
          </h1>
          <p className="text-white/40 mt-2 text-sm">Staff Performance Intelligence Platform</p>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 bg-dark-400 border border-dark-50 rounded-xl p-1 mb-6">
          <button
            onClick={() => switchMode('login')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              mode === 'login' ? 'bg-gold text-dark-500' : 'text-white/40 hover:text-white'
            }`}
          >
            <LogIn size={14} /> Sign In
          </button>
          <button
            onClick={() => switchMode('signup')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              mode === 'signup' ? 'bg-gold text-dark-500' : 'text-white/40 hover:text-white'
            }`}
          >
            <UserPlus size={14} /> Create Account
          </button>
        </div>

        {/* Card */}
        <div className="bg-dark-300 border border-dark-50 rounded-2xl p-8 shadow-2xl">
          <div className="mb-6">
            {mode === 'login' ? (
              <>
                <h2 className="text-xl font-semibold text-white">Welcome back</h2>
                <p className="text-white/40 text-sm mt-1">Sign in to continue</p>
              </>
            ) : (
              <>
                <h2 className="text-xl font-semibold text-white">Join the team</h2>
                <p className="text-white/40 text-sm mt-1">Create your staff account</p>
              </>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 mb-5 text-sm animate-fade-in">
              <AlertCircle size={15} className="flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── LOGIN FORM ── */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="label">Phone Number / Username</label>
                <div className="relative">
                  <Phone size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    type="text"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="Enter phone or 'admin'"
                    className="input pl-10"
                    autoComplete="username"
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="input pl-10 pr-10"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(s => !s)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                  >
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 mt-2 flex items-center justify-center gap-2"
              >
                {loading
                  ? <><div className="w-4 h-4 border-2 border-dark-500/30 border-t-dark-500 rounded-full animate-spin" /> Signing in…</>
                  : <><LogIn size={15} /> Sign In</>
                }
              </button>
            </form>
          )}

          {/* ── SIGNUP FORM ── */}
          {mode === 'signup' && (
            <form onSubmit={handleSignup} className="space-y-4">
              <div>
                <label className="label">Full Name</label>
                <div className="relative">
                  <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Your full name"
                    className="input pl-10"
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label className="label">Phone Number</label>
                <div className="relative">
                  <Phone size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    type="text"
                    value={regPhone}
                    onChange={e => setRegPhone(e.target.value)}
                    placeholder="10-digit mobile number"
                    className="input pl-10"
                    autoComplete="username"
                  />
                </div>
              </div>

              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={regPass}
                    onChange={e => setRegPass(e.target.value)}
                    placeholder="At least 4 characters"
                    className="input pl-10 pr-10"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(s => !s)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                  >
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="label">Confirm Password</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    type={showPass2 ? 'text' : 'password'}
                    value={confPass}
                    onChange={e => setConfPass(e.target.value)}
                    placeholder="Repeat your password"
                    className="input pl-10 pr-10"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass2(s => !s)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                  >
                    {showPass2 ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 mt-2 flex items-center justify-center gap-2"
              >
                {loading
                  ? <><div className="w-4 h-4 border-2 border-dark-500/30 border-t-dark-500 rounded-full animate-spin" /> Creating account…</>
                  : <><UserPlus size={15} /> Create Account</>
                }
              </button>

              <p className="text-white/25 text-xs text-center leading-relaxed">
                Your account will be active immediately. An admin can assign you to a team.
              </p>
            </form>
          )}

          <div className="mt-6 pt-5 border-t border-dark-50">
            <p className="text-center text-white/20 text-xs">
              Admin: <span className="text-white/40 font-mono">admin</span> · Staff: use your phone number
            </p>
          </div>
        </div>

        <p className="text-center text-white/20 text-xs mt-6">
          Powered by Kamal AI · Kaamkaro Platform
        </p>
      </div>
    </div>
  );
}
