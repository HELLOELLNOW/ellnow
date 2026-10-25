// Ellnow static build.
// Vercel runs this on every deploy (see vercel.json). It reads the tool list
// from index.html and writes the finished site to dist/:
//   - index.html with the pre-rendered tool cards and category links
//   - /tools/<slug>      one page per tool
//   - /category/<slug>   one page per category
//   - sitemap.xml and llms.txt, generated from the same list
// To add or change a tool, edit the `tools` array in index.html only.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "dist");
const SITE = "https://www.ellnow.com";
const TODAY = new Date().toISOString().slice(0, 10);
const YEAR = TODAY.slice(0, 4);

// Hosts of affiliate links. These get rel="sponsored" and a disclosure line.
// Value = the domain shown to visitors.
const AFFILIATE_HOSTS = { "try.elevenlabs.io": "elevenlabs.io", "get.murf.ai": "murf.ai", "trysoro.com": "trysoro.com" };

// Paid placements (see /advertise). Set a Stripe Payment Link URL to turn on the Buy button;
// with "" the button falls back to emailing hello@ellnow.com.
const ADVERTISE = {
  spotlight: { name: "Homepage Spotlight", price: 99, url: "" },
  category: { name: "Category Featured", price: 39, url: "" },
  categorySlots: 3,
};

// ---------- read source ----------
const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const start = src.indexOf("const tools = [");
if (start < 0) throw new Error("tools array not found in index.html");
const arrStart = start + "const tools = ".length;
const arrEnd = src.indexOf("];", arrStart);
const tools = new Function("return " + src.slice(arrStart, arrEnd + 1))();
if (!Array.isArray(tools) || tools.length < 50) throw new Error("tools array looks wrong: " + (tools && tools.length));

const styles = [...src.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]);
const mainCss = styles.find(s => s.includes(":root")) || "";
const gaMatch = src.match(/<!-- Google Analytics -->[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/);
const analytics = gaMatch ? gaMatch[0] : "";
const logoSvg = (src.match(/<a href="#" class="nav-logo">\s*(<svg[\s\S]*?<\/svg>)/) || [])[1] || "";

// ---------- helpers ----------
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = s => String(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const isAffiliate = url => { try { return Object.hasOwn(AFFILIATE_HOSTS, new URL(url).hostname); } catch { return false; } };
const isFeatured = t => !!t.featured && (!t.featuredUntil || t.featuredUntil >= TODAY);
const rel = (url, t) => (isAffiliate(url) || (t && isFeatured(t))) ? "sponsored noopener" : "noopener";
const byRating = (a, b) => b.rating - a.rating;
const displayHost = url => { const h = new URL(url).hostname; return AFFILIATE_HOSTS[h] || h.replace(/^www\./, ""); };
const score = r => Number(r).toFixed(1);
const lowerTitle = c => "AI " + catTitle(c).slice(3).toLowerCase();
const pricingText = p => ({ free: "Free", freemium: "Free plan + paid upgrades", paid: "Paid" }[p] || p);
const pricingPhrase = p => ({ free: "a free", freemium: "a freemium", paid: "a paid" }[p] || "an");
const catTitle = c => c === "Chatbots" ? "AI Chatbots" : c === "Presentations" ? "AI Presentation Tools" : `AI ${c} Tools`;
const listJoin = a => a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a.at(-1);
const write = (rel, content) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };

const slugs = new Map();
for (const t of tools) {
  const s = slug(t.name);
  if (slugs.has(s)) throw new Error(`duplicate slug "${s}" for ${t.name} and ${slugs.get(s).name}`);
  slugs.set(s, t);
  t.slug = s;
}
const cats = [...new Set(tools.map(t => t.cat))];
const byCat = Object.fromEntries(cats.map(c => [c, tools.filter(t => t.cat === c).sort((a, b) => (isFeatured(b) - isFeatured(a)) || byRating(a, b))]));
cats.sort((a, b) => byCat[b].length - byCat[a].length);

// ---------- shared page shell ----------
const pageCss = `
.page { max-width: 880px; margin: 0 auto; padding: 100px 2rem 4rem; }
.page a { color: var(--accent); }
.crumbs { font-size: 13px; color: var(--text3); margin-bottom: 1.25rem; }
.crumbs a { color: var(--text2); text-decoration: none; }
.crumbs a:hover { color: var(--accent); }
.page h1 { font-family: var(--font-serif); font-weight: 400; font-size: 34px; letter-spacing: -0.5px; line-height: 1.15; margin-bottom: .9rem; }
.page h2 { font-family: var(--font-serif); font-weight: 400; font-size: 22px; margin: 2.25rem 0 .9rem; }
.lead { font-size: 16px; line-height: 1.65; color: var(--text); margin-bottom: 1.25rem; }
.facts { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; font-size: 14px; }
.facts th, .facts td { text-align: left; padding: .7rem 1rem; border-bottom: 1px solid var(--border); vertical-align: top; }
.facts th { color: var(--text2); font-weight: 500; width: 34%; background: var(--bg2); }
.facts tr:last-child th, .facts tr:last-child td { border-bottom: 0; }
.list { width: 100%; border-collapse: collapse; font-size: 14px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.list th { text-align: left; font-weight: 500; color: var(--text2); background: var(--bg2); padding: .6rem .9rem; border-bottom: 1px solid var(--border); }
.list td { padding: .7rem .9rem; border-bottom: 1px solid var(--border); vertical-align: top; color: var(--text2); line-height: 1.5; }
.list tr:last-child td { border-bottom: 0; }
.list td a { color: var(--text); font-weight: 600; text-decoration: none; }
.list td a:hover { color: var(--accent); }
.page .visit-btn { display: inline-block; background: var(--text); color: #fff; text-decoration: none; padding: .75rem 1.4rem; border-radius: 999px; font-size: 14px; font-weight: 500; margin: .5rem 0 .25rem; }
.page .visit-btn:hover { background: var(--accent); color: #fff; }
.note { font-size: 12.5px; color: var(--text3); margin-top: .5rem; }
.chips { display: flex; flex-wrap: wrap; gap: .5rem; }
.chips a { border: 1px solid var(--border); border-radius: 999px; padding: .4rem .85rem; font-size: 13px; color: var(--text2); text-decoration: none; background: var(--card); }
.chips a:hover { border-color: var(--accent); color: var(--accent); }
.cat-links { max-width: 1200px; margin: 0 auto; padding: 0 2rem 1rem; }
.feat-pill { display: inline-block; font-family: var(--font-sans); font-size: 10.5px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; background: var(--accent); color: #fff; padding: 2px 8px; border-radius: 999px; vertical-align: middle; margin-left: .4rem; }
.ad-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin: 1rem 0 .5rem; }
.ad-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.25rem; display: flex; flex-direction: column; gap: .4rem; }
.ad-card h3 { font-size: 16px; }
.ad-price { font-family: var(--font-serif); font-size: 28px; }
.ad-price small { font-family: var(--font-sans); font-size: 13px; color: var(--text2); }
.ad-card ul { padding-left: 1.1rem; font-size: 14px; color: var(--text2); line-height: 1.6; flex: 1; }
.ad-status { font-size: 13px; color: var(--text2); }
@media (max-width: 640px) { .page { padding: 88px 1.25rem 3rem; } .page h1 { font-size: 27px; } .facts th { width: 40%; } .list .hide-sm { display: none; } }
`;
write("assets/site.css", mainCss + "\n" + pageCss);

const shell = ({ title, description, canonical, body, jsonld }) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:site_name" content="Ellnow" />
  <meta name="twitter:card" content="summary" />
  <link rel="stylesheet" href="/assets/site.css" />
  ${analytics}
  ${jsonld.map(j => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join("\n  ")}
</head>
<body>
<nav>
  <a href="/" class="nav-logo">
    ${logoSvg}
    <span class="nav-logo-text">ell<em>now</em></span>
  </a>
  <div class="nav-links">
    <a href="/#tools">Browse</a>
    <a href="/advertise">Advertise</a>
    <a href="/#submit" class="nav-cta">Submit a Tool</a>
  </div>
</nav>
<main class="page">
${body}
</main>
<footer>
  <div class="footer-links">
    <a href="/">Home</a>
    <a href="/#faq">FAQ</a>
    <a href="/#submit">Submit a Tool</a>
    <a href="/advertise">Advertise</a>
    <a href="/terms">Terms</a>
  </div>
  <p>© ${YEAR} Ellnow · Find the right AI tool, right now.</p>
</footer>
</body>
</html>
`;

const crumbsLd = items => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, item: url }))
});
const catChips = current => `<div class="chips">${cats.filter(c => c !== current).map(c => `<a href="/category/${slug(c)}">${esc(c)} (${byCat[c].length})</a>`).join("")}</div>`;

// ---------- tool pages ----------
for (const t of tools) {
  const url = `${SITE}/tools/${t.slug}`;
  const catUrl = `/category/${slug(t.cat)}`;
  const alts = [...byCat[t.cat]].sort(byRating).filter(x => x !== t).slice(0, 6);
  const aff = isAffiliate(t.url);
  const body = `<div class="crumbs"><a href="/">Ellnow</a> › <a href="${catUrl}">${esc(t.cat)}</a> › ${esc(t.name)}</div>
<h1>${esc(t.icon)} ${esc(t.name)}${isFeatured(t) ? ' <span class="feat-pill">Featured</span>' : ""}</h1>
<p class="lead">${esc(t.name)} is ${pricingPhrase(t.pricing)} AI ${esc(t.cat.toLowerCase())} tool. ${esc(t.desc)}</p>
<table class="facts">
  <tr><th>Category</th><td><a href="${catUrl}">${esc(t.cat)}</a></td></tr>
  <tr><th>Pricing</th><td>${pricingText(t.pricing)}</td></tr>
  <tr><th>Editor's score</th><td>${score(t.rating)} / 5</td></tr>
  <tr><th>Website</th><td>${esc(displayHost(t.url))}</td></tr>
</table>
<a class="visit-btn" href="${esc(t.url)}" target="_blank" rel="${rel(t.url, t)}">Visit ${esc(t.name)} →</a>
${aff ? `<p class="note">Ellnow may earn a commission if you sign up through this link. It doesn't change the listing or score.</p>` : ""}
${isFeatured(t) ? `<p class="note">This is a paid Featured placement. It doesn't change the tool's score.</p>` : ""}
${alts.length ? `<h2>Alternatives to ${esc(t.name)}</h2>
<table class="list">
  <tr><th>Tool</th><th class="hide-sm">What it does</th><th>Pricing</th><th>Score</th></tr>
${alts.map(a => `  <tr><td><a href="/tools/${a.slug}">${esc(a.name)}</a></td><td class="hide-sm">${esc(a.desc)}</td><td>${pricingText(a.pricing)}</td><td>${score(a.rating)}</td></tr>`).join("\n")}
</table>
<p class="note">See all ${byCat[t.cat].length} <a href="${catUrl}">${esc(catTitle(t.cat))}</a> on Ellnow.</p>` : ""}
<h2>More categories</h2>
${catChips(t.cat)}`;
  write(`tools/${t.slug}.html`, shell({
    title: `${t.name}: what it does, pricing and alternatives | Ellnow`,
    description: `${t.name} is ${pricingPhrase(t.pricing)} AI ${t.cat.toLowerCase()} tool. ${t.desc}`.slice(0, 300),
    canonical: url,
    body,
    jsonld: [
      { "@context": "https://schema.org", "@type": "SoftwareApplication", name: t.name, description: t.desc, applicationCategory: `${t.cat} AI tool`, operatingSystem: "Web", url: t.url },
      crumbsLd([["Ellnow", SITE + "/"], [t.cat, SITE + catUrl], [t.name, url]])
    ]
  }));
}

// ---------- category pages ----------
for (const c of cats) {
  const list = byCat[c];
  const s = slug(c);
  const url = `${SITE}/category/${s}`;
  const top3 = [...list].sort(byRating).slice(0, 3).map(t => t.name);
  const freeCount = list.filter(t => t.pricing !== "paid").length;
  const title = `Best ${catTitle(c)} in ${YEAR}`;
  const body = `<div class="crumbs"><a href="/">Ellnow</a> › ${esc(c)}</div>
<h1>${esc(title)}</h1>
<p class="lead">The top-rated ${esc(lowerTitle(c))} on Ellnow are ${esc(listJoin(top3))}. Ellnow lists ${list.length} in this category, and ${freeCount} of them are free or have a free plan. Scores are editor's scores out of 5.</p>
<table class="list">
  <tr><th>Tool</th><th class="hide-sm">What it does</th><th>Pricing</th><th>Score</th></tr>
${list.map(t => `  <tr><td><a href="/tools/${t.slug}">${esc(t.name)}</a>${isFeatured(t) ? '<span class="feat-pill">Featured</span>' : ""}</td><td class="hide-sm">${esc(t.desc)}</td><td>${pricingText(t.pricing)}</td><td>${score(t.rating)}</td></tr>`).join("\n")}
</table>
<h2>Other categories</h2>
${catChips(c)}`;
  write(`category/${s}.html`, shell({
    title: `${title}: ${list.length} compared | Ellnow`,
    description: `Compare ${list.length} ${lowerTitle(c)}. Top-rated: ${listJoin(top3)}. ${freeCount} are free or have a free plan.`,
    canonical: url,
    body,
    jsonld: [
      { "@context": "https://schema.org", "@type": "ItemList", name: title, numberOfItems: list.length,
        itemListElement: list.map((t, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/tools/${t.slug}`, name: t.name })) },
      crumbsLd([["Ellnow", SITE + "/"], [c, url]])
    ]
  }));
}

// ---------- home page ----------
let home = src;
const cards = tools.map(t => `<a class="tool-card${isFeatured(t) ? " is-featured" : ""}" href="${esc(t.url)}" target="_blank" rel="${rel(t.url, t)}">${isFeatured(t) ? '<span class="feat-badge">Featured</span>' : ""}<div class="tool-top"><div class="tool-icon">${t.icon}</div><div><div class="tool-name">${esc(t.name)}</div><div class="tool-cat">${esc(t.cat)}</div></div></div><div class="tool-desc">${esc(t.desc)}</div><div class="tool-foot"><span class="tbadge ${t.pricing}">${t.pricing}</span><span class="tool-rating"><span class="star">★</span> ${t.rating}</span><span class="visit">Visit →</span></div></a>`).join("\n");
const sm = /<!-- STATIC-TOOLS:START[^>]*-->\n[\s\S]*?\n<!-- STATIC-TOOLS:END -->/;
if (!sm.test(home)) throw new Error("STATIC-TOOLS markers not found in index.html");
home = home.replace(sm, m => m.split("\n")[0] + "\n" + cards + "\n<!-- STATIC-TOOLS:END -->");
const catSection = `<section class="cat-links" id="categories">
  <div class="section-title">Browse by category</div>
  <div class="chips">${cats.map(c => `<a href="/category/${slug(c)}">${esc(c)} (${byCat[c].length})</a>`).join("")}</div>
</section>

`;
const faqTag = '<section class="section faq" id="faq">';
if (!home.includes(faqTag)) throw new Error("FAQ section not found in index.html");
home = home.replace(faqTag, catSection + faqTag);
home = home.replace("</head>", `<style>${pageCss.match(/\.chips[\s\S]*?\.cat-links[^}]*}/)[0]}</style>\n</head>`);
write("index.html", home);

