-- data_lake.news_articles_swfl
-- Raw scraped articles from SWFL local news sources.
-- Processed by app/api/cron/news-crawl which scores + inserts into project_events.

CREATE TABLE IF NOT EXISTS data_lake.news_articles_swfl (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_url    text UNIQUE NOT NULL,
  headline       text NOT NULL,
  body_text      text,
  source_name    text NOT NULL,
  published_date text,
  scraped_at     timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz,
  swfl_relevance boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS news_articles_unprocessed
  ON data_lake.news_articles_swfl (scraped_at DESC)
  WHERE processed_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON data_lake.news_articles_swfl TO service_role;
NOTIFY pgrst, 'reload schema';
