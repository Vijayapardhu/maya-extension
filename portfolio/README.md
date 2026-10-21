# Vijayapardhu — Portfolio Site

A standalone, single-page portfolio built to rank for **Vijayapardhu** and
**Vijaya Pardhu**. It is intentionally separate from the Maya extension site.

## What is included

- One `<h1>` containing the name, plus the name in the header wordmark.
- Name variants in the visible copy (`Vijayapardhu`, `Vijaya Pardhu`) and in
  JSON-LD `alternateName`.
- `Person`, `WebSite`, and `ProfilePage` structured data.
- Canonical URL, Open Graph, Twitter Card, and a generated `og.png`.
- `robots.txt` and `sitemap.xml`.
- Semantic landmarks, skip link, keyboard focus styles, and reduced-motion
  support.
- No external fonts, scripts, or frameworks — fast by default.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The portfolio page and all styles |
| `og.png` | 1200×630 social preview image |
| `favicon.svg` | Browser icon |
| `robots.txt` | Crawler rules + sitemap location |
| `sitemap.xml` | Single-page sitemap |

## Deploy

This folder is **not** deployed by the extension's GitHub Actions workflow,
which only publishes `website/`. Deploy it separately:

### Option A — GitHub Pages (recommended for `vijayapardhu.dev`)

1. Create a new repository, e.g. `vijayapardhu-portfolio`.
2. Copy the contents of this folder to the repository root.
3. Push to `main`.
4. In **Settings → Pages**, deploy from the `main` branch root.
5. In **Settings → Pages → Custom domain**, enter `vijayapardhu.dev` and enable
   HTTPS.
6. Add the DNS records GitHub shows you at your domain registrar.

### Option B — Netlify / Vercel / Cloudflare Pages

Drag this folder into the dashboard, or connect the repository and set the
publish directory to `portfolio`.

## After deploying

1. Confirm `https://vijayapardhu.dev/` loads over HTTPS.
2. Submit `https://vijayapardhu.dev/sitemap.xml` in
   [Google Search Console](https://search.google.com/search-console) and
   [Bing Webmaster Tools](https://www.bing.com/webmasters).
3. Request indexing for the homepage.
4. Add the site to your GitHub profile README and other profiles as
   `https://vijayapardhu.dev/`.
5. Test the structured data with the
   [Rich Results Test](https://search.google.com/test/rich-results).

## Customize

- **GitHub links** — already point to `https://github.com/Vijayapardhu`.
- **Email / LinkedIn** — add them to the contact section if you want them
  public, then add the URLs to `sameAs` in the JSON-LD.
- **Projects** — replace the three capability cards with real project write-ups
  when they are ready. Each project should get its own page with a unique title,
  description, and canonical URL.
- **Domain** — if you deploy somewhere other than `vijayapardhu.dev`, update
  every `https://vijayapardhu.dev/` occurrence in `index.html`, `robots.txt`,
  and `sitemap.xml`.

## Scope

This page targets name searches such as **Vijayapardhu**, **Vijaya Pardhu**,
and **Vijayaapardhu**. It does not target the Maya extension or assessment
keywords. If you want the Maya project to rank under your name, the
auto-answer/auto-submit behavior has to be removed first; a navigation,
accessibility, or post-test study tool can then be optimized normally.
