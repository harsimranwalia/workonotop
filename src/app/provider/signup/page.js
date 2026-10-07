'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Mail, Phone, User, Lock, ArrowRight, Sparkles, CheckCircle2 } from 'lucide-react';
import Header from 'src/components/Header';
import Footer from 'src/components/Footer';

function ProviderSignupFormContent() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    firstName: '', lastName: '', email: '', phone: '', password: '', confirmPassword: ''
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [touched, setTouched] = useState({});

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
                body: JSON.stringify({ token: response.credential, role: 'provider' })
              });
              const data = await res.json();
              if (data.success) {
                router.push('/provider/dashboard');
              } else {
                setErrors({ submit: data.message || 'Google registration failed' });
              }
            } catch (err) {
              setErrors({ submit: 'Failed to Register with Google' });
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
  }, [router]);

  const validateField = (name, value) => {
    switch (name) {
      case 'firstName': return !value.trim() ? 'First name required' : value.length < 2 ? 'Too short' : '';
      case 'lastName': return !value.trim() ? 'Last name required' : '';
      case 'email': return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? 'Invalid email' : '';
      case 'phone': 
        if (!value) return '';
        return value.replace(/\D/g, '').length < 10 ? 'Invalid phone' : '';
      case 'password': return value.length < 8 ? 'Min 8 characters' : !/[!@#$%^&*(),.?":{}|<>]/.test(value) ? 'Need special character' : '';
      case 'confirmPassword': return value !== formData.password ? 'Passwords match fail' : '';
      default: return '';
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (touched[name]) setErrors(prev => ({ ...prev, [name]: validateField(name, value) }));
  };

  const handleBlur = (e) => {
    const { name, value } = e.target;
    setTouched(prev => ({ ...prev, [name]: true }));
    setErrors(prev => ({ ...prev, [name]: validateField(name, value) }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const newErrors = {};
    Object.keys(formData).forEach(key => {
      const err = validateField(key, formData[key]);
      if (err) newErrors[key] = err;
    });
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/provider/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (data.success) {
        router.push(`/provider/verify-email-pending?email=${encodeURIComponent(formData.email)}`);
      } else {
        setErrors({ submit: data.message });
      }
    } catch {
      setErrors({ submit: 'Connection error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-lg relative z-10 py-10 lg:py-0 ">
      {/* <div className="lg:hidden mb-8 text-center animate-fadeIn">
        <Link href="/">
          <h1 className="text-3xl font-black text-blue-700 tracking-tight italic">WorkOnTap <span className="text-blue-500 font-medium">Pro</span></h1>
        </Link>
        <p className="text-gray-500 font-bold mt-1 uppercase tracking-widest text-xs">Professional Registration</p>
      </div> */}

      <div className="mb-8 text-center lg:text-left space-y-2">
        <h3 className="text-3xl sm:text-4xl font-black text-gray-900 font-outfit">Be Your Own Boss.</h3>
        <p className="text-gray-500 font-medium">Join thousands of pros earning on WorkOnTap</p>
      </div>

      {errors.submit && (
        <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl animate-shake flex items-start gap-3">
          <span className="text-red-500 mt-0.5 font-bold">⚠️</span>
          <p className="text-sm text-red-700 font-bold">{errors.submit}</p>
        </div>
      )}

      {/* method="post": a submit before the scripts load keeps the fields out of the address */}
      <form method="post" onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-sm font-bold text-gray-700 ml-1">First Name</label>
            <input
              type="text" name="firstName" value={formData.firstName} onChange={handleChange} onBlur={handleBlur}
              className={`w-full px-4 py-3.5 border-2 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 bg-gray-50/50 hover:bg-white focus:bg-white transition-all font-medium ${errors.firstName ? 'border-red-200' : 'border-gray-100'}`}
              placeholder="John" required
            />
            {errors.firstName && <p className="text-[10px] text-red-500 font-bold ml-1 uppercase">{errors.firstName}</p>}
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-bold text-gray-700 ml-1">Last Name</label>
            <input
              type="text" name="lastName" value={formData.lastName} onChange={handleChange} onBlur={handleBlur}
              className={`w-full px-4 py-3.5 border-2 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 bg-gray-50/50 hover:bg-white focus:bg-white transition-all font-medium ${errors.lastName ? 'border-red-200' : 'border-gray-100'}`}
              placeholder="Doe" required
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-bold text-gray-700 ml-1">Work Email</label>
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Mail className="h-5 w-5 text-gray-400 group-focus-within:text-blue-600 transition-colors" />
            </div>
            <input
              type="email" name="email" value={formData.email} onChange={handleChange} onBlur={handleBlur}
              className={`w-full pl-12 pr-4 py-3.5 border-2 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 bg-gray-50/50 hover:bg-white focus:bg-white transition-all font-medium ${errors.email ? 'border-red-200' : 'border-gray-100'}`}
              placeholder="pro@example.com" required
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-bold text-gray-700 ml-1">Phone Number (Optional)</label>
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Phone className="h-5 w-5 text-gray-400 group-focus-within:text-blue-600 transition-colors" />
            </div>
            <input
              type="tel" name="phone" value={formData.phone} onChange={handleChange} onBlur={handleBlur}
              className={`w-full pl-12 pr-4 py-3.5 border-2 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 bg-gray-50/50 hover:bg-white focus:bg-white transition-all font-medium ${errors.phone ? 'border-red-200' : 'border-gray-100'}`}
              placeholder="+1 (555) 000-0000"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-sm font-bold text-gray-700 ml-1">Password</label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Lock className="h-5 w-5 text-gray-400 group-focus-within:text-blue-600 transition-colors" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                name="password" value={formData.password} onChange={handleChange} onBlur={handleBlur}
                className={`w-full pl-12 pr-10 py-3.5 border-2 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 bg-gray-50/50 hover:bg-white focus:bg-white transition-all font-medium ${errors.password ? 'border-red-200' : 'border-gray-100'}`}
                placeholder="••••••••" required
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400">
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-bold text-gray-700 ml-1">Confirm</label>
            <div className="relative group">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} onBlur={handleBlur}
                className={`w-full px-4 pr-10 py-3.5 border-2 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 bg-gray-50/50 hover:bg-white focus:bg-white transition-all font-medium ${errors.confirmPassword ? 'border-red-200' : 'border-gray-100'}`}
                placeholder="••••••••" required
              />
              <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400">
                {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3.5 sm:py-4 bg-green-600 hover:bg-green-700 text-white font-black rounded-2xl transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-xl shadow-blue-100 active:scale-[0.98] mt-2 text-base sm:text-lg"
        >
          {loading ? (
            <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <>Create Pro Account <ArrowRight className="h-5 w-5" /></>
          )}
        </button>

        <div className="relative my-8">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-100"></div>
          </div>
          <div className="relative flex justify-center text-[10px] uppercase">
            <span className="bg-white px-4 text-gray-400 font-black tracking-widest leading-none">Or Register with</span>
          </div>
        </div>

        <div id="google-button-container" className="w-full min-h-[44px] flex justify-center" />
      </form>

      <div className="mt-10 mb-8 text-center space-y-6 sm:space-y-8">
        <p className="text-gray-600 font-medium text-sm sm:text-base">
          Already a Pro?{' '}
          <Link href="/provider/login" className="text-green-600 hover:text-green-700 font-semibold underline decoration-2 underline-offset-4">
            Sign in
          </Link>
        </p>

        <div className="pt-8 border-t border-gray-100">
          <Link href="/signup" className="flex items-center justify-center gap-2 text-xs sm:text-sm text-gray-500 hover:text-green-700 font-bold transition-all hover:-translate-x-1">
            <User className="h-4 w-4" /> Looking for services? <span className="text-green-600">Register as a Customer</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ProviderSignupPage() {
  return (
    <>
      <Header />
      <div className="w-full max-w-[100vw] min-h-screen bg-gradient-to-br from-green-50 via-white to-teal-50 flex overflow-x-hidden">
        {/* Left panel */}
        {/* <div className="hidden lg:flex flex-col justify-between w-2/5 bg-gradient-to-br from-green-700 to-teal-700 p-12 text-white">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">WorkOnTap</h1>
            <p className="mt-2 text-green-200 text-sm">Pro Dashboard</p>
          </div>
          <div className="space-y-6">
            {[
              { icon: '💼', title: 'Start earning today', desc: 'Connect with customers in your area' },
              { icon: '💳', title: 'Secure payments', desc: 'Get paid fast with Stripe integration' },
              { icon: '⭐', title: 'Build your business', desc: 'Grow your reputation with ratings' },
            ].map((f) => (
              <div key={f.title} className="flex gap-4 items-start">
                <span className="text-2xl">{f.icon}</span>
                <div>
                  <p className="font-semibold text-white">{f.title}</p>
                  <p className="text-green-200 text-sm">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-green-300 text-sm">© 2025 WorkOnTap. All rights reserved.</p>
        </div> */}

        <div className="flex-1 w-full max-w-[100vw] flex flex-col items-center justify-center py-12 px-4 sm:px-8 md:px-12 lg:px-20 relative">
          <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 lg:hidden">
            <div className="absolute top-0 right-0 translate-x-1/3 -translate-y-1/3 w-64 h-64 bg-blue-50 rounded-full blur-3xl"></div>
            <div className="absolute bottom-0 left-0 -translate-x-1/3 translate-y-1/3 w-64 h-64 bg-indigo-50 rounded-full blur-3xl"></div>
          </div>

          <Suspense fallback={<div className="animate-pulse flex flex-col items-center justify-center w-full min-h-[50vh]"><div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin mb-4"></div><p className="text-gray-500 font-medium">Loading...</p></div>}>
            <ProviderSignupFormContent />
          </Suspense>
        </div>
      </div>
      <Footer />
    </>
  );
}