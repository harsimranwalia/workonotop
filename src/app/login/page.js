'use client';

import Link from 'next/link';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, Lock, Eye, EyeOff, ArrowRight, User, AlertTriangle, ShieldCheck, Zap, BadgeCheck } from 'lucide-react';
import { useAuth } from 'src/context/AuthContext';
import Header from 'src/components/Header';
import Footer from 'src/components/Footer';

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/';
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Scroll to top on mount
    window.scrollTo(0, 0);

    const initGoogle = () => {
      const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
      if (typeof window !== 'undefined' && window.google && clientId) {
        window.google.accounts.id.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          callback: async (response) => {
            setLoading(true);
            try {
              const res = await fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: response.credential, role: 'user' })
              });
              const data = await res.json();
              if (data.success) {
                login(data.user, 'customer');
                router.push(redirectPath);
              } else {
                setError(data.message || 'Google login failed');
              }
            } catch (err) {
              setError('Failed to login with Google');
            } finally {
              setLoading(false);
            }
          }
        });

        const container = document.getElementById('google-button-container');
        if (container) {
          window.google.accounts.id.renderButton(container, {
            theme: "outline",
            size: "large",
            width: Math.max(200, Math.min(400, container.offsetWidth || 340)),
            text: "continue_with",
            shape: "rectangular"
          });
        }
      }
    };

    // Give it a small delay to ensure script is loaded
    const timer = setTimeout(initGoogle, 500);
    return () => clearTimeout(timer);
  }, [login, router, redirectPath]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();

      if (data.success) {
        login(data.user, 'customer');
        router.push(redirectPath);
      } else {
        setError(data.message || 'Invalid email or password');
      }
    } catch (err) {
      setError('Login failed. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md relative z-10 py-10 lg:py-0">
      {/* Mobile-only Header */}
      <div className="lg:hidden mb-8 text-center animate-fadeIn">
        <p className="text-brand-600 font-bold uppercase tracking-[0.16em] text-xs">Customer Account</p>
      </div>

      <div className="mb-8 text-center lg:text-left space-y-2">
        <h2 className="font-display text-3xl sm:text-4xl font-semibold text-ink tracking-[-0.025em] leading-tight">Welcome back.</h2>
        <p className="text-ink-soft text-sm sm:text-base">Enter your details to access your account</p>
      </div>

      {error && (
        <div className="mb-6 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-2xl animate-shake">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
          <p className="text-sm text-red-800 font-semibold">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-ink ml-1">Email Address</label>
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Mail className="h-5 w-5 text-ink-muted group-focus-within:text-brand-600 transition-colors" />
            </div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full pl-12 pr-4 py-3.5 sm:py-4 border border-line rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-ink/40 text-sm sm:text-base bg-white text-ink placeholder:text-ink-muted transition font-medium"
              placeholder="you@example.com"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between ml-1">
            <label className="block text-sm font-semibold text-ink">Password</label>
            <Link href="/forgot-password" title="Reset your password" className="text-xs sm:text-sm text-brand-700 hover:text-brand-800 font-semibold transition-colors">
              Forgot?
            </Link>
          </div>
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
               <Lock className="h-5 w-5 text-ink-muted group-focus-within:text-brand-600 transition-colors" />
            </div>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-12 pr-12 py-3.5 sm:py-4 border border-line rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-ink/40 text-sm sm:text-base bg-white text-ink placeholder:text-ink-muted transition font-medium"
              placeholder="••••••••"
              required
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 pr-4 flex items-center text-ink-muted hover:text-ink transition-colors">
              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3.5 sm:py-4 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-2xl transition disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98] mt-2 text-base sm:text-lg"
        >
          {loading ? (
            <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <>Login <ArrowRight className="h-5 w-5" /></>
          )}
        </button>

        <div className="relative my-8 sm:my-10">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-line"></div>
          </div>
          <div className="relative flex justify-center text-[10px] sm:text-xs uppercase">
            <span className="bg-white px-4 text-ink-muted font-bold tracking-[0.16em] leading-none">Or continue with</span>
          </div>
        </div>

        <div className="flex justify-center w-full">
          <div id="google-button-container" className="w-full min-h-[44px] flex justify-center" />
        </div>
      </form>

      <div className="mt-10 mb-8 text-center space-y-6 sm:space-y-8">
        <p className="text-ink-soft text-sm sm:text-base">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="text-ink font-bold underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
            Sign up now
          </Link>
        </p>

        <div className="pt-8 border-t border-line">
          <Link href="/provider/login" className="flex items-center justify-center gap-2 text-xs sm:text-sm text-ink-soft hover:text-ink font-semibold transition">
             <User className="h-4 w-4" /> Are you a Professional? <span className="text-brand-700">Pro Login here</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <>
      <Header />
      <div className="w-full max-w-[100vw] min-h-screen bg-white font-sans antialiased text-ink flex overflow-x-hidden">
        {/* Left panel - branding (Hidden on mobile) */}
        <div className="hidden lg:flex flex-col justify-center w-2/5 bg-brand-900 p-12 text-white relative overflow-hidden">
          <img src="/images/services/regular-house-cleaning.jpg" alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-t from-brand-950 via-brand-900/85 to-brand-900/60" aria-hidden="true" />

          {/* Background decoration */}
          {/* <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32 blur-3xl"></div>
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 rounded-full -ml-32 -mb-32 blur-3xl"></div> */}

          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-12">
              <span className="text-xs font-bold tracking-[0.16em] uppercase text-brand-200">Customer Login</span>
            </div>
            <div className="space-y-8">
               <h2 className="font-display text-4xl font-semibold tracking-[-0.025em] leading-[1.1]">Expert services at<br />your doorstep.</h2>
               <div className="space-y-6">
                {[
                  { icon: ShieldCheck, title: 'Trusted Professionals', desc: 'Every pro is verified and background-checked' },
                  { icon: Zap, title: 'Fast Booking', desc: 'Secure your appointment in under 2 minutes' },
                  { icon: BadgeCheck, title: 'Quality Guarantee', desc: 'Your satisfaction is our top priority' },
                ].map((f) => (
                  <div key={f.title} className="flex gap-4 items-start group">
                    <span className="h-11 w-11 shrink-0 rounded-2xl bg-white/10 text-brand-200 flex items-center justify-center"><f.icon className="h-5 w-5" aria-hidden="true" /></span>
                    <div>
                      <p className="font-semibold text-white text-lg">{f.title}</p>
                      <p className="text-white/75 text-sm leading-relaxed">{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-12">
              <p className="text-white/75 text-sm leading-relaxed">Join thousands of satisfied customers who rely on Workonotop for all their home service needs.</p>
            </div>
          </div>
        </div>

        {/* Right panel - form */}
        <div className="flex-1 w-full max-w-[100vw] flex flex-col items-center justify-center py-12 px-4 sm:px-8 md:px-12 lg:px-20 relative">
          {/* Background decorations for mobile only */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 lg:hidden">
            <div className="absolute top-0 right-0 translate-x-1/3 -translate-y-1/3 w-64 h-64 bg-brand-50 rounded-full blur-3xl"></div>
            <div className="absolute bottom-0 left-0 -translate-x-1/3 translate-y-1/3 w-64 h-64 bg-paper-deep rounded-full blur-3xl"></div>
          </div>

          <Suspense fallback={<div className="animate-pulse flex flex-col items-center justify-center w-full min-h-[50vh]"><div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mb-4"></div><p className="text-ink-soft">Loading...</p></div>}>
            <LoginFormContent />
          </Suspense>
        </div>
      </div>
      <Footer />

      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        .animate-fadeIn { animation: fadeIn 0.5s ease-out forwards; }
        .animate-shake { animation: shake 0.4s ease-in-out; }
      `}</style>
    </>
  );
}
