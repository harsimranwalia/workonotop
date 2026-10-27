'use client';

import Footer from '@/components/Footer';
import Header from '@/components/Header';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import DirectoryListing from '@/components/DirectoryListing';
import { ArrowUpRight, ChevronLeft, ChevronRight, CreditCard, Search, ShieldCheck, Tag } from 'lucide-react';
import { categoryImage, serviceImage } from '@/lib/service-images';

const PAGE_SIZE = 8;

// Pagination Component
function Pagination({ total, page, setPage }) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...');
    }
  }

  if (totalPages <= 1) return null;

  const step = 'w-11 h-11 rounded-full flex items-center justify-center transition border';
  return (
    <nav aria-label="Pages" className="flex items-center justify-center mt-12 gap-2">
      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} aria-label="Previous page"
        className={`${step} ${page === 1 ? 'border-line text-ink-muted/40 cursor-not-allowed' : 'border-line bg-white text-ink hover:border-ink/40'}`}>
        <ChevronLeft className="w-5 h-5" />
      </button>
      {pages.map((p, i) => (
        p === '...'
          ? <span key={`e-${i}`} className="w-8 text-center text-ink-muted">…</span>
          : <button key={p} onClick={() => setPage(p)} aria-current={page === p ? 'page' : undefined}
            className={`${step} font-semibold ${page === p ? 'bg-ink border-ink text-white' : 'bg-white border-line text-ink-soft hover:border-ink/40'}`}>
            {p}
          </button>
      ))}
      <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} aria-label="Next page"
        className={`${step} ${page === totalPages ? 'border-line text-ink-muted/40 cursor-not-allowed' : 'border-line bg-white text-ink hover:border-ink/40'}`}>
        <ChevronRight className="w-5 h-5" />
      </button>
    </nav>
  );
}

const METRO_VANCOUVER_LOCATIONS = [
  { name: 'All Locations', slug: 'all' },
  { name: 'Vancouver', slug: 'vancouver' },
  { name: 'Surrey', slug: 'surrey' },
  { name: 'Burnaby', slug: 'burnaby' },
  { name: 'Richmond', slug: 'richmond' },
  { name: 'Coquitlam', slug: 'coquitlam' },
  { name: 'Langley Township', slug: 'langley-township' },
  { name: 'Delta', slug: 'delta' },
  { name: 'Maple Ridge', slug: 'maple-ridge' },
  { name: 'North Vancouver District', slug: 'north-vancouver-district' },
  { name: 'New Westminster', slug: 'new-westminster' },
  { name: 'Port Coquitlam', slug: 'port-coquitlam' },
  { name: 'North Vancouver City', slug: 'north-vancouver-city' },
  { name: 'West Vancouver', slug: 'west-vancouver' },
  { name: 'Port Moody', slug: 'port-moody' },
  { name: 'Langley City', slug: 'langley-city' },
  { name: 'Pitt Meadows', slug: 'pitt-meadows' },
  { name: 'White Rock', slug: 'white-rock' },
  { name: 'Metro Vancouver', slug: 'metro-vancouver' }
];

