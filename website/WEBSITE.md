# Maya AutoPilot - Website Checklist

## SEO & Meta
- [x] Title tag optimized
- [x] Meta description added
- [x] Meta keywords added
- [x] Canonical URL set
- [x] Open Graph tags (og:title, og:description, og:image, og:type, og:url)
- [x] Twitter Card tags (twitter:card, twitter:title, twitter:description, twitter:image)
- [x] JSON-LD structured data (SoftwareApplication schema)
- [x] Robots meta tag
- [x] Favicon linked (PNG 128x128)

## Favicon & Icons
- [x] Favicon PNG created from extension icons
- [x] Favicon linked in head with rel="icon"
- [x] Apple touch icon / PWA ready (optional)

## Technical Files
- [x] sitemap.xml created and referenced
- [x] robots.txt created and referenced
- [x] .nojekyll file present (for GitHub Pages Jekyll bypass)
- [x] CNAME file present (if using custom domain)

## Content & Layout
- [x] Hero section with heading, description, meta badges
- [x] Download section with CTA button and illustration
- [x] How to Use section (zigzag layout)
- [x] Setup section (5 steps)
- [x] What It Does section (feature cards)
- [x] What I Used section (tech stack cards)
- [x] Common Fixes section (troubleshooting grid)
- [x] Contributors section (zigzag layout)
- [x] Report Issues section (zigzag layout)
- [x] Contribute section (zigzag layout)
- [x] Footer with end illustration and credits

## Images & Assets
- [x] hero.png
- [x] at download.png
- [x] how to use.png
- [x] contibutons.png
- [x] issues.png
- [x] community.png
- [x] end of the page.png
- [x] favicon.png

## GitHub Actions / Deployment
- [x] .github/workflows/build-and-deploy.yml creates zip
- [x] Workflow copies website/ to publish/
- [x] Workflow deploys to gh-pages branch
- [x] GitHub Pages enabled on repo (Settings → Pages → gh-pages)
- [x] assets/ folder included in deployment

## Extension Files
- [x] manifest.json
- [x] background.js (Firebase + OpenRouter AI)
- [x] content.js
- [x] firebase-config.js
- [x] hook.js
- [x] hook-injected.js
- [x] popup.html
- [x] popup.js
- [x] questions-template.json
- [x] README.md
- [x] setup.txt
- [x] icons/ (16, 48, 128)

## Security
- [x] OpenRouter API key moved to Firebase Firestore
- [x] Model selection loaded from Firebase
- [x] No hardcoded secrets in repo

## Responsive Design
- [x] Mobile breakpoint at 900px
- [x] Zigzag layouts stack vertically on mobile
- [x] Download bar stacks on mobile
- [x] Hero stacks on mobile
- [x] Touch-friendly tap targets