// ---------- copy other root files ----------
const SKIP = new Set(["index.html", "dist", "scripts", "node_modules", "vercel.json", "package.json", "package-lock.json", "README.md", "sitemap.xml", "sitemap.xml.xml", "llms.txt"]);
for (const f of fs.readdirSync(ROOT)) {
  if (SKIP.has(f) || f.startsWith(".")) continue;
  const p = path.join(ROOT, f);
  if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(OUT, f));
}

// ---------- advertise page ----------
{
  const spot = tools.find(t => t.featured === "spotlight" && isFeatured(t));
  const catFeatured = Object.fromEntries(cats.map(c => [c, byCat[c].filter(isFeatured).length]));
  const full = cats.filter(c => catFeatured[c] >= ADVERTISE.categorySlots);
  const buy = (o, label) => o.url
    ? `<a class="visit-btn" href="${esc(o.url)}" target="_blank" rel="noopener">${label}</a>`
    : `<a class="visit-btn" href="mailto:hello@ellnow.com?subject=${encodeURIComponent(o.name + " on Ellnow")}">Email to book</a>`;
  const body = `<div class="crumbs"><a href="/">Ellnow</a> › Advertise</div>
<h1>Advertise on Ellnow</h1>
<p class="lead">Put your AI tool in front of people who are choosing one. Every paid placement is labeled "Featured" and runs for 30 days. Paying never changes a tool's score.</p>
<div class="ad-grid">
  <div class="ad-card">
    <h3>${ADVERTISE.spotlight.name}</h3>
    <div class="ad-price">$${ADVERTISE.spotlight.price} <small>/ 30 days</small></div>
    <ul>
      <li>The one Spotlight slot at the top of the homepage tool list</li>
      <li>Top spot and Featured badge in your category</li>
      <li>Featured badge on your tool page</li>
    </ul>
    <p class="ad-status">${spot ? `Booked until ${esc(spot.featuredUntil || "further notice")}` : "Available now"}</p>
    ${buy(ADVERTISE.spotlight, `Book Spotlight · $${ADVERTISE.spotlight.price}`)}
  </div>
  <div class="ad-card">
    <h3>${ADVERTISE.category.name}</h3>
    <div class="ad-price">$${ADVERTISE.category.price} <small>/ 30 days</small></div>
    <ul>
      <li>Top of your category page and category filter</li>
      <li>Highlighted card with a Featured badge</li>
      <li>Up to ${ADVERTISE.categorySlots} tools per category</li>
    </ul>
    <p class="ad-status">${full.length ? `Full: ${esc(full.join(", "))}` : "Open in every category"}</p>
    ${buy(ADVERTISE.category, `Book Category Featured · $${ADVERTISE.category.price}`)}
  </div>
  <div class="ad-card">
    <h3>Fast-track review</h3>
    <div class="ad-price">$19 <small>one-time</small></div>
    <ul>
      <li>Reviewed within 48 hours</li>
      <li>Full refund if not approved</li>
      <li>A permanent standard listing</li>
    </ul>
    <p class="ad-status">Not listed yet? Start here.</p>
    <a class="visit-btn" href="/#submit">Submit a tool</a>
  </div>
</div>
<h2>How it works</h2>
<ul class="lead">
  <li>Your tool needs to be listed on Ellnow, or approved through Fast-track, before a placement starts.</li>
  <li>After you pay, we confirm the start date by email. The placement runs for 30 days and then ends on its own. There's no subscription.</li>
  <li>Featured links are marked as sponsored, as search engines require for paid links.</li>
  <li>We don't sell placements to tools on our <a href="/terms#not-accepted">not-accepted list</a>. If we can't run your placement, you get a full refund.</li>
</ul>
<p class="note">Ellnow is a new, growing directory, and prices reflect that. Questions? Email <a href="mailto:hello@ellnow.com">hello@ellnow.com</a>. Placements are covered by the <a href="/terms">Listing Terms</a>.</p>`;
  write("advertise.html", shell({ title: "Advertise on Ellnow | Featured AI tool placements", description: `Feature your AI tool on Ellnow: Homepage Spotlight $${ADVERTISE.spotlight.price} or Category Featured $${ADVERTISE.category.price} for 30 days, clearly labeled.`, canonical: `${SITE}/advertise`, body, jsonld: [crumbsLd([["Ellnow", SITE + "/"], ["Advertise", SITE + "/advertise"]])] }));
}

