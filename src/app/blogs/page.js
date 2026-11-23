import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import BookingFormSidebar from '@/components/BookingFormSidebar'
import { ArrowRight, ImageIcon, Newspaper } from 'lucide-react'
import db from '@/lib/db'
import { getSeoForPath } from '@/lib/seo'

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const seo = await getSeoForPath('/blogs');

  return {
    title: seo.title || 'WorkOnTap Blog | Home Maintenance & Trades Insights',
    description: seo.description || 'Discover the latest home service tips, industry trends, and insights from our expert team.',
    keywords: seo.keywords || 'blogs, home services blog, maintenance tips, vancouver trades',
    alternates: {
      canonical: seo.canonical || 'https://workontap.com/blogs',
    },
    openGraph: {
      title: seo.ogTitle || seo.title || 'WorkOnTap Blog',
      description: seo.ogDescription || seo.description,
      url: seo.canonical || 'https://workontap.com/blogs',
      siteName: 'WorkOnTap',
      type: 'website',
      images: seo.ogImage ? [{ url: seo.ogImage }] : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: seo.ogTitle || seo.title || 'WorkOnTap Blog',
      description: seo.ogDescription || seo.description,
      images: seo.ogImage ? [seo.ogImage] : [],
    },
  };
}

async function getBlogs() {
  try {
    const rows = await db.query('SELECT * FROM blogs WHERE is_published = 1 ORDER BY created_at DESC')
    return rows || []
  } catch (error) {
    console.error('Error fetching blogs:', error)
    return []
  }
}

export default async function BlogsPage({ searchParams }) {
  const resolvedSearchParams = await searchParams
  const currentPage = parseInt(resolvedSearchParams?.page) || 1
  const PAGE_SIZE = 6

  const allBlogs = await getBlogs()
  const totalPages = Math.ceil(allBlogs.length / PAGE_SIZE)
  
  const startIndex = (currentPage - 1) * PAGE_SIZE
  const endIndex = startIndex + PAGE_SIZE
  const blogs = allBlogs.slice(startIndex, endIndex)

  return (
    <div className="min-h-screen bg-white font-sans antialiased text-ink overflow-x-hidden flex flex-col">
      <Header />

      <main className="flex-grow bg-white pb-20">
        {/* Hero */}
        <section className="bg-paper border-b border-line mb-12 lg:mb-16">
          <div className="container mx-auto px-5 sm:px-6 max-w-7xl py-14 lg:py-20">
            <p className="text-xs font-bold tracking-[0.16em] uppercase text-brand-600 mb-3">Insights & News</p>
            <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] font-semibold tracking-[-0.025em] text-ink mb-4">
              Our <span className="text-brand-600">Blog</span>
            </h1>
            <p className="text-lg text-ink-soft leading-relaxed max-w-2xl">
              Discover the latest home service tips, industry trends, and insights from our expert team.
            </p>
          </div>
        </section>

        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <div className="flex flex-col lg:flex-row gap-10">
          {/* Left Column: Blog Grid */}
          <div className="flex-grow lg:w-2/3 min-w-0">
            {blogs.length > 0 ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {blogs.map((blog) => (
                    <Link href={`/blogs/${blog.slug || blog.id}`} key={blog.id} className="group flex flex-col bg-white rounded-[28px] border border-line overflow-hidden hover:shadow-lift transition-shadow">
                      <div className="relative aspect-[16/10] w-full overflow-hidden bg-paper">
                        {blog.image_url ? (
                          <img
                            src={blog.image_url}
                            alt={blog.title}
                            className="w-full h-full object-cover transition duration-700 group-hover:scale-[1.04]"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-ink-muted/50 bg-paper">
                            <ImageIcon className="w-12 h-12" strokeWidth={1} aria-hidden="true" />
                          </div>
                        )}
                        <div className="absolute top-4 left-4">
                          <span className="px-3 py-1 bg-white/95 backdrop-blur-md text-brand-700 text-[11px] font-bold rounded-full uppercase tracking-[0.16em] border border-line">
                            Article
                          </span>
                        </div>
                      </div>
                      <div className="p-6 flex flex-col flex-grow">
                        <div className="flex items-center gap-2 text-xs font-medium text-ink-muted mb-3 min-w-0">
                          <span className="shrink-0">{new Date(blog.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                          <span className="w-1 h-1 rounded-full bg-line shrink-0"></span>
                          <span className="truncate">By {blog.author || 'Admin'}</span>
                        </div>
                        <h2 className="font-display text-xl font-semibold tracking-tight text-ink mb-2 line-clamp-2 group-hover:text-brand-700 transition-colors">
                          {blog.title}
                        </h2>
                        <p className="text-sm text-ink-muted leading-relaxed line-clamp-2 mb-5 flex-grow">
                          {blog.meta_description || 'Click to read more about this topic...'}
                        </p>
                        <div className="mt-auto inline-flex items-center gap-1.5 font-semibold text-ink group-hover:text-brand-700 transition">
                          Read Article
                          <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="mt-10 flex flex-wrap justify-center items-center gap-2">
                    {currentPage > 1 && (
                      <Link href={`/blogs?page=${currentPage - 1}`} className="px-4 py-2 border border-line rounded-full text-sm font-semibold text-ink hover:border-ink/40 transition">
                        Previous
                      </Link>
                    )}
                    
                    <div className="flex gap-1">
                      {Array.from({ length: totalPages }).map((_, i) => {
                        const pageNum = i + 1;
                        if (pageNum === 1 || pageNum === totalPages || (pageNum >= currentPage - 1 && pageNum <= currentPage + 1)) {
                          return (
                            <Link 
                              key={pageNum} 
                              href={`/blogs?page=${pageNum}`}
                              className={`w-10 h-10 flex items-center justify-center rounded-full text-sm font-semibold transition ${
                                currentPage === pageNum ? 'bg-ink text-white' : 'text-ink-soft hover:bg-paper hover:text-ink'
                              }`}
                            >
                              {pageNum}
                            </Link>
                          );
                        } else if (
                          (pageNum === currentPage - 2 && pageNum > 1) || 
                          (pageNum === currentPage + 2 && pageNum < totalPages)
                        ) {
                          return <span key={pageNum} className="w-10 h-10 flex items-center justify-center text-ink-muted">...</span>;
                        }
                        return null;
                      })}
                    </div>

                    {currentPage < totalPages && (
                      <Link href={`/blogs?page=${currentPage + 1}`} className="px-4 py-2 border border-line rounded-full text-sm font-semibold text-ink hover:border-ink/40 transition">
                        Next
                      </Link>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-20 rounded-[28px] border border-line bg-paper">
                <span className="mx-auto h-11 w-11 rounded-2xl bg-white border border-line text-brand-600 flex items-center justify-center mb-4">
                  <Newspaper className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="font-display text-xl font-semibold text-ink mb-2">No articles found</h3>
                <p className="text-ink-muted">Check back later for new updates and insights.</p>
              </div>
            )}
          </div>

          {/* Right Column: Sidebar */}
          <div className="w-full lg:w-1/3">
            <BookingFormSidebar />
          </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