export default function ServicesClientPage({ 
  initialServices = [], 
  initialCategories = [], 
  initialDirectoryItems = [] 
}) {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedLocation, setSelectedLocation] = useState('vancouver');
  const [searchTerm, setSearchTerm] = useState('');
  const [services, setServices] = useState(Array.isArray(initialServices) ? initialServices : []);
  const [categories, setCategories] = useState(Array.isArray(initialCategories) ? initialCategories : []);
  const [loading, setLoading] = useState(!Array.isArray(initialServices) || initialServices.length === 0);
  const [placeholder, setPlaceholder] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [loopNum, setLoopNum] = useState(0);
  const [typingSpeed, setTypingSpeed] = useState(100);
  const [page, setPage] = useState(1);

  const searchExamples = [
    'mount tv on wall',
    'fix leaky faucet',
    'install ceiling fan',
    'clean carpets',
    'repair dryer',
    'paint living room',
  ];

  const handleSearchClick = () => {
    const searchArea = document.getElementById('search-container');
    if (searchArea) {
      const yOffset = -120;
      const y = searchArea.getBoundingClientRect().top + window.scrollY + yOffset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    } else {
      window.scrollBy({ top: 150, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (!initialServices || initialServices.length === 0) {
      fetchData();
    }
    // Parse query params for search term passed from the Home Page
    const params = new URLSearchParams(window.location.search);
    const searchParam = params.get('search');
    if (searchParam) {
      setSearchTerm(searchParam);
      // Automatically scroll down to the search area
      setTimeout(() => {
        const searchArea = document.getElementById('search-container');
        if (searchArea) {
          const yOffset = -120;
          const y = searchArea.getBoundingClientRect().top + window.scrollY + yOffset;
          window.scrollTo({ top: y, behavior: 'smooth' });
        }
      }, 500);
    }
  }, []);

  useEffect(() => {
    setPage(1);
  }, [activeCategory, searchTerm, selectedLocation]);

  // The homepage links here with ?category=cleaning | movers | handyman; a category's own slug works too.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('category');
    if (!wanted || categories.length === 0) return;
    const key = wanted.toLowerCase().replace(/^movers$/, 'moving');
    const match = categories.find((c) => (c.slug || '').toLowerCase() === key)
      || categories.find((c) => (c.slug || '').toLowerCase().startsWith(key) || (c.name || '').toLowerCase().startsWith(key));
    if (match) setActiveCategory(match.id.toString());
  }, [categories]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const servicesRes = await fetch('/api/services', { cache: 'no-store' });
      const categoriesRes = await fetch('/api/categories', { cache: 'no-store' });

      if (servicesRes.ok) {
        const sText = await servicesRes.text();
        if (sText) {
          const servicesData = JSON.parse(sText);
          if (servicesData.success) {
            setServices(servicesData.data || []);
          }
        }
      }

      if (categoriesRes.ok) {
        const cText = await categoriesRes.text();
        if (cText) {
          const categoriesData = JSON.parse(cText);
          if (categoriesData.success) {
            setCategories(categoriesData.data || []);
          }
        }
      }
    } catch (error) {
      console.error('Error loading data in fetchData:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let timer;
    const handleTyping = () => {
      const i = loopNum % searchExamples.length;
      const fullText = searchExamples[i];

      if (!isDeleting) {
        setPlaceholder(fullText.substring(0, placeholder.length + 1));
        setTypingSpeed(80);
      } else {
        setPlaceholder(fullText.substring(0, placeholder.length - 1));
        setTypingSpeed(40);
      }

      if (!isDeleting && placeholder === fullText) {
        setTimeout(() => setIsDeleting(true), 2000);
      } else if (isDeleting && placeholder === '') {
        setIsDeleting(false);
        setLoopNum(loopNum + 1);
        setTypingSpeed(80);
      }
    };

    timer = setTimeout(handleTyping, typingSpeed);
    return () => clearTimeout(timer);
  }, [placeholder, isDeleting, loopNum, typingSpeed, searchExamples]);

  const filteredServices = services.filter(service => {
    const matchesCategory = activeCategory === 'all' ||
      service.category_id === parseInt(activeCategory);

    const matchesSearch = searchTerm === '' ||
      service.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (service.short_description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (service.description || '').toLowerCase().includes(searchTerm.toLowerCase());

    let matchesLocation = true;
    if (selectedLocation !== 'all') {
      const cityKeywords = [
        'vancouver', 'surrey', 'burnaby', 'richmond', 'coquitlam',
        'langley', 'delta', 'maple ridge', 'new westminster',
        'port coquitlam', 'west vancouver', 'port moody',
        'pitt meadows', 'white rock', 'north vancouver', 'metro vancouver'
      ];

      const getBaseCity = (slug) => {
        if (slug.includes('langley')) return 'langley';
        if (slug.includes('north-vancouver')) return 'north vancouver';
        if (slug === 'west-vancouver') return 'west vancouver';
        if (slug === 'port-coquitlam') return 'port coquitlam';
        if (slug === 'port-moody') return 'port moody';
        if (slug === 'pitt-meadows') return 'pitt meadows';
        if (slug === 'maple-ridge') return 'maple ridge';
        if (slug === 'new-westminster') return 'new westminster';
        if (slug === 'white-rock') return 'white rock';
        if (slug === 'metro-vancouver') return 'metro vancouver';
        return slug;
      };

      const baseCity = getBaseCity(selectedLocation);

      const hasOtherLocation = cityKeywords.some(city => {
        if (city === baseCity) return false;

        const serviceNameLower = service.name.toLowerCase();

        if (serviceNameLower.includes(city)) {
          if (city === 'vancouver' &&
            (serviceNameLower.includes('north vancouver') ||
              serviceNameLower.includes('west vancouver') ||
              serviceNameLower.includes('metro vancouver'))) {
            return false;
          }
          if (city === 'coquitlam' && serviceNameLower.includes('port coquitlam')) {
            return false;
          }
          return true;
        }
        return false;
      });

      if (hasOtherLocation) {
        matchesLocation = false;
      }
    }

    return matchesCategory && matchesSearch && matchesLocation;
  });

  const startIndex = (page - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const pagedServices = filteredServices.slice(startIndex, endIndex);

  const filterCategories = [
    { id: 'all', name: 'All Services', icon: '✨', image_url: null },
    ...categories.map(cat => ({
      id: cat.id.toString(),
      name: cat.name,
      icon: cat.icon || '🛠️',
      image_url: categoryImage(cat)
    }))
  ];

  if (loading && services.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-10 h-10 border-[3px] border-brand-500/20 border-t-brand-500 rounded-full animate-spin" />
      </div>
    );
  }

  const getImageUrl = (url) => url && !url.startsWith('http') && !url.startsWith('/') ? '/uploads/' + url : url;
  const activeName = activeCategory === 'all' ? null : categories.find(c => c.id === parseInt(activeCategory))?.name;

  return (
    <div className="min-h-screen bg-white font-sans antialiased text-ink">
      <Header />

      {/* Hero */}
      <section className="relative bg-paper border-b border-line overflow-hidden">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl pt-12 pb-10 lg:pt-16 lg:pb-14 grid lg:grid-cols-[1.1fr_0.9fr] gap-10 items-center">
          <div>
            <p className="text-xs font-bold tracking-[0.16em] uppercase text-brand-600 mb-3">Metro Vancouver</p>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-[56px] leading-[1.05] font-semibold tracking-[-0.025em] text-ink mb-4">
              Every service, <span className="text-brand-600">priced before you book.</span>
            </h1>
            <p className="text-lg text-ink-soft leading-relaxed max-w-xl mb-8">
              Cleaning, moving help and handyman work. Pick a service, answer a few questions, and see the price on screen. Your card is not charged until the job is done.
            </p>
            <div id="search-container" className="max-w-xl">
              <div className="flex items-center gap-2 bg-white border border-line rounded-2xl p-1.5 pl-4 shadow-card focus-within:border-ink/40 focus-within:ring-4 focus-within:ring-brand-500/10 transition">
                <Search className="w-5 h-5 shrink-0 text-ink-muted" aria-hidden="true" />
                <input
                  type="text"
                  aria-label="Search services"
                  placeholder={placeholder || 'What do you need?'}
                  className="min-w-0 w-full bg-transparent border-none outline-none text-ink placeholder:text-ink-muted text-base py-2.5"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <button onClick={handleSearchClick} className="shrink-0 bg-ink text-white font-semibold px-5 sm:px-6 py-2.5 rounded-xl hover:bg-brand-900 transition active:scale-95">
                  Find Pros
                </button>
              </div>
            </div>
          </div>
          <div className="hidden lg:grid grid-cols-3 gap-3" aria-hidden="true">
            {['regular-house-cleaning', 'tv-and-wall-mounting', 'moving-help'].map((name, i) => (
              <div key={name} className={`overflow-hidden rounded-[24px] aspect-[3/4] ${i === 1 ? 'translate-y-8' : ''}`}>
                <img src={`/images/services/${name}.jpg`} alt="" className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Category Navigation */}
      <section id="services-listing" className="sticky top-[72px] z-30 bg-white/90 backdrop-blur-md border-b border-line">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <div className="flex gap-2 overflow-x-auto no-scrollbar py-3.5">
            {filterCategories.map((category) => {
              const active = activeCategory === category.id;
              return (
                <button
                  key={category.id}
                  onClick={() => setActiveCategory(category.id)}
                  aria-pressed={active}
                  className={`shrink-0 inline-flex items-center gap-2 pl-1.5 pr-4 py-1.5 rounded-full text-sm font-semibold border transition ${active
                    ? 'bg-ink border-ink text-white'
                    : 'bg-white border-line text-ink-soft hover:border-ink/40'
                  }`}
                >
                  {category.image_url ? (
                    <img src={getImageUrl(category.image_url)} alt="" className="w-7 h-7 rounded-full object-cover" />
                  ) : (
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center ${active ? 'bg-white/15' : 'bg-paper'}`}>✦</span>
                  )}
                  <span>{category.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Services Listing */}
      <section className="py-12 lg:py-16">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <div className="flex items-end justify-between gap-6 mb-8">
            <div>
              <h2 className="font-display text-3xl font-semibold tracking-tight text-ink">
                {activeName || (searchTerm ? `Results for "${searchTerm}"` : 'All Services')}
              </h2>
              <p className="text-ink-muted mt-1">
                {filteredServices.length} {filteredServices.length === 1 ? 'service' : 'services'}
              </p>
            </div>
          </div>

          {filteredServices.length > 0 ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-5 gap-y-10">
                {pagedServices.map((service, idx) => {
                  const category = categories.find(c => c.id === service.category_id);
                  return (
                    <Link key={`${service.id}-${idx}`} href={`/services/${service.slug}`} className="group flex flex-col">
                      <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-paper-deep">
                        <img
                          src={getImageUrl(serviceImage({ ...service, category_name: category?.name }))}
                          alt=""
                          loading="lazy"
                          className="w-full h-full object-cover transition duration-700 group-hover:scale-[1.04]"
                        />
                        {category?.name && (
                          <span className="absolute top-3 left-3 bg-white/95 backdrop-blur px-3 py-1 rounded-full text-xs font-semibold text-ink-soft">
                            {category.name}
                          </span>
                        )}
                      </div>
                      <div className="pt-4 flex-1 flex flex-col">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-lg font-semibold text-ink leading-snug">{service.name}</h3>
                          <ArrowUpRight className="w-5 h-5 mt-0.5 shrink-0 text-ink-muted transition group-hover:text-brand-600 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
                        </div>
                        <p className="text-ink-muted text-sm mt-1.5 line-clamp-2 leading-relaxed">
                          {service.short_description || 'Book online and see the price before you confirm.'}
                        </p>
                        <p className="mt-3 text-sm text-ink-soft">
                          From <span className="font-semibold text-ink">${parseFloat(service.base_price || 0).toFixed(0)}</span>
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>

              <Pagination total={filteredServices.length} page={page} setPage={setPage} />
            </>
          ) : (
            <div className="text-center py-24 px-6 bg-paper rounded-[32px] border border-line">
              <Search className="w-10 h-10 mx-auto text-ink-muted mb-5" aria-hidden="true" />
              <h3 className="font-display text-2xl font-semibold text-ink mb-3">No services found</h3>
              <p className="text-ink-muted mb-8 max-w-md mx-auto">We couldn&apos;t find any results matching your search. Try a different term or clear filters.</p>
              <button
                onClick={() => { setActiveCategory('all'); setSearchTerm(''); }}
                className="bg-ink text-white font-semibold px-7 py-3.5 rounded-2xl hover:bg-brand-900 transition active:scale-95"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      </section>

      {/* What every booking comes with */}
      <section className="py-14 bg-paper border-y border-line">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            { icon: Tag, title: 'Your price before you book', desc: 'Worked out from your answers and shown on screen at every step.' },
            { icon: CreditCard, title: 'Pay when the job is done', desc: 'Your card is held at booking and charged only after the work is finished.' },
            { icon: ShieldCheck, title: 'Protection Promise', desc: 'Not happy with the work? Tell us within 48 hours and we will make it right.' },
          ].map(({ icon: ItemIcon, title, desc }) => (
            <div key={title} className="flex gap-4">
              <span className="h-11 w-11 shrink-0 rounded-2xl bg-white border border-line text-brand-600 flex items-center justify-center">
                <ItemIcon className="w-5 h-5" aria-hidden="true" />
              </span>
              <div>
                <h4 className="font-semibold text-ink mb-1">{title}</h4>
                <p className="text-sm text-ink-muted leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Directory Link Section */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-ink mb-2">Services by city</h2>
          <p className="text-ink-muted mb-10 max-w-2xl">Every service, in every part of Metro Vancouver we cover.</p>
          <DirectoryListing initialItems={initialDirectoryItems} />
        </div>
      </section>

      <Footer initialServices={services} />

      <style jsx>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.8s ease-out forwards; }
      `}</style>
    </div>
  );
}
