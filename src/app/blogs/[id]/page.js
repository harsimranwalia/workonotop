import { notFound } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import BookingFormSidebar from '@/components/BookingFormSidebar'
import { ArrowLeft } from 'lucide-react'
import db from '@/lib/db'
import { getSeoForPath } from '@/lib/seo'

export const dynamic = 'force-dynamic';

// Dynamically generate SEO metadata for the blog post
export async function generateMetadata({ params }) {
  const { id } = await params
  const seo = await getSeoForPath(`/blogs/${id}`)
  
  try {
    const rows = await db.query(
      'SELECT * FROM blogs WHERE (id = ? OR slug = ?) AND is_published = 1 LIMIT 1',
      [id, id]
    )
    
    if (!rows || rows.length === 0) {
      return {
        title: seo.title || 'Blog Not Found | WorkOnTap',
        description: seo.description || 'The requested article could not be found.',
      }
    }

    const blog = rows[0]
    const title = blog.meta_title || seo.title || `${blog.title} | WorkOnTap Blog`
    const description = blog.meta_description || seo.description || blog.short_content || blog.title
    const keywords = blog.keywords || seo.keywords || ''
    const ogImage = blog.og_image || blog.image_url || seo.ogImage
    const canonical = blog.canonical_url || seo.canonical || `https://workontap.com/blogs/${blog.slug || blog.id}`
    
    return {
      title,
      description,
      keywords,
      alternates: {
        canonical,
      },
      openGraph: {
        title: blog.og_title || seo.ogTitle || title,
        description: blog.og_description || seo.ogDescription || description,
        images: ogImage ? [{ url: ogImage }] : [],
        type: 'article',
        publishedTime: blog.created_at,
        authors: [blog.author || 'WorkOnTap Team'],
        url: canonical,
        siteName: 'WorkOnTap',
      },
      twitter: {
        card: 'summary_large_image',
        title: blog.og_title || seo.ogTitle || title,
        description: blog.og_description || seo.ogDescription || description,
        images: ogImage ? [ogImage] : [],
      },
    }
  } catch (error) {
    return {
      title: seo.title || 'Blog Article | WorkOnTap',
      description: seo.description,
    }
  }
}

async function getBlog(id) {
  try {
    const rows = await db.query(
      'SELECT * FROM blogs WHERE (id = ? OR slug = ?) AND is_published = 1 LIMIT 1',
      [id, id]
    )
    return rows && rows.length > 0 ? rows[0] : null
  } catch (error) {
    console.error('Error fetching single blog:', error)
    return null
  }
}

export default async function SingleBlogPage({ params }) {
  const { id } = await params
  const blog = await getBlog(id)

  if (!blog) {
    notFound()
  }

  // Define custom styles for CKEditor content
  const contentStyles = `
    .ck-content {
      line-height: 1.75;
      color: #3C4842;
      font-size: 1.0625rem;
      overflow-wrap: anywhere;
    }
    .ck-content h2 {
      font-family: var(--font-outfit), var(--font-geist-sans), sans-serif;
      font-size: 1.75rem;
      line-height: 1.2;
      font-weight: 600;
      letter-spacing: -0.01em;
      color: #0F1A14;
      margin-top: 2.5rem;
      margin-bottom: 1rem;
    }
    .ck-content h3 {
      font-family: var(--font-outfit), var(--font-geist-sans), sans-serif;
      font-size: 1.375rem;
      font-weight: 600;
      color: #0F1A14;
      margin-top: 2rem;
      margin-bottom: 0.75rem;
    }
    .ck-content p {
      margin-bottom: 1.25rem;
    }
    .ck-content ul {
      list-style-type: disc;
      padding-left: 1.5rem;
      margin-bottom: 1.25rem;
    }
    .ck-content ol {
      list-style-type: decimal;
      padding-left: 1.5rem;
      margin-bottom: 1.25rem;
    }
    .ck-content li {
      margin-bottom: 0.5rem;
    }
    .ck-content li::marker {
      color: #15843E;
    }
    .ck-content a {
      color: #0F6B32;
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .ck-content blockquote {
      border-left: 3px solid #16A34A;
      color: #3C4842;
      background-color: #F7F6F2;
      padding: 1rem 1.25rem;
      border-radius: 0 1rem 1rem 0;
      margin: 1.5rem 0;
    }
    .ck-content img {
      max-width: 100%;
      height: auto;
      border-radius: 1.5rem;
      margin: 1.5rem 0;
    }
    .ck-content table {
      display: block;
      max-width: 100%;
      overflow-x: auto;
    }
  `

  return (
    <div className="min-h-screen bg-white font-sans antialiased text-ink overflow-x-hidden flex flex-col">
      <Header />

      <main className="flex-grow bg-white pb-20">
        {/* Hero */}
        <section className="bg-paper border-b border-line">
          <div className="container mx-auto px-5 sm:px-6 max-w-7xl pt-10 pb-12 lg:pt-14 lg:pb-16">
            <Link href="/blogs" className="text-ink-soft hover:text-ink font-semibold text-sm inline-flex items-center gap-1.5 group mb-8 transition-colors">
              <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
              Back to Articles
            </Link>
            <p className="text-xs font-bold tracking-[0.16em] uppercase text-brand-600 mb-3">Article</p>
            <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] font-semibold tracking-[-0.025em] text-ink mb-6 max-w-4xl text-balance break-words">
              {blog.title}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-ink-soft text-sm font-medium">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 shrink-0 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center font-bold">
                  {blog.author?.charAt(0) || 'A'}
                </div>
                <span className="text-ink truncate">{blog.author || 'Admin'}</span>
              </div>
              <span className="w-1 h-1 rounded-full bg-ink-muted/50"></span>
              <time dateTime={blog.created_at}>
                {new Date(blog.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </time>
            </div>
          </div>
        </section>

        <div className="container mx-auto px-5 sm:px-6 max-w-7xl pt-10 lg:pt-14">
          <div className="flex flex-col lg:flex-row gap-10 lg:gap-14">
            {/* Left Column: Article */}
            <div className="flex-grow lg:w-2/3 min-w-0">
              <article className="w-full">
                {blog.image_url && (
                  <div className="overflow-hidden rounded-[32px] aspect-[16/9] bg-paper mb-10">
                    <img
                      src={blog.image_url}
                      alt={blog.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                {/* Content (from CKEditor) */}
                <div 
                  className="ck-content prose prose-lg max-w-3xl"
                  dangerouslySetInnerHTML={{ __html: blog.content }}
                />
              </article>
            </div>

            {/* Right Column: Sidebar */}
            <div className="w-full lg:w-1/3">
              <BookingFormSidebar />
            </div>
          </div>
        </div>

        {/* Custom Styles Injection */}
        <style dangerouslySetInnerHTML={{ __html: contentStyles }} />
        
        {/* Header/Footer Custom Scripts (from SEO) */}
        {blog.header_scripts && (
          <div dangerouslySetInnerHTML={{ __html: blog.header_scripts }} />
        )}
        {blog.footer_scripts && (
          <div dangerouslySetInnerHTML={{ __html: blog.footer_scripts }} />
        )}
      </main>

      <Footer />
    </div>
  )
}
