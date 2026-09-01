import React from "react";

// React 19 hoists <title>/<meta>/<link> rendered anywhere in the tree into
// the document <head> automatically -- no react-helmet-async dependency
// needed. Every route previously shared the one static <head> in
// public/index.html (homepage-only title/description/OG/canonical); this
// gives each route its own, still reusing the site's existing copy rather
// than inventing new marketing claims.
export default function Seo({ title, description, path = "" }) {
  const url = `https://xaucloud.io${path}`;
  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
    </>
  );
}
