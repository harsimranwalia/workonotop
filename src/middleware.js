import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { linkPageKind, linkPagePolicy } from "@/lib/link-pages";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// A fresh nonce for one response: 16 random bytes as base64.
function newNonce() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);

  // A job link or a card link page is answered with a Content-Security-Policy that carries a nonce made for this response. The policy is also put on the
  // request, which is how Next finds the nonce and puts it on its own inline scripts (src/lib/link-pages.js says what the policy allows).
  const linkKind = linkPageKind(pathname);
  const policy = linkKind ? linkPagePolicy(linkKind, newNonce(), { production: process.env.NODE_ENV === "production" }) : null;
  if (policy) requestHeaders.set("Content-Security-Policy", policy);

  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  if (policy) response.headers.set("Content-Security-Policy", policy);

  // ✅ 1. Admin routes protection
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const token = request.cookies.get("adminAuth")?.value;

    if (!token) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }

    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      // Any validly signed token used to pass; a customer's or provider's token copied into this cookie is not an admin's.
      if (payload.role !== "admin") throw new Error("not an admin token");
    } catch {
      response = NextResponse.redirect(new URL("/admin/login", request.url));
      response.cookies.set("adminAuth", "", { maxAge: 0 });
      return response;
    }
  }

  // ✅ 2. Restricted status check for logged in users (Provider/Customer)
  const providerToken = request.cookies.get("provider_token")?.value;
  const customerToken = request.cookies.get("customer_token")?.value;
  const token = providerToken || customerToken;

  if (token) {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      if (payload.status === 'pending_deletion' || payload.status === 'deleted') {
        // If it's a page request (not logout), redirect to a restricted notice page if you have one
        // or just let it through if you don't have a specific blocking page yet.
      }
    } catch (err) {
      // Token invalid, ignore
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};