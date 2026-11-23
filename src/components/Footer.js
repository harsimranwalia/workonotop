'use client';

import Link from 'next/link';

import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { APP_LINKS, SOCIAL_LINKS } from '@/lib/constants';

const DEFAULT_FOOTER_SERVICES = [
  // { id: 1, name: 'Plumbing Services', slug: 'plumbing' },
  // { id: 2, name: 'Airbnb Cleaning', slug: 'airbnb-cleaning' },
  // { id: 3, name: 'Carpet Cleaning', slug: 'carpet-cleaning' },
  // { id: 4, name: 'Commercial Cleaning', slug: 'commercial-cleaning' },
  // { id: 5, name: 'Deep Move In/Move Out Cleaning', slug: 'deep-move-inmove-out-cleaning' },
  // { id: 8, name: 'Pressure Cleaning', slug: 'pressure-cleaning' },
];

export default function Footer({ initialServices = null }) {
  const currentYear = new Date().getFullYear();
  const pathname = usePathname();
  const [services, setServices] = useState(
    Array.isArray(initialServices) && initialServices.length > 0
      ? initialServices.slice(0, 6)
      : DEFAULT_FOOTER_SERVICES
  );

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const res = await fetch('/api/services?limit=6');
        if (res.ok) {
          const text = await res.text();
          if (text) {
            const data = JSON.parse(text);
            if (data.success && Array.isArray(data.data) && data.data.length > 0) {
              setServices(data.data.slice(0, 6));
            }
          }
        }
      } catch (error) {
        console.error('Footer: Error fetching services:', error);
      }
    };
    fetchServices();
  }, []);

  if (pathname?.startsWith('/admin')) return null;

  const social = [
    { href: SOCIAL_LINKS.FACEBOOK, label: 'Facebook', path: <path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" />, fill: true },
    { href: SOCIAL_LINKS.TWITTER, label: 'Twitter', path: <path d="M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2c9 5 20 0 20-11.5a4.5 4.5 0 00-.08-.83A7.72 7.72 0 0023 3z" />, fill: true },
    { href: SOCIAL_LINKS.INSTAGRAM, label: 'Instagram', path: <><rect x="2" y="2" width="20" height="20" rx="5" ry="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" /></>, fill: false },
    { href: SOCIAL_LINKS.YOUTUBE, label: 'YouTube', path: <path d="M23.495 6.205a3.007 3.007 0 00-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 00.527 6.205a31.247 31.247 0 00-.522 5.805 31.247 31.247 0 00.522 5.783 3.007 3.007 0 002.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 002.088-2.088 31.247 31.247 0 00.5-5.783 31.247 31.247 0 00-.5-5.805zM9.609 15.601V8.408l6.264 3.602z" />, fill: true },
  ];

  const company = [
    { label: 'Home', href: '/' },
    { label: 'Find A Trade', href: '/services' },
    { label: 'How it works', href: '/how-it-works' },
    { label: 'Protection Promise', href: '/guarantee' },
    { label: 'Blog', href: '/blogs' },
    { label: 'Help', href: '/help' },
  ];

  const legal = [
    { label: 'Privacy Policy', href: '/privacy' },
    { label: 'Terms of Service', href: '/terms' },
    { label: 'Data Deletion Request', href: '/data-deletion' },
  ];

  const heading = 'text-xs font-bold uppercase tracking-[0.14em] text-ink mb-5';
  const link = 'text-[15px] text-ink-muted hover:text-ink transition';

  return (
    <footer className="bg-paper border-t border-line">
      <div className="container mx-auto px-5 sm:px-6 pt-16 pb-10 max-w-7xl">
        <div className="grid grid-cols-2 lg:grid-cols-12 gap-x-8 gap-y-12">

          <div className="col-span-2 lg:col-span-4">
            <Link href="/" className="inline-flex items-center mb-5">
              <Image src="/logo-trim.png" alt="WorkOnTap" width={170} height={45} className="h-11 w-auto object-contain" />
            </Link>
            <p className="text-[15px] text-ink-muted leading-relaxed mb-7 max-w-sm">
              Cleaning, moving and handyman services across Metro Vancouver. See your price before you book, and pay once the job is done.
            </p>
            <div className="flex items-center gap-2.5">
              {social.map((item) => (
                <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer" aria-label={item.label}
                  className="w-10 h-10 bg-white border border-line rounded-full flex items-center justify-center text-ink-soft hover:text-white hover:bg-ink hover:border-ink transition">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" {...(item.fill ? { fill: 'currentColor' } : { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })}>
                    {item.path}
                  </svg>
                </a>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2">
            <h4 className={heading}>Company</h4>
            <ul className="space-y-3">
              {company.map((item) => <li key={item.href}><Link href={item.href} className={link}>{item.label}</Link></li>)}
            </ul>
          </div>

          <div className="lg:col-span-3">
            <h4 className={heading}>Services</h4>
            <ul className="space-y-3">
              {(services.length > 0 ? services : DEFAULT_FOOTER_SERVICES).map((service) => (
                <li key={service.id || service.slug}>
                  <Link href={`/services/${service.slug}`} className={link}>{service.name}</Link>
                </li>
              ))}
              <li><Link href="/services" className="text-[15px] font-semibold text-ink hover:text-brand-700 transition">All services →</Link></li>
            </ul>
          </div>

          <div className="col-span-2 lg:col-span-3">
            <h4 className={heading}>Contact Us</h4>
            <ul className="space-y-3 text-[15px] text-ink-muted mb-8">
              <li><a href="mailto:info@workontap.com" className="hover:text-ink transition">info@workontap.com</a></li>
              <li><a href="tel:+17789690777" className="hover:text-ink transition">778-969-0777</a></li>
              <li>Metro Vancouver, BC, Canada</li>
            </ul>
            <ul className="flex flex-wrap gap-x-5 gap-y-2">
              {legal.map((item) => <li key={item.href}><Link href={item.href} className="text-sm text-ink-muted hover:text-ink transition">{item.label}</Link></li>)}
            </ul>
          </div>
        </div>

        {/* App download */}
        <div className="mt-14 rounded-[28px] bg-white border border-line p-6 sm:p-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div>
            <h4 className="font-display text-2xl font-semibold tracking-tight text-ink">Book from your phone</h4>
            <p className="text-ink-muted text-[15px] mt-1 max-w-md">Manage your bookings anywhere with the WorkOnTap app.</p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
            <Link href={APP_LINKS.APPLE_STORE} target="_blank" rel="noopener noreferrer" className="sm:w-48 h-14 bg-ink hover:bg-brand-900 text-white rounded-2xl flex items-center px-5 gap-3 transition">
              <svg className="w-7 h-7" viewBox="0 0 384 512" fill="currentColor" aria-hidden="true">
                <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
              </svg>
              <span className="flex flex-col">
                <span className="text-[10px] uppercase font-medium leading-none opacity-75">Available on the</span>
                <span className="text-lg font-semibold leading-tight">App Store</span>
              </span>
            </Link>
            <Link href={APP_LINKS.GOOGLE_PLAY} target="_blank" rel="noopener noreferrer" className="sm:w-48 h-14 bg-ink hover:bg-brand-900 text-white rounded-2xl flex items-center px-5 gap-3 transition">
              <svg className="w-6 h-6" viewBox="0 0 512 512" fill="currentColor" aria-hidden="true">
                <path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z" />
              </svg>
              <span className="flex flex-col">
                <span className="text-[10px] uppercase font-medium leading-none opacity-75">Get it on</span>
                <span className="text-lg font-semibold leading-tight">Google Play</span>
              </span>
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl py-6 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-ink-muted text-center md:text-left">
          <p>© {currentYear} WorkOnTap. All rights reserved.</p>
          <p>
            Website Design and Develop by <a href="https://flymediatech.com" target="_blank" rel="noopener noreferrer" className="text-ink-soft hover:text-ink underline underline-offset-2 decoration-ink/20">Flymedia Technology</a>
          </p>
        </div>
      </div>
    </footer>
  );
}