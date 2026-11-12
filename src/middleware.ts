import { defineMiddleware } from "astro:middleware";
import { defaultLang, getLanguageFromURL, languages } from "./utils/i18n";
import { previewGate } from "./utils/previewGate";

export const onRequest = defineMiddleware(async (context, next) => {
  // Preview deployments only (PREVIEW_PASSWORD unset in production).
  const gate = await previewGate(context.request, process.env.PREVIEW_PASSWORD);
  if (gate) return gate;

  // Get the current language from the URL
  const lang = getLanguageFromURL(context.url.pathname);

  // Store it in locals so it's available to all pages
  context.locals.lang = lang;

  // The [lang]/*.astro routes render on demand, so Astro's getStaticPaths does not limit them: /anything
  // would render the English page with status 200. Answer with the real 404 page for unknown languages.
  if (context.routePattern.startsWith("/[lang]") && !(context.params.lang! in languages && context.params.lang !== defaultLang)) {
    // A 404 response makes Astro render src/pages/404.astro.
    return new Response(null, { status: 404 });
  }

  const response = await next();

  // While the password gate is on, never let the CDN cache a page: a public, s-maxage response
  // would be served to the next visitor without the cookie.
  if (process.env.PREVIEW_PASSWORD) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Cookie");
  }

  // Security headers
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://www.googletagmanager.com https://www.google-analytics.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https: data:",
      "font-src 'self'",
      "connect-src 'self' https://api.frankencoin.com https://www.google-analytics.com https://www.googletagmanager.com https://*.google-analytics.com",
      "frame-src https://www.youtube.com https://youtube.com",
      "media-src 'self'",
    ].join("; "),
  );

  return response;
});
