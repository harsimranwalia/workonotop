import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);

  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

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