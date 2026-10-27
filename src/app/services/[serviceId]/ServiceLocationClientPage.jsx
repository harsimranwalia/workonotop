'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { ArrowRight, Check, CreditCard, MapPin, ShieldCheck, Tag } from 'lucide-react';
import { serviceImage } from '@/lib/service-images';
import AutocompleteComponent from 'react-google-autocomplete';

const Autocomplete = AutocompleteComponent.default || AutocompleteComponent;

export default function ServiceLocationClientPage({
  service,
  serviceLocation,
  serviceId,
  locationSlug,
  locationName,
  allLocations = []
}) {
  const router = useRouter();
  const [selectedAddress, setSelectedAddress] = useState(`${locationName}, BC, Canada`);
  const [addressError, setAddressError] = useState('');

  useEffect(() => {
    // If address was saved previously in session, use it if it matches
    const savedAddress = sessionStorage.getItem('userAddress');
    if (savedAddress && savedAddress.toLowerCase().includes(locationName.toLowerCase())) {
      setSelectedAddress(savedAddress);
    }
  }, [locationName]);

  const handleBookNow = () => {
    if (!selectedAddress || selectedAddress.trim() === '') {
      setAddressError('Please confirm your service address');
      return;
    }

    sessionStorage.setItem('selectedServiceId', service?.id);
    sessionStorage.setItem('selectedServiceName', service?.name);
    sessionStorage.setItem('selectedServicePrice', service?.base_price);
    sessionStorage.setItem('userAddress', selectedAddress);
    sessionStorage.setItem('selectedLocationName', locationName);
    sessionStorage.setItem('selectedLocationSlug', locationSlug);
    sessionStorage.setItem('userCity', locationName);

    router.push(`/booking/schedule?service=${service?.id}`);
  };

  const useCases = service?.use_cases
    ? service.use_cases.split(',').map(item => item.trim()).filter(item => item)
    : [];

  const headingText = serviceLocation?.custom_heading || `#1 Rated ${service?.name || 'Home'} Services in ${locationName}, BC`;
  const introText = serviceLocation?.custom_intro || `Looking for top-rated, background-checked ${service?.name?.toLowerCase() || 'home maintenance'} specialists in ${locationName}? WorkOnTap connects you with verified local pros who deliver fast, high-quality service at transparent upfront rates.`;

  const dynamicShortDescription = service?.short_description
    ? service.short_description.replace(new RegExp(service?.name, 'gi'), `${service?.name} in ${locationName}`)
    : '';

  const dynamicDescription = (serviceLocation?.description && serviceLocation.description.trim() !== '')
    ? serviceLocation.description
    : (service?.description
      ? service.description.replace(new RegExp(service?.name, 'gi'), `${service?.name} in ${locationName}`)
      : '');

  if (!service) {
    return (
      <div className="min-h-screen bg-white font-sans text-ink">
        <Header />
        <div className="container mx-auto px-6 py-24 text-center max-w-xl">
          <h2 className="font-display text-3xl font-semibold text-ink mb-4">Service Not Found</h2>
          <p className="text-ink-muted mb-8">We couldn&apos;t find the service you&apos;re looking for in {locationName}.</p>
          <Link href="/services" className="inline-flex items-center px-6 py-3 bg-ink text-white font-semibold rounded-2xl hover:bg-brand-900 transition">
            Browse All Services
          </Link>
        </div>
        <Footer />
      </div>
    );
  }

  const getImageUrl = (url) => url && !url.startsWith('http') && !url.startsWith('/') ? '/uploads/' + url : url;
  const nearby = allLocations.filter((loc) => loc.location_slug !== locationSlug);

  return (
    <div className="min-h-screen bg-white font-sans antialiased text-ink">
      <Header />

      <div className="border-b border-line">
        <nav aria-label="Breadcrumb" className="container mx-auto px-5 sm:px-6 max-w-7xl py-3 flex items-center gap-2 text-sm text-ink-muted flex-wrap">
          <Link href="/" className="hover:text-ink transition">Home</Link>
          <span aria-hidden="true">/</span>
          <Link href="/services" className="hover:text-ink transition">Services</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/services/${service.slug}`} className="hover:text-ink transition">{service.name}</Link>
          <span aria-hidden="true">/</span>
          <span className="text-ink font-medium">{locationName}, BC</span>
        </nav>
      </div>

      {/* Hero */}
      <section className="bg-paper border-b border-line">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl py-8 lg:py-12 grid lg:grid-cols-[1.05fr_0.95fr] gap-8 lg:gap-12 items-center">
          <div className="order-last lg:order-first">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-line px-3 py-1 text-xs font-semibold text-ink-soft mb-4">
              <MapPin className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" /> {locationName}, BC
            </span>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-[52px] leading-[1.06] font-semibold tracking-[-0.025em] text-ink mb-4">
              {serviceLocation?.custom_heading || headingText}
            </h1>
            {(serviceLocation?.custom_intro || introText || dynamicShortDescription) && (
              <p className="text-lg text-ink-soft leading-relaxed max-w-xl mb-7">
                {serviceLocation?.custom_intro || introText || dynamicShortDescription}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <button
                onClick={handleBookNow}
                className="group inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-7 py-3.5 rounded-2xl font-bold shadow-lg shadow-brand-600/20 transition active:scale-[0.98]"
              >
                See my price <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </button>
              <span className="text-sm text-ink-muted">From <span className="font-semibold text-ink">${parseFloat(service.base_price || 0).toFixed(0)}</span> · card charged after the job</span>
            </div>
            {addressError && <p className="mt-3 text-sm font-semibold text-red-600">{addressError}</p>}
          </div>
          <div className="relative overflow-hidden rounded-[32px] aspect-[4/3] bg-paper-deep">
            <img src={getImageUrl(serviceImage(service))} alt={`${service.name} in ${locationName}`} className="h-full w-full object-cover" />
          </div>
        </div>
      </section>

      {/* Promises */}
      <section className="border-b border-line">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl py-8 grid sm:grid-cols-3 gap-6">
          {[
            { icon: Tag, title: 'Your price before you book', desc: 'On screen at every step.' },
            { icon: CreditCard, title: 'Pay when the job is done', desc: 'Your card is held, not charged.' },
            { icon: ShieldCheck, title: 'Protection Promise', desc: 'Tell us within 48 hours and we make it right.' },
          ].map(({ icon: ItemIcon, title, desc }) => (
            <div key={title} className="flex gap-3.5">
              <span className="h-10 w-10 shrink-0 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center"><ItemIcon className="h-5 w-5" aria-hidden="true" /></span>
              <div>
                <p className="font-semibold text-ink">{title}</p>
                <p className="text-sm text-ink-muted">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="container mx-auto px-5 sm:px-6 max-w-4xl py-12 md:py-16">
        {useCases.length > 0 && (
          <div className="mb-12">
            <h2 className="font-display text-2xl md:text-3xl font-semibold tracking-tight text-ink mb-5">What We Help With</h2>
            <ul className="flex flex-wrap gap-2">
              {useCases.map((useCase, idx) => (
                <li key={idx} className="inline-flex items-center gap-1.5 rounded-full bg-paper border border-line px-3.5 py-2 text-sm font-medium text-ink-soft">
                  <Check className="h-4 w-4 text-brand-600" aria-hidden="true" /> {useCase}
                </li>
              ))}
            </ul>
          </div>
        )}

        {dynamicDescription && (
          <div className="mb-12">
            <h2 className="font-display text-2xl md:text-3xl font-semibold tracking-tight text-ink mb-5">Service Details & Overview</h2>
            <div
              className="rich-text-content text-ink-soft text-base leading-relaxed break-words [&_h2]:font-display [&_h2]:text-ink [&_h3]:text-ink [&_a]:text-brand-700 [&_a]:font-medium"
              dangerouslySetInnerHTML={{ __html: dynamicDescription }}
            />
          </div>
        )}

        <div className="rounded-[28px] bg-brand-900 text-white p-7 md:p-9 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div>
            <h2 className="font-display text-2xl md:text-3xl font-semibold">{service.name} in {locationName}</h2>
            <p className="text-white/70 mt-1">See the price before you book. Pay once the job is done.</p>
          </div>
          <button onClick={handleBookNow} className="shrink-0 inline-flex items-center justify-center gap-2 bg-white text-brand-900 px-6 py-3.5 rounded-2xl font-bold hover:bg-brand-50 transition">
            See my price <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {nearby.length > 0 && (
          <div className="mt-14 pt-10 border-t border-line">
            <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tight text-ink mb-5">{service.name} in nearby cities</h2>
            <div className="flex flex-wrap gap-2">
              {nearby.map((loc) => (
                <Link
                  key={loc.location_slug}
                  href={service.slug.includes(loc.location_slug) ? `/services/${service.slug}` : `/services/${service.slug}-${loc.location_slug}`}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-line bg-white text-sm font-medium text-ink-soft hover:border-ink/40 hover:text-ink transition"
                >
                  <MapPin className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" /> {loc.location_name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}
