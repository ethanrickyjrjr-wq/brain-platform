We use essential cookies to make our site work. With your consent, we may also use non-essential cookies to improve user experience and analyze website traffic. By clicking “Accept,” you agree to our website's cookie use as described in our Cookie Policy. You can change your cookie settings at any time by clicking “Preferences.” 
PreferencesDeclineAccept
[Skip to main content](https://dlthub.com/docs/general-usage/incremental-loading#__docusaurus_skipToContent_fallback)
[![dlt Docs Logo](https://dlthub.com/docs/img/dlthub-logo.png)](https://dlthub.com)
[1.28.1 (latest)](https://dlthub.com/docs/general-usage/incremental-loading)
  * [devel](https://dlthub.com/docs/devel/general-usage/incremental-loading)
  * [1.28.1 (latest)](https://dlthub.com/docs/general-usage/incremental-loading)


[dltHub](https://dlthub.com/docs/hub/getting-started/introduction)[dlt](https://dlthub.com/docs/intro)[Cookbook](https://dlthub.com/docs/examples)[Education](https://dlthub.com/docs/tutorial/education)[What's new?](https://dlthub.com/docs/release-highlights)
[Blog](https://dlthub.com/blog)[](https://dlthub.com/community)[](https://github.com/dlt-hub/dlt)
Search
  * [Getting started](https://dlthub.com/docs/general-usage/incremental-loading)
  * [Core concepts](https://dlthub.com/docs/general-usage/incremental-loading)
  * [Sources](https://dlthub.com/docs/general-usage/incremental-loading)
  * [Destinations](https://dlthub.com/docs/general-usage/incremental-loading)
  * [Configuration & secrets](https://dlthub.com/docs/general-usage/credentials)
  * [Load strategy](https://dlthub.com/docs/general-usage/incremental-loading)
    * [Full](https://dlthub.com/docs/general-usage/full-loading)
    * [Merge](https://dlthub.com/docs/general-usage/merge-loading)
    * [Incremental](https://dlthub.com/docs/general-usage/incremental-loading)
      * [Basic](https://dlthub.com/docs/general-usage/incremental-loading)
      * [Cursor-based](https://dlthub.com/docs/general-usage/incremental/cursor)
      * [Lag / Attribution window](https://dlthub.com/docs/general-usage/incremental/lag)
      * [State](https://dlthub.com/docs/general-usage/incremental/advanced-state)
      * [Troubleshoot](https://dlthub.com/docs/general-usage/incremental/troubleshooting)
    * [Staging](https://dlthub.com/docs/dlt-ecosystem/staging)
  * [Schema management](https://dlthub.com/docs/general-usage/incremental-loading)
  * [Transformations](https://dlthub.com/docs/dlt-ecosystem/transformations)
  * [Data quality](https://dlthub.com/docs/general-usage/incremental-loading)
  * [Deploy](https://dlthub.com/docs/walkthroughs/deploy-a-pipeline)
  * [Performance](https://dlthub.com/docs/reference/performance)
  * [Reference](https://dlthub.com/docs/general-usage/incremental-loading)


  * Load strategy
  * Incremental
  * Basic

Version: 1.28.1 (latest) [View Markdown](https://dlthub.com/docs/general-usage/incremental-loading.md)
On this page
# Incremental loading
Incremental loading is the act of loading only new or changed data and not old records that we have already loaded. It enables low-latency and low-cost data transfer.
The challenge of incremental pipelines is that if we do not keep track of the state of the load (i.e., which increments were loaded and which are to be loaded), we may encounter issues. Read more about state [here](https://dlthub.com/docs/general-usage/state).
## Choosing a write disposition[​](https://dlthub.com/docs/general-usage/incremental-loading#choosing-a-write-disposition "Direct link to Choosing a write disposition")
### The 3 write dispositions:[​](https://dlthub.com/docs/general-usage/incremental-loading#the-3-write-dispositions "Direct link to The 3 write dispositions:")
  * **Full load** : replaces the destination dataset with whatever the source produced on this run. To achieve this, use `write_disposition='replace'` in your resources. Learn more in the [full loading docs](https://dlthub.com/docs/general-usage/full-loading).
  * **Append** : appends the new data to the destination. Use `write_disposition='append'`.
  * **Merge** : Merges new data into the destination using `merge_key` and/or deduplicates/upserts new data using `primary_key`. Use `write_disposition='merge'`.


### How to choose the right write disposition[​](https://dlthub.com/docs/general-usage/incremental-loading#how-to-choose-the-right-write-disposition "Direct link to How to choose the right write disposition")
![write disposition flowchart](https://storage.googleapis.com/dlt-blog-images/flowchart_for_scd2.png)
The "write disposition" you choose depends on the dataset and how you can extract it.
To find the "write disposition" you should use, the first question you should ask yourself is "Is my data stateful or stateless"? Stateful data has a state that is subject to change - for example, a user's profile. Stateless data cannot change - for example, a recorded event, such as a page view.
Because stateless data does not need to be updated, we can just append it.
For stateful data, comes a second question - Do you need to track history of change ? If yes, you should use [slowly changing dimensions (Type-2)](https://dlthub.com/docs/general-usage/merge-loading#scd2-strategy), which allow you to maintain historical records of data changes over time.
If not, then we need to replace the entire dataset. However, if we can request the data incrementally, such as "all users added or modified since yesterday," then we can simply apply changes to our existing dataset with the merge write disposition.
## Incremental loading strategies[​](https://dlthub.com/docs/general-usage/incremental-loading#incremental-loading-strategies "Direct link to Incremental loading strategies")
dlt provides several approaches to incremental loading:
  1. [Merge strategies](https://dlthub.com/docs/general-usage/merge-loading#merge-strategies) - Choose between delete-insert, SCD2, upsert, and insert-only approaches to incrementally update your data
  2. [Cursor-based incremental loading](https://dlthub.com/docs/general-usage/incremental/cursor) - Track changes using a cursor field (like timestamp or ID)
  3. [Lag / Attribution window](https://dlthub.com/docs/general-usage/incremental/lag) - Refresh data within a specific time window
  4. [Advanced state management](https://dlthub.com/docs/general-usage/incremental/advanced-state) - Custom state tracking


## Doing a full or partial refresh[​](https://dlthub.com/docs/general-usage/incremental-loading#doing-a-full-or-partial-refresh "Direct link to Doing a full or partial refresh")
You may force a refresh of `merge` and `append` resources by setting the `refresh` option on the `dlt.pipeline` constructor or in the `run` method:
  * `drop_data` truncates all tables belonging to the selected resources and resets their state (including incremental). The schema is not changed.
  * `drop_resources` drops all tables belonging to the selected resources, from both the schema and the destination, and wipes their state. The tables are recreated with new data, and the stored schema history is erased (only the latest version is kept).
  * `drop_sources` drops all tables belonging to the sources being loaded and fully resets their schema and state.


Table truncation/drop happens when the load step starts, so a failed extract or normalization does not affect destination data.
Example:

```
import dlt  
  
pipeline = dlt.pipeline("airtable_demo", destination="duckdb")  
pipeline.run(sql_database().with_resources("users"), refresh="drop_data")  

```

Above, we refresh the `users` table (a partial refresh) by truncating it, loading data from scratch, and leaving the other tables intact.
tip
The `refresh` option is part of the pipeline configuration and may be set without changing the code. For example:

```
PIPELINES__GITHUB_PIPELINE__REFRESH=drop_data python github_pipeline.py  

```

sets the refresh option for a single pipeline script execution.
Please refer to the [pipeline](https://dlthub.com/docs/general-usage/pipeline#refresh-pipeline-data-and-state) documentation for more details.
caution
All tables that belong to a fully refreshed resource are truncated or dropped on a refresh load, including nested tables and tables created by [dispatching to many tables](https://dlthub.com/docs/general-usage/resource#dispatch-data-to-many-tables) or as table variants.
Note that a table does not need to receive any data to get truncated or dropped.
### Refresh with the "replace" write disposition[​](https://dlthub.com/docs/general-usage/incremental-loading#refresh-with-the-replace-write-disposition "Direct link to Refresh with the "replace" write disposition")
This method was recommended before the `refresh` option was available; **there is now no good reason to use it**. It requires modifying the schema tables, which persists until the next, unmodified run. There may be a small performance improvement, since the refresh load is a replace that can be optimized with a table swap.
  1. In the case of a `merge`, the data in the destination is truncated and loaded fresh. Currently, we do not deduplicate data during the full refresh.
  2. In the case of `dlt.sources.incremental`, the data is truncated and loaded from scratch. The state of the incremental is reset to the initial value.


Example:

```
p = dlt.pipeline(destination="bigquery", dataset_name="dataset_name")  
# Do a full refresh  
p.run(merge_source(), write_disposition="replace")  
# Do a full refresh of just one table  
p.run(merge_source().with_resources("merge_table"), write_disposition="replace")  
# Run a normal merge - until now all tables were loaded in replace mode  
p.run(merge_source())  

```

Passing write disposition to `replace` will change the write disposition on all the resources in `repo_events` during the run of the pipeline.
## Next steps[​](https://dlthub.com/docs/general-usage/incremental-loading#next-steps "Direct link to Next steps")
  * [Cursor-based incremental loading](https://dlthub.com/docs/general-usage/incremental/cursor) - Use timestamps or IDs to track changes
  * [Advanced state management](https://dlthub.com/docs/general-usage/incremental/advanced-state) - Advanced techniques for state tracking
  * [Walkthroughs: Add incremental configuration to SQL resources](https://dlthub.com/docs/walkthroughs/sql-incremental-configuration) - Step-by-step examples
  * [Troubleshooting incremental loading](https://dlthub.com/docs/general-usage/incremental/troubleshooting) - Common issues and how to fix them


[Edit this page](https://github.com/dlt-hub/dlt/tree/devel/docs/website/docs/general-usage/incremental-loading.md)
[Previous Merge](https://dlthub.com/docs/general-usage/merge-loading)[Next Cursor-based](https://dlthub.com/docs/general-usage/incremental/cursor)
  * [Choosing a write disposition](https://dlthub.com/docs/general-usage/incremental-loading#choosing-a-write-disposition)
    * [The 3 write dispositions:](https://dlthub.com/docs/general-usage/incremental-loading#the-3-write-dispositions)
    * [How to choose the right write disposition](https://dlthub.com/docs/general-usage/incremental-loading#how-to-choose-the-right-write-disposition)
  * [Incremental loading strategies](https://dlthub.com/docs/general-usage/incremental-loading#incremental-loading-strategies)
  * [Doing a full or partial refresh](https://dlthub.com/docs/general-usage/incremental-loading#doing-a-full-or-partial-refresh)
    * [Refresh with the "replace" write disposition](https://dlthub.com/docs/general-usage/incremental-loading#refresh-with-the-replace-write-disposition)
  * [Next steps](https://dlthub.com/docs/general-usage/incremental-loading#next-steps)


Community
  * [Slack](https://dlthub.com/community)
  * Email


More
  * [GitHub](https://github.com/dlt-hub/dlt)
  * [Twitter](https://twitter.com/dlthub)


Workspace
  * [Scaffoldings](https://dlthub.com/workspace)


Copyright © 2026 dltHub, Inc.
This demo works on codespaces. Codespaces is a development environment available for free to anyone with a Github account. You'll be asked to fork the demo repository and from there the README guides you with further steps.
The demo uses the Continue VSCode extension.
  
[Off to codespaces!](https://github.com/codespaces/new/dlt-hub/dlt-llm-code-playground?ref=create-pipeline)
# DHelp
## Ask a question
Welcome to "Codex Central", your next-gen help center, driven by OpenAI's GPT-4 model. It's more than just a forum or a FAQ hub – it's a dynamic knowledge base where coders can find AI-assisted solutions to their pressing problems. With GPT-4's powerful comprehension and predictive abilities, Codex Central provides instantaneous issue resolution, insightful debugging, and personalized guidance. Get your code running smoothly with the unparalleled support at Codex Central - coding help reimagined with AI prowess.