// ---------- sitemap ----------
const urls = [[SITE + "/", "1.0"], [SITE + "/advertise", "0.5"], ...cats.map(c => [`${SITE}/category/${slug(c)}`, "0.8"]), ...tools.map(t => [`${SITE}/tools/${t.slug}`, "0.6"])];
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, p]) => `  <url><loc>${u}</loc><lastmod>${TODAY}</lastmod><priority>${p}</priority></url>`).join("\n")}
</urlset>
`);

// ---------- llms.txt ----------
write("llms.txt", `# Ellnow

> Ellnow (ellnow.com) is a free directory of ${tools.length} AI tools across ${cats.length} categories. Each listing shows what the tool does, whether it is free, freemium or paid, and an editor's score. New tools are added weekly.

Ellnow lists tools people can sign up for and use directly. Each product is listed once; duplicate or copycat listings are not accepted. Scores are editor's scores, not user reviews. Some outbound links are affiliate links; they do not affect listings or scores.

## Main pages

- [Ellnow home and full tool list](${SITE}/): all tools, searchable and filterable by category and pricing
- [FAQ](${SITE}/#faq): answers to common questions, such as the best AI video, image, writing, coding and voice tools
- [Submit a tool](${SITE}/#submit): how AI tool makers can request a listing

## Categories

${cats.map(c => `- [Best ${catTitle(c)}](${SITE}/category/${slug(c)}): ${byCat[c].length} tools. Top-rated: ${[...byCat[c]].sort(byRating).slice(0, 4).map(t => t.name).join(", ")}`).join("\n")}

## Optional

- [Sitemap](${SITE}/sitemap.xml): every tool page is at ${SITE}/tools/<tool-name>
- Contact: hello@ellnow.com
`);

console.log(`Built ${tools.length} tool pages, ${cats.length} category pages, ${urls.length} sitemap URLs into dist/`);
