'use client';

import Link from 'next/link';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, Lock, Eye, EyeOff, ArrowRight, User, Phone, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useAuth } from 'src/context/AuthContext';
import Header from 'src/components/Header';
import Footer from 'src/components/Footer';

function SignupFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/';
  const { login } = useAuth();

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: ''
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
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
                setError(data.message || 'Google signup failed');
              }
            } catch (err) {
              setError('Failed to signup with Google');
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
            text: "signup_with",
            shape: "rectangular"
          });
        }
      }
    };
    const timer = setTimeout(initGoogle, 500);
    return () => clearTimeout(timer);
  }, [login, router, redirectPath]);

  const validate = () => {
    const errs = {};
    if (!formData.firstName) errs.firstName = 'Required';
    if (!formData.lastName) errs.lastName = 'Required';
    if (!formData.email || !/\S+@\S+\.\S+/.test(formData.email)) errs.email = 'Valid email required';
    if (!formData.password || formData.password.length < 8) errs.password = 'Min 8 characters';
    if (formData.password !== formData.confirmPassword) errs.confirmPassword = 'Passwords do not match';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: formData.firstName,
          last_name: formData.lastName,
          email: formData.email,
          phone: formData.phone,
          password: formData.password
        })
      });
      const data = await res.json();

      if (data.success) {
        login(data.user, 'customer');
        router.push(redirectPath);
      } else {
        setError(data.message || 'Signup failed');
      }
    } catch (err) {
      setError('Connection failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-lg relative z-10 py-10 lg:py-0">
      {/* <div className="lg:hidden mb-8 text-center">
        <Link href="/">
          <h1 className="text-3xl font-black text-green-700 tracking-tight italic">WorkOnTap</h1>
        </Link>
        <p className="text-brand-600 font-bold uppercase tracking-[0.16em] text-xs">Customer Registration</p>
      </div> */}

      <div className="mb-8 text-center lg:text-left space-y-2">
        <h2 className="font-display text-3xl sm:text-4xl font-semibold text-ink tracking-[-0.025em] leading-tight">Join WorkOnTap.</h2>
        <p className="text-ink-soft">Create your account to book verified professionals</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl animate-shake flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
          <p className="text-sm text-red-800 font-semibold">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-ink ml-1">First Name</label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <User className="h-5 w-5 text-ink-muted group-focus-within:text-brand-600 transition-colors" />
              </div>
              <input
                type="text"
                className={`w-full pl-12 pr-4 py-3.5 sm:py-4 border rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-ink/40 text-sm sm:text-base bg-white text-ink placeholder:text-ink-muted transition font-medium ${fieldErrors.firstName ? 'border-red-300' : 'border-line'}`}
                placeholder="John"
                value={formData.firstName}
                onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-ink ml-1">Last Name</label>
            <input
              type="text"
              className={`w-full px-4 py-3.5 sm:py-4 border rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-ink/40 text-sm sm:text-base bg-white text-ink placeholder:text-ink-muted transition font-medium ${fieldErrors.lastName ? 'border-red-300' : 'border-line'}`}
              placeholder="Doe"
              value={formData.lastName}
              onChange={e => setFormData({ ...formData, lastName: e.target.value })}
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-ink ml-1">Email Address</label>
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Mail className="h-5 w-5 text-ink-muted group-focus-within:text-brand-600 transition-colors" />
            </div>
            <input
              type="email"
              className={`w-full pl-12 pr-4 py-3.5 sm:py-4 border rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-ink/40 text-sm sm:text-base bg-white text-ink placeholder:text-ink-muted transition font-medium ${fieldErrors.email ? 'border-red-300' : 'border-line'}`}
              placeholder="you@example.com"
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-ink ml-1">Phone Number (Optional)</label>
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Phone className="h-5 w-5 text-ink-muted group-focus-within:text-brand-600 transition-colors" />
            </div>
            <input
              type="tel"
              className="w-full pl-12 pr-4 py-3.5 sm:py-4 border border-line rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-ink/40 text-sm sm:text-base bg-white text-ink placeholder:text-ink-muted transition font-medium"
              placeholder="+1 (555) 000-0000"
              value={formData.phone}
              onChange={e => setFormData({ ...formData, phone: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-ink ml-1">Password</label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                 <Lock className="h-5 w-5 text-ink-muted group-focus-within:text-brand-600 transition-colors" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                className={`w-full pl-12 pr-10 py-3.5 sm:py-4 border rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-ink/40 text-sm sm:text-base bg-white text-ink placeholder:text-ink-muted transition font-medium ${fieldErrors.password ? 'border-red-300' : 'border-line'}`}
                placeholder="••••••••"
                value={formData.password}
                onChange={e => setFormData({ ...formData, password: e.target.value })}
                required
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-ink-muted hover:text-ink transition-colors">
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-ink ml-1">Confirm</label>
            <div className="relative group">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                className={`w-full px-4 pr-10 py-3.5 sm:py-4 border rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-ink/40 text-sm sm:text-base bg-white text-ink placeholder:text-ink-muted transition font-medium ${fieldErrors.confirmPassword ? 'border-red-300' : 'border-line'}`}
                placeholder="••••••••"
                value={formData.confirmPassword}
                onChange={e => setFormData({ ...formData, confirmPassword: e.target.value })}
                required
              />
              <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-ink-muted hover:text-ink transition-colors">
                {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
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
            <>Create Account <ArrowRight className="h-5 w-5" /></>
          )}
        </button>

        <div className="relative my-8 sm:my-10">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-line"></div>
          </div>
          <div className="relative flex justify-center text-[10px] sm:text-xs uppercase">
            <span className="bg-white px-4 text-ink-muted font-bold tracking-[0.16em] leading-none">Or signup with</span>
          </div>
        </div>

        <div id="google-button-container" className="w-full min-h-[44px] flex justify-center" />
      </form>

      <div className="mt-10 mb-8 text-center space-y-6 sm:space-y-8">
        <p className="text-ink-soft text-sm sm:text-base">
          Already have an account?{' '}
          <Link href="/login" className="text-ink font-bold underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
            Sign in
          </Link>
        </p>

        <div className="pt-8 border-t border-line">
          <Link href="/provider/signup" className="flex items-center justify-center gap-2 text-xs sm:text-sm text-ink-soft hover:text-ink font-semibold transition">
             <CheckCircle2 className="h-4 w-4" /> Want to earn as a professional? <span className="text-brand-700">Register as a Pro</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <>
      <Header />
      <div className="w-full max-w-[100vw] min-h-screen bg-white font-sans antialiased text-ink flex overflow-x-hidden">
        {/* <div className="hidden lg:flex flex-col justify-center w-2/5 bg-gradient-to-br from-green-700 to-teal-700 p-12 text-white relative overflow-hidden">
          {/* <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32 blur-3xl"></div>
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 rounded-full -ml-32 -mb-32 blur-3xl"></div> * /}

          {/* <div className="relative z-10">
            <Link href="/" className="inline-block">
              <h1 className="text-3xl font-black tracking-tight italic">WorkOnTap</h1>
            </Link>
          </div> * /}

          <div className="relative z-10">
            <div className="space-y-8">
              <div className="flex items-center gap-3 mb-12">
                <span className="text-2xl font-black">Customer Signup</span>
              </div>
               <h2 className="text-4xl font-black leading-tight">Join our community<br />of happy customers.</h2>
               <div className="space-y-6">
                {[
                  { icon: '🏠', title: 'Home Services', desc: 'Find cleaners, handymen, and more for your home' },
                  { icon: '🚗', title: 'Auto Care', desc: 'Connect with mobile mechanics and car cleaners' },
                  { icon: '✨', title: 'Personal Care', desc: 'Home visits for grooming and wellness' },
                ].map((f) => (
                  <div key={f.title} className="flex gap-4 items-start group">
                    <span className="text-2xl bg-white/10 p-3 rounded-2xl group-hover:bg-white/20 transition-colors uppercase">{f.icon}</span>
                    <div>
                      <p className="font-bold text-white text-lg">{f.title}</p>
                      <p className="text-green-100/80 text-sm leading-relaxed">{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* <p className="relative z-10 text-green-200/50 text-xs font-bold uppercase tracking-widest leading-none">© 2025 WorkOnTap Technologies</p> * /}
        </div> */}

        {/* Left panel - photograph only (Hidden on mobile) */}
        <div className="hidden lg:block w-2/5 relative overflow-hidden bg-brand-900" aria-hidden="true">
          <img src="/images/services/move-in-repair-package.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-brand-950/60 via-transparent to-transparent" />
        </div>

        <div className="flex-1 w-full max-w-[100vw] flex flex-col items-center justify-center py-12 px-4 sm:px-8 md:px-12 lg:px-20 relative">
          <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 lg:hidden">
            <div className="absolute top-0 right-0 translate-x-1/3 -translate-y-1/3 w-64 h-64 bg-brand-50 rounded-full blur-3xl"></div>
            <div className="absolute bottom-0 left-0 -translate-x-1/3 translate-y-1/3 w-64 h-64 bg-paper-deep rounded-full blur-3xl"></div>
          </div>

          <Suspense fallback={<div className="animate-pulse flex flex-col items-center justify-center w-full min-h-[50vh]"><div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mb-4"></div><p className="text-ink-soft">Loading...</p></div>}>
            <SignupFormContent />
          </Suspense>
        </div>
      </div>
      <Footer />
    </>
  );
}
