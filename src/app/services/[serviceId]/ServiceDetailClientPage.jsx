'use client';
import Link from 'next/link';
import AutocompleteComponent from 'react-google-autocomplete';
const Autocomplete = AutocompleteComponent.default || AutocompleteComponent;
import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { toast } from 'react-hot-toast';
import { ArrowRight, ArrowUpRight, Check, Clock, CreditCard, Lock, MapPin, ShieldCheck } from 'lucide-react';
import { serviceImage } from '@/lib/service-images';

export default function ServiceDetailClientPage({ serviceId, initialService = null, initialRelatedServices = [] }) {
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [service, setService] = useState(initialService);
  const [relatedServices, setRelatedServices] = useState(initialRelatedServices);
  const [loading, setLoading] = useState(!initialService);
  const [addressError, setAddressError] = useState('');

  useEffect(() => {
    if (!initialService && serviceId) {
      fetchServiceData();
    }

    const savedAddress = typeof window !== 'undefined' ? sessionStorage.getItem('userAddress') : null;
    if (savedAddress && savedAddress !== 'Please enter your service location') {
      setSelectedAddress(savedAddress);
    }

    const handleScroll = () => {
      // Force Google Places Autocomplete to reposition the dropdown when scrolling
      if (document.activeElement?.classList?.contains('pac-target-input')) {
        window.dispatchEvent(new Event('resize'));
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [serviceId, initialService]);

  const fetchServiceData = async () => {
    if (!service) setLoading(true);
    try {
      const serviceRes = await fetch(`/api/services?slug=${encodeURIComponent(serviceId)}`);
      if (!serviceRes.ok) return;
      const text = await serviceRes.text();
      if (!text) return;
      const serviceData = JSON.parse(text);

      if (serviceData.success && serviceData.data) {
        setService(serviceData.data);

        if (serviceData.data.category_id) {
          const relatedRes = await fetch(`/api/services?category_id=${serviceData.data.category_id}`);
          if (relatedRes.ok) {
            const relText = await relatedRes.text();
            if (relText) {
              const relatedData = JSON.parse(relText);
              if (relatedData.success && Array.isArray(relatedData.data)) {
                const filtered = relatedData.data
                  .filter(s => s.id !== serviceData.data.id)
                  .slice(0, 4);
                setRelatedServices(filtered);
              }
            }
          }
        }
      } else {
        router.push('/services');
      }
    } catch (error) {
      console.error('Error loading service:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };



  const useCases = service?.use_cases
    ? service.use_cases.split(',').map(item => item.trim()).filter(item => item)
    : [];

  const formatPrice = (price) => {
    if (!price) return '0.00';
    return parseFloat(price).toFixed(2);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-10 h-10 border-[3px] border-brand-500/20 border-t-brand-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!service) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="font-display text-2xl font-semibold text-ink mb-2">Service not found</h2>
          <Link href="/services" className="text-brand-700 font-semibold hover:underline">
            Browse all services
          </Link>
        </div>
      </div>
    );
  }

  const getImageUrl = (url) => url && !url.startsWith('http') && !url.startsWith('/') ? '/uploads/' + url : url;
  const hours = service.duration_minutes > 0 ? service.duration_minutes / 60 : 0;

  const rememberAddress = (value) => {
    setSelectedAddress(value);
    setAddressError('');
    if (typeof window !== 'undefined') sessionStorage.setItem('userAddress', value);
  };

  const startBooking = () => {
    if (!selectedAddress || selectedAddress.trim() === '') {
      setAddressError('Required');
      toast.error('Please enter your service location');
    } else {
      // The details are already in sessionStorage (onPlaceSelected, or the plain field)
      router.push(`/booking/schedule?service=${service.id}`);
    }
  };

  const fieldLook = `w-full pl-10 pr-3 py-3 border rounded-xl bg-white text-[15px] text-ink placeholder:text-ink-muted transition focus:outline-none focus:ring-4 focus:ring-brand-500/10 ${addressError ? 'border-red-400' : 'border-line focus:border-ink/40 hover:border-ink/30'}`;

  return (
    <div className="min-h-screen bg-white font-sans antialiased text-ink">
      <Header />

      <div className="border-b border-line">
        <nav aria-label="Breadcrumb" className="container mx-auto px-5 sm:px-6 max-w-7xl py-3 flex items-center gap-2 text-sm text-ink-muted">
          <Link href="/" className="hover:text-ink transition">Home</Link>
          <span aria-hidden="true">/</span>
          <Link href="/services" className="hover:text-ink transition">Services</Link>
          <span aria-hidden="true">/</span>
          <span className="text-ink font-medium truncate">{service.name}</span>
        </nav>
      </div>

      {/* Hero */}
      <section className="bg-paper border-b border-line">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl py-8 lg:py-12 grid lg:grid-cols-[1.05fr_0.95fr] gap-8 lg:gap-12 items-center">
          <div className="order-last lg:order-first">
            <span className="inline-flex items-center rounded-full bg-white border border-line px-3 py-1 text-xs font-semibold text-ink-soft mb-4">
              {service.category_name || 'Service'}
            </span>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-[56px] leading-[1.05] font-semibold tracking-[-0.025em] text-ink mb-4">
              {service.name}
            </h1>
            {service.short_description && (
              <p className="text-lg text-ink-soft leading-relaxed max-w-xl mb-6">{service.short_description}</p>
            )}
            <ul className="flex flex-wrap gap-2">
              {[
                { icon: CreditCard, text: 'Pay when the job is done' },
                { icon: ShieldCheck, text: 'Protection Promise' },
                ...(hours ? [{ icon: Clock, text: `${hours} ${hours === 1 ? 'hour' : 'hours'} included` }] : []),
              ].map(({ icon: ChipIcon, text }) => (
                <li key={text} className="inline-flex items-center gap-1.5 rounded-full bg-white border border-line px-3 py-1.5 text-sm font-medium text-ink-soft">
                  <ChipIcon className="h-4 w-4 text-brand-600" aria-hidden="true" /> {text}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative overflow-hidden rounded-[32px] aspect-[4/3] bg-paper-deep">
            <img src={getImageUrl(serviceImage(service))} alt={service.name} className="h-full w-full object-cover" />
          </div>
        </div>
      </section>

      <div className="container mx-auto px-5 sm:px-6 max-w-7xl py-10 md:py-14">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 lg:gap-14">

          <div className="lg:col-span-2 order-last lg:order-first">
            {useCases.length > 0 && (
              <div className="mb-12">
                <h2 className="font-display text-2xl md:text-3xl font-semibold tracking-tight text-ink mb-5">Customers use this service for</h2>
                <ul className="flex flex-wrap gap-2">
                  {useCases.map((item, index) => (
                    <li key={index} className="inline-flex items-center gap-1.5 rounded-full bg-paper border border-line px-3.5 py-2 text-sm font-medium text-ink-soft">
                      <Check className="h-4 w-4 text-brand-600" aria-hidden="true" /> {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {service.description && (
              <div className="mb-12">
                <h2 className="font-display text-2xl md:text-3xl font-semibold tracking-tight text-ink mb-5">Service Details & Overview</h2>
                <div
                  className="rich-text-content text-ink-soft text-base leading-relaxed break-words [&_h2]:font-display [&_h2]:text-ink [&_h3]:text-ink [&_a]:text-brand-700 [&_a]:font-medium"
                  dangerouslySetInnerHTML={{ __html: service.description }}
                />
              </div>
            )}

            <div className="mb-8 rounded-[28px] bg-paper border border-line p-6 md:p-8">
              <h2 className="font-display text-2xl md:text-3xl font-semibold tracking-tight text-ink mb-7">How WorkOnTap works</h2>
              <ol className="grid md:grid-cols-3 gap-6">
                {[
                  { title: 'Tell us what you need', desc: 'Select a date, time, and describe your job — takes 2 minutes.' },
                  { title: 'Get matched instantly', desc: 'Submit your request and get matched with a certified WorkOnTap pro in minutes — average 10 min response.' },
                  { title: 'Chat & confirm', desc: "Discuss details with your pro before the job begins. Pay securely after you're 100% satisfied." },
                ].map((step, i) => (
                  <li key={step.title}>
                    <span className="font-display text-sm font-semibold text-brand-600">0{i + 1}</span>
                    <h3 className="font-semibold text-lg text-ink mt-2 mb-1.5">{step.title}</h3>
                    <p className="text-sm text-ink-muted leading-relaxed">{step.desc}</p>
                  </li>
                ))}
              </ol>
            </div>

            <div className="relative overflow-hidden rounded-[28px] bg-brand-900 text-white p-6 md:p-8">
              <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-500/20 blur-3xl" aria-hidden="true" />
              <div className="relative flex flex-col sm:flex-row sm:items-center gap-6">
                <span className="h-14 w-14 shrink-0 rounded-2xl bg-white/10 flex items-center justify-center">
                  <ShieldCheck className="h-7 w-7 text-brand-200" aria-hidden="true" />
                </span>
                <div className="flex-1">
                  <h3 className="font-display text-2xl font-semibold mb-2">Homeowner Protection Promise</h3>
                  <p className="text-white/75 mb-5 leading-relaxed">
                    Every WorkOnTap pro is licensed, background-checked, and well-rated.
                    If your experience isn&apos;t perfect, we&apos;ll make it right — 100% guaranteed.
                  </p>
                  <Link href="/guarantee" className="inline-flex items-center gap-1.5 bg-white text-brand-900 px-5 py-2.5 rounded-full font-semibold hover:bg-brand-50 transition">
                    Learn more <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Booking card */}
          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-24">
              <div className="rounded-[28px] border border-line bg-white shadow-lift overflow-hidden">
                <div className="p-6 border-b border-line">
                  <h3 className="font-display text-2xl font-semibold text-ink">Book this job</h3>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">Starting at</span>
                      <span className="font-display text-4xl font-semibold text-ink">${formatPrice(service.base_price)}</span>
                    </div>
                    {service.additional_price > 0 && (
                      <span className="text-sm text-ink-muted text-right">+${formatPrice(service.additional_price)} / hr<br />after that</span>
                    )}
                  </div>
                  {hours > 0 && (
                    <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
                      <Clock className="h-4 w-4 text-brand-600" aria-hidden="true" />
                      Includes the first {hours} {hours === 1 ? 'hour' : 'hours'} ({service.duration_minutes} mins)
                    </p>
                  )}
                  <p className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
                    <Check className="h-4 w-4 text-brand-600" aria-hidden="true" />
                    Transparent, upfront pricing
                  </p>
                </div>

                <div className="p-6">
                  <div className="flex justify-between items-center mb-2">
                    <label htmlFor="service-address" className="text-sm font-semibold text-ink">Where do you need service?</label>
                    {addressError && <span className="text-red-500 text-xs font-bold">{addressError}</span>}
                  </div>
                  <div className="relative">
                    <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted pointer-events-none z-10" aria-hidden="true" />
                    {process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? (
                      <Autocomplete
                        id="service-address"
                        className={fieldLook}
                        onPlaceSelected={(place) => {
                          if (place && place.formatted_address) {
                            setSelectedAddress(place.formatted_address);
                            setAddressError('');

                            // Extract City and Postal Code from address components
                            let city = '';
                            let postalCode = '';
                            if (place.address_components) {
                              for (const component of place.address_components) {
                                const types = component.types;
                                if (types.includes('locality')) {
                                  city = component.long_name;
                                } else if (!city && types.includes('administrative_area_level_3')) {
                                  city = component.long_name;
                                }
                                if (types.includes('postal_code')) {
                                  postalCode = component.long_name;
                                }
                              }
                            }

                            let lat = null;
                            let lng = null;
                            if (place.geometry && place.geometry.location) {
                              lat = place.geometry.location.lat();
                              lng = place.geometry.location.lng();
                            }

                            sessionStorage.setItem('userAddress', place.formatted_address);
                            sessionStorage.setItem('userCity', city);
                            sessionStorage.setItem('userPostalCode', postalCode);
                            if (lat && lng) {
                              sessionStorage.setItem('userLat', lat);
                              sessionStorage.setItem('userLng', lng);
                            }
                          }
                        }}
                        options={{
                          types: ['address'],
                          componentRestrictions: { country: 'ca' }
                        }}
                        placeholder="Enter your address"
                        defaultValue={selectedAddress}
                        onChange={(e) => {
                          setSelectedAddress(e.target.value);
                          setAddressError('');
                        }}
                      />
                    ) : (
                      // Without a Maps key the address is typed in full; the booking flow confirms it later.
                      <input
                        id="service-address"
                        type="text"
                        autoComplete="street-address"
                        className={fieldLook}
                        placeholder="Enter your address"
                        value={selectedAddress}
                        onChange={(e) => rememberAddress(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') startBooking(); }}
                      />
                    )}
                  </div>
                  <p className="text-xs text-ink-muted mt-2">Your address is kept private until you accept a pro.</p>

                  <button
                    onClick={startBooking}
                    className="group mt-5 w-full flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-brand-600/20 transition active:scale-[0.99]"
                  >
                    Get Started — Free Quote <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </button>

                  <p className="text-xs text-center text-ink-muted mt-3 flex items-center justify-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-brand-600" aria-hidden="true" />
                    You won&apos;t be charged until the job is complete
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {relatedServices.length > 0 && (
        <section className="bg-paper py-14 md:py-20 border-t border-line">
          <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
            <h2 className="font-display text-2xl md:text-3xl font-semibold tracking-tight text-ink mb-8">You might also need</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-5">
              {relatedServices.map((item) => (
                <Link key={item.id} href={`/services/${item.slug}`} className="group flex flex-col">
                  <span className="block aspect-[4/3] overflow-hidden rounded-3xl bg-paper-deep">
                    <img src={getImageUrl(serviceImage(item))} alt="" loading="lazy" className="w-full h-full object-cover transition duration-700 group-hover:scale-[1.04]" />
                  </span>
                  <span className="mt-3 flex items-start justify-between gap-2">
                    <span className="font-semibold text-ink leading-snug">{item.name}</span>
                    <ArrowUpRight className="h-4 w-4 mt-1 shrink-0 text-ink-muted group-hover:text-brand-600 transition" aria-hidden="true" />
                  </span>
                  <span className="text-sm text-ink-muted mt-0.5">Starting at ${formatPrice(item.base_price)}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <Footer />

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
        .line-clamp-1 {
          display: -webkit-box;
          -webkit-line-clamp: 1;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
