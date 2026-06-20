import sys

import dlt

from .fetcher import fetch_all_sources


@dlt.resource(
    name="news_articles_swfl",
    write_disposition="merge",
    primary_key="article_url",
    # published_date is a TEXT column (ISO YYYY-MM-DD): dlt's insert-values
    # loader won't cast a string into a pre-created Postgres `date` column.
    columns={"published_date": {"data_type": "text"}},
)
def news_articles():
    articles = fetch_all_sources()
    print(f"[news_swfl] fetched {len(articles)} SWFL-relevant articles")
    yield from articles


def build_pipeline():
    return dlt.pipeline(
        pipeline_name="news_swfl",
        destination="postgres",
        dataset_name="data_lake",
    )


def run(dry_run: bool = False):
    if dry_run:
        articles = fetch_all_sources()
        print(f"[news_swfl] DRY RUN — would insert {len(articles)} articles:")
        for a in articles[:5]:
            print(f"  {a['source_name']}: {a['headline'][:80]}")
        return

    pipeline = build_pipeline()
    load_info = pipeline.run(news_articles())
    print(load_info)


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    run(dry_run=dry_run)
