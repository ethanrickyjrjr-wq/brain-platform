We use essential cookies to make our site work. With your consent, we may also use non-essential cookies to improve user experience and analyze website traffic. By clicking “Accept,” you agree to our website's cookie use as described in our Cookie Policy. You can change your cookie settings at any time by clicking “Preferences.” 
PreferencesDeclineAccept
[Skip to main content](https://dlthub.com/docs/general-usage/pipeline#__docusaurus_skipToContent_fallback)
[![dlt Docs Logo](https://dlthub.com/docs/img/dlthub-logo.png)](https://dlthub.com)
[1.28.1 (latest)](https://dlthub.com/docs/general-usage/pipeline)
  * [devel](https://dlthub.com/docs/devel/general-usage/pipeline#refresh-pipeline-data-and-state)
  * [1.28.1 (latest)](https://dlthub.com/docs/general-usage/pipeline#refresh-pipeline-data-and-state)


[dltHub](https://dlthub.com/docs/hub/getting-started/introduction)[dlt](https://dlthub.com/docs/intro)[Cookbook](https://dlthub.com/docs/examples)[Education](https://dlthub.com/docs/tutorial/education)[What's new?](https://dlthub.com/docs/release-highlights)
[Blog](https://dlthub.com/blog)[](https://dlthub.com/community)[](https://github.com/dlt-hub/dlt)
Search
  * [Getting started](https://dlthub.com/docs/general-usage/pipeline)
  * [Core concepts](https://dlthub.com/docs/general-usage/pipeline)
    * [Overview](https://dlthub.com/docs/reference/explainers/how-dlt-works)
    * [Glossary](https://dlthub.com/docs/general-usage/glossary)
    * [Source](https://dlthub.com/docs/general-usage/source)
    * [Resource](https://dlthub.com/docs/general-usage/resource)
    * [Pipeline](https://dlthub.com/docs/general-usage/pipeline)
    * [Destination](https://dlthub.com/docs/general-usage/destination)
    * [Dataset](https://dlthub.com/docs/general-usage/dataset-access/dataset)
    * [State](https://dlthub.com/docs/general-usage/state)
    * [Schema](https://dlthub.com/docs/general-usage/schema)
  * [Sources](https://dlthub.com/docs/general-usage/pipeline)
  * [Destinations](https://dlthub.com/docs/general-usage/pipeline)
  * [Configuration & secrets](https://dlthub.com/docs/general-usage/credentials)
  * [Load strategy](https://dlthub.com/docs/general-usage/pipeline)
  * [Schema management](https://dlthub.com/docs/general-usage/pipeline)
  * [Transformations](https://dlthub.com/docs/dlt-ecosystem/transformations)
  * [Data quality](https://dlthub.com/docs/general-usage/pipeline)
  * [Deploy](https://dlthub.com/docs/walkthroughs/deploy-a-pipeline)
  * [Performance](https://dlthub.com/docs/reference/performance)
  * [Reference](https://dlthub.com/docs/general-usage/pipeline)


  * Core concepts
  * Pipeline

Version: 1.28.1 (latest) [View Markdown](https://dlthub.com/docs/general-usage/pipeline.md)
On this page
# Pipeline
A [pipeline](https://dlthub.com/docs/general-usage/glossary#pipeline) moves data from your Python code to a [destination](https://dlthub.com/docs/general-usage/glossary#destination). The pipeline accepts `dlt` [sources](https://dlthub.com/docs/general-usage/source) or [resources](https://dlthub.com/docs/general-usage/resource), as well as generators, async generators, lists, and any iterables. Once the pipeline runs, all resources are evaluated and the data is loaded at the destination.
Example:
This pipeline loads a list of objects into a DuckDB table named "three":

```
import dlt  
  
pipeline = dlt.pipeline(destination="duckdb", dataset_name="sequence")  
  
info = pipeline.run([{'id':1}, {'id':2}, {'id':3}], table_name="three")  
  
print(info)  

```

You instantiate a pipeline by calling the `dlt.pipeline` function with the following arguments:
  * `pipeline_name`: a name of the pipeline that is used to identify it in trace and monitoring events and to restore its state and data schemas on subsequent runs. If not provided, `dlt` creates a pipeline name from the filename of the currently executing Python module.
  * `destination`: a name of the [destination](https://dlthub.com/docs/dlt-ecosystem/destinations) to which dlt loads the data. It may also be provided to the `run` method of the `pipeline` and can be declared in [various ways](https://dlthub.com/docs/general-usage/destination).
  * `dataset_name`: a name of the dataset to which the data is loaded. A dataset is a logical group of tables, that is, `schema` in relational databases or a folder grouping many files. It may also be provided later to the `run` or `load` methods of the pipeline. If not provided, then it defaults to the `{pipeline_name}_dataset` on destinations that require datasets (most of the warehouses). It stays empty on destinations that don't separate tables into datasets (or database schemas), that is, on vector databases or ClickHouse.


To load the data, you call the `run` method and pass your data in the `data` argument.
Arguments:
  * `data` (the first argument) may be a dlt source, resource, generator function, or any Iterator or Iterable (that is, a list or the result of the `map` function).
  * `write_disposition` controls how to write data to a table. Defaults to "append".
    * `append` always adds new data at the end of the table.
    * `replace` replaces existing data with new data.
    * `merge` deduplicates and merges data based on `primary_key` and `merge_key` hints.
  * `table_name`: specified in cases when the table name can't be inferred, that is, from the resources or name of the generator function.


Example: This pipeline loads the data the generator `generate_rows(10)` produces:

```
import dlt  
  
def generate_rows(nr):  
    for i in range(nr):  
        yield {'id':1}  
  
pipeline = dlt.pipeline(destination='bigquery', dataset_name='sql_database_data')  
  
info = pipeline.run(generate_rows(10))  
  
print(info)  

```

## Pipeline working directory[​](https://dlthub.com/docs/general-usage/pipeline#pipeline-working-directory "Direct link to Pipeline working directory")
Each pipeline that you create with `dlt` stores extracted files, load packages, inferred schemas, execution traces, and the [pipeline state](https://dlthub.com/docs/general-usage/state) in a folder in the local filesystem. The default location for such folders is in the user's home directory: `~/.dlt/pipelines/<pipeline_name>`.
You can inspect stored artifacts using the command [dlt pipeline info](https://dlthub.com/docs/reference/command-line-interface#dlt-pipeline) and [programmatically](https://dlthub.com/docs/walkthroughs/run-a-pipeline#4-inspect-a-load-process).
> 💡 A pipeline with a given name looks for its working directory in the location above - so if you have two pipeline scripts that create a pipeline with the same name, they see the same working folder and share all the possible state. You may override the default location using the `pipelines_dir` argument when creating the pipeline.
> 💡 You can attach a `Pipeline` instance to an existing working folder, without creating a new pipeline with `dlt.attach`.
### Separate working environments with `pipelines_dir`[​](https://dlthub.com/docs/general-usage/pipeline#separate-working-environments-with-pipelines_dir "Direct link to separate-working-environments-with-pipelines_dir")
You can run several pipelines with the same name but with different configurations, for example, to target development, staging, or production environments. Set the `pipelines_dir` argument to store all the working folders in a specific place. For example:

```
import dlt  
from dlt.common.pipeline import get_dlt_pipelines_dir  
  
dev_pipelines_dir = os.path.join(get_dlt_pipelines_dir(), "dev")  
pipeline = dlt.pipeline(destination="duckdb", dataset_name="sequence", pipelines_dir=dev_pipelines_dir)  

```

This code stores the pipeline working folder in `~/.dlt/pipelines/dev/<pipeline_name>`. Note that you need to pass this `~/.dlt/pipelines/dev/` into all CLI commands to get info/trace for that pipeline.
## Do experiments with dev mode[​](https://dlthub.com/docs/general-usage/pipeline#do-experiments-with-dev-mode "Direct link to Do experiments with dev mode")
If you [create a new pipeline script](https://dlthub.com/docs/tutorial/load-data-from-an-api), you experiment a lot. If you want each time the pipeline resets its state and loads data to a new dataset, set the `dev_mode` argument of the `dlt.pipeline` method to True. Each time the pipeline is created, `dlt` adds a datetime-based suffix to the dataset name.
## Drop destination schema / dataset to start over[​](https://dlthub.com/docs/general-usage/pipeline#drop-destination-schema--dataset-to-start-over "Direct link to Drop destination schema / dataset to start over")
If you drop the destination schema / dataset to which your pipeline loads data, the pipeline fully resets its state and working directory and executes its first run. If your pipeline doesn't share the dataset with any other pipeline and you don't keep any additional data in it - this operation is also safe to be executed in production to trigger full refresh without a need to writing additional code.
## Refresh pipeline data and state[​](https://dlthub.com/docs/general-usage/pipeline#refresh-pipeline-data-and-state "Direct link to Refresh pipeline data and state")
You can reset parts or all of your sources by using the `refresh` argument to `dlt.pipeline` or the pipeline's `run` or `extract` method. That means when you run the pipeline, the sources/resources being processed have their state reset and their tables either dropped or truncated, depending on which refresh mode is used.
tip
`dlt` modifies your destination only if extract and normalize steps of refresh run succeeded. In any other case all modifications, including schema and state, are discarded.
The `refresh` option works with all relational or SQL destinations and cloud storages and files (`filesystem`). It doesn't work with vector databases (support is in progress) and with custom destinations.
The `refresh` argument should have one of the following string values to decide the refresh mode:
### Drop tables and pipeline state for a source with `drop_sources`[​](https://dlthub.com/docs/general-usage/pipeline#drop-tables-and-pipeline-state-for-a-source-with-drop_sources "Direct link to drop-tables-and-pipeline-state-for-a-source-with-drop_sources")
All sources being processed in `pipeline.run` or `pipeline.extract` are refreshed. That means all tables listed in their schemas are dropped and the state belonging to those sources and all their resources is completely wiped. The tables are deleted both from the pipeline's schema and from the destination database.
If you only have one source or run with all your sources together, then this is practically like running the pipeline again for the first time.
warning
This erases schema history for the selected sources and only the latest version is stored.

```
import dlt  
  
pipeline = dlt.pipeline("airtable_demo", destination="duckdb")  
pipeline.run(airtable_emojis(), refresh="drop_sources")  

```

The preceding example instructs `dlt` to wipe the pipeline state belonging to the `airtable_emojis` source and drop all the database tables in `duckdb` to which data was loaded. The `airtable_emojis` source had two resources named "📆 Schedule" and "💰 Budget" loading to tables "_schedule" and "_budget". Here's what `dlt` does step by step:
  1. Collects a list of tables to drop by looking for all the tables in the schema that are created in the destination.
  2. Removes existing pipeline state associated with the `airtable_emojis` source.
  3. Resets the schema associated with the `airtable_emojis` source.
  4. Executes `extract` and `normalize` steps. These create fresh pipeline state and a schema.
  5. Before it executes the `load` step, the collected tables are dropped from staging and regular dataset.
  6. Schema `airtable_emojis` (associated with the source) is removed from the `_dlt_version` table.
  7. Executes the `load` step as usual so tables are recreated and fresh schema and pipeline state are stored.


### Selectively drop tables and resource state with `drop_resources`[​](https://dlthub.com/docs/general-usage/pipeline#selectively-drop-tables-and-resource-state-with-drop_resources "Direct link to selectively-drop-tables-and-resource-state-with-drop_resources")
Limits the refresh to the resources being processed in `pipeline.run` or `pipeline.extract` (for example, by using `source.with_resources(...)`). Tables belonging to those resources are dropped, and their resource state is wiped (that includes incremental state). The tables are deleted both from the pipeline's schema and from the destination database.
Source level state keys aren't deleted in this mode (that is, `dlt.current.source_state()[<'my_key>'] = '<my_value>'`)
warning
This erases schema history for all affected sources, and only the latest schema version is stored.

```
import dlt  
  
pipeline = dlt.pipeline("airtable_demo", destination="duckdb")  
pipeline.run(airtable_emojis().with_resources("📆 Schedule"), refresh="drop_resources")  

```

Above, the state associated with the "📆 Schedule" resource is reset, and the table generated by it ("_schedule") is dropped. Other resources, tables, and state aren't affected. Please check `drop_sources` for a step-by-step description of what `dlt` does internally.
### Selectively truncate tables and reset resource state with `drop_data`[​](https://dlthub.com/docs/general-usage/pipeline#selectively-truncate-tables-and-reset-resource-state-with-drop_data "Direct link to selectively-truncate-tables-and-reset-resource-state-with-drop_data")
Same as `drop_resources`, but instead of dropping tables from the schema, only the data is deleted from them (that is, by `TRUNCATE <table_name>` in SQL destinations). Resource state for selected resources is also wiped. In the case of [incremental resources](https://dlthub.com/docs/general-usage/incremental/cursor), this resets the cursor state and fully reloads the data from the `initial_value`.
The schema remains unmodified in this case.

```
import dlt  
  
pipeline = dlt.pipeline("airtable_demo", destination="duckdb")  
pipeline.run(airtable_emojis().with_resources("📆 Schedule"), refresh="drop_data")  

```

Above, the incremental state of the "📆 Schedule" is reset before the `extract` step so data is fully reacquired. Just before the `load` step starts, the "_schedule" is truncated, and new (full) table data is inserted/copied.
## Monitor the loading progress[​](https://dlthub.com/docs/general-usage/pipeline#monitor-the-loading-progress "Direct link to Monitor the loading progress")
You can add a progress monitor to the pipeline. Typically, its role is to visually assure the user that the pipeline run is progressing. dlt supports 4 progress monitors out of the box:
  * [enlighten](https://github.com/Rockhopper-Technologies/enlighten) - a status bar with progress bars that also allows for logging.
  * [tqdm](https://github.com/tqdm/tqdm) - the most popular Python progress bar lib, proven to work in Notebooks.
  * [alive_progress](https://github.com/rsalmei/alive-progress) - with the fanciest animations.
  * **log** - dumps the progress information to log, console, or text stream. **The most useful on production** optionally adds memory and CPU usage stats.


> 💡 You must install the required progress bar library yourself.
You pass the progress monitor in the `progress` argument of the pipeline. You can use a name from the preceding list as in the following example:

```
# create a pipeline loading chess data that dumps  
# progress to stdout every 10 seconds (the default)  
pipeline = dlt.pipeline(  
    pipeline_name="chess_pipeline",  
    destination='duckdb',  
    dataset_name="chess_players_games_data",  
    progress="log"  
)  

```

You can fully configure the progress monitor. See two examples below:

```
from airflow.operators.python import get_current_context  # noqa  
  
# log each minute to Airflow task logger  
ti = get_current_context()["ti"]  
pipeline = dlt.pipeline(  
    pipeline_name="chess_pipeline",  
    destination='duckdb',  
    dataset_name="chess_players_games_data",  
    progress=dlt.progress.log(60, ti.log)  
)  

```


```
# set tqdm bar color to yellow  
pipeline = dlt.pipeline(  
    pipeline_name="chess_pipeline",  
    destination='duckdb',  
    dataset_name="chess_players_games_data",  
    progress=dlt.progress.tqdm(colour="yellow")  
)  

```

Note that the value of the `progress` argument is [configurable](https://dlthub.com/docs/walkthroughs/run-a-pipeline#2-see-the-progress-during-loading).
[Edit this page](https://github.com/dlt-hub/dlt/tree/devel/docs/website/docs/general-usage/pipeline.md)
[Previous Resource](https://dlthub.com/docs/general-usage/resource)[Next Destination](https://dlthub.com/docs/general-usage/destination)
  * [Pipeline working directory](https://dlthub.com/docs/general-usage/pipeline#pipeline-working-directory)
    * [Separate working environments with `pipelines_dir`](https://dlthub.com/docs/general-usage/pipeline#separate-working-environments-with-pipelines_dir)
  * [Do experiments with dev mode](https://dlthub.com/docs/general-usage/pipeline#do-experiments-with-dev-mode)
  * [Drop destination schema / dataset to start over](https://dlthub.com/docs/general-usage/pipeline#drop-destination-schema--dataset-to-start-over)
  * [Refresh pipeline data and state](https://dlthub.com/docs/general-usage/pipeline#refresh-pipeline-data-and-state)
    * [Drop tables and pipeline state for a source with `drop_sources`](https://dlthub.com/docs/general-usage/pipeline#drop-tables-and-pipeline-state-for-a-source-with-drop_sources)
    * [Selectively drop tables and resource state with `drop_resources`](https://dlthub.com/docs/general-usage/pipeline#selectively-drop-tables-and-resource-state-with-drop_resources)
    * [Selectively truncate tables and reset resource state with `drop_data`](https://dlthub.com/docs/general-usage/pipeline#selectively-truncate-tables-and-reset-resource-state-with-drop_data)
  * [Monitor the loading progress](https://dlthub.com/docs/general-usage/pipeline#monitor-the-loading-progress)


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
