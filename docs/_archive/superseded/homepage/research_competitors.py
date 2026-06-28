import asyncio, sys
from crawl4ai import AsyncWebCrawler, CrawlerRunConfig

SITES = [
    ("Mailchimp Pricing", "https://mailchimp.com/pricing/"),
    ("Constant Contact Pricing", "https://www.constantcontact.com/pricing"),
    ("kvCORE (RE CRM)", "https://kvcore.com/features/"),
    ("Follow Up Boss Pricing", "https://www.followupboss.com/pricing"),
    ("CoStar", "https://www.costar.com/products"),
]

async def main():
    cfg = CrawlerRunConfig(
        word_count_threshold=5,
        exclude_external_images=True,
        remove_overlay_elements=True,
        only_text=True,
    )
    async with AsyncWebCrawler() as crawler:
        for label, url in SITES:
            print(f"\n{'='*60}", flush=True)
            print(f"[{label}] {url}", flush=True)
            print('='*60, flush=True)
            try:
                result = await crawler.arun(url=url, config=cfg)
                if result.success:
                    text = (result.markdown or "")[:2000]
                    safe = text.encode('ascii', errors='replace').decode('ascii')
                    print(safe, flush=True)
                else:
                    print(f"FAILED: {result.error_message}", flush=True)
            except Exception as e:
                print(f"ERROR: {e}", flush=True)

asyncio.run(main())
