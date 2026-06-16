# crawl4ai migration — Firecrawl + Spider replacement

All pipelines below called Firecrawl or Spider. Both are gone. Replace with crawl4ai.

## Browser required (UndetectedAdapter)

- [x] `dbpr-sirs-monthly` — Qlik SaaS apps, JS rendering, 15s wait, stealth
- [x] `ingest-crexi-listings` — JS-rendered listing grid; crawl4ai UndetectedAdapter + Anthropic Haiku extraction

## Static HTML (basic AsyncWebCrawler, no stealth needed)

- [x] `fgcu-reri-monthly` — static academic page (fgcu.edu)
- [x] `dbpr-public-notices-weekly` — HTML index + PDFs (myfloridalicense.com)
- [x] `dbpr-press-releases-weekly` — HTML article listings
- [x] `swfl-inc-weekly` — HTML blog feeds
- [x] `rsw-airport-monthly` — reports page for PDF URL discovery (curl handles actual download)
- [x] `marketbeat-pdf-ingest` — research page PDF URL scrape (curl handles actual download)

## Notes

- Each port = (1) rewrite the pipeline's scrape function, (2) update the workflow yml (add browser install steps, drop FIRECRAWL_API_KEY / SPIDER_API_KEY).
- `Crawl4aiSession` (UndetectedAdapter) is already proven on GHA datacenter IPs via the lee_permits dry-run (run 27602909470, 2026-06-16).
- Static pages: use plain `AsyncWebCrawler` without UndetectedAdapter.
