Opens in a new window Opens an external website Opens an external website in a new window
Close this dialog
This website utilizes technologies such as cookies to enable essential site functionality, as well as for analytics, personalization, and targeted advertising. To learn more, view the following link:  [Privacy Policy](https://dagster.io/privacy)
Manage Preferences 
Close Cookie Preferences
[Skip to main content](https://docs.dagster.io/guides/build/assets/defining-assets#__docusaurus_skipToContent_fallback)
**Developing with AI? Check out our new[AI skills](https://github.com/dagster-io/skills)!**
[![Dagster Logo](https://docs.dagster.io/img/dagster-docs-logo.svg)](https://docs.dagster.io/)[User guide](https://docs.dagster.io/)[Examples](https://docs.dagster.io/examples)[Deployment](https://docs.dagster.io/deployment)[Migration](https://docs.dagster.io/migration)[Integrations](https://docs.dagster.io/integrations)[API](https://docs.dagster.io/api)
[Latest (1.13.10)](https://docs.dagster.io/guides/build/assets/defining-assets)
  * [Latest (1.13.10)](https://docs.dagster.io/guides/build/assets/defining-assets)
  * [Version 1.12 (1.12.8)](https://release-1-12-8.archive.dagster-docs.io/)
  * [Version 1.11 (1.11.16)](https://release-1-11-16.archive.dagster-docs.io/)
  * [Version 1.10 (1.10.21)](https://release-1-10-21.archive.dagster-docs.io/)
  * [Version 1.9 (1.9.13)](https://release-1-9-13.archive.dagster-docs.io/)
  * [1.9.9 and earlier](https://legacy-docs.dagster.io)
  * [Upcoming release (Preview)](https://main.archive.dagster-docs.io/)


[Sign in](https://dagster.plus/)[Try Dagster+](https://dagster.plus/signup)
Search
[![Dagster Logo](https://docs.dagster.io/img/dagster-docs-logo.svg)](https://docs.dagster.io/)
  * [Getting Started](https://docs.dagster.io/guides/build/assets/defining-assets)
    * [Overview](https://docs.dagster.io/)
    * [Quickstart (Dagster+ Hybrid and OSS)](https://docs.dagster.io/getting-started/quickstart)
    * [Quickstart (Dagster+ Serverless)](https://docs.dagster.io/getting-started/quickstart-serverless)
    * [Installation](https://docs.dagster.io/getting-started/installation)
    * [Concepts](https://docs.dagster.io/getting-started/concepts)
    * [AI tools](https://docs.dagster.io/getting-started/ai-tools)
    * [Dagster University](https://courses.dagster.io/)
    * [Python primer](https://dagster.io/blog/python-packages-primer-1)
  * [Tutorial](https://docs.dagster.io/dagster-basics-tutorial)
    * [Projects](https://docs.dagster.io/dagster-basics-tutorial/projects)
    * [Assets](https://docs.dagster.io/dagster-basics-tutorial/assets)
    * [Resources](https://docs.dagster.io/dagster-basics-tutorial/resources)
    * [Asset dependencies](https://docs.dagster.io/dagster-basics-tutorial/dependencies)
    * [Asset checks](https://docs.dagster.io/dagster-basics-tutorial/asset-checks)
    * [Automation](https://docs.dagster.io/dagster-basics-tutorial/schedules)
    * [Components](https://docs.dagster.io/dagster-basics-tutorial/custom-components)
    * [Dagster basics tutorial](https://docs.dagster.io/dagster-basics-tutorial)
  * [Build](https://docs.dagster.io/guides/build)
    * [Build pipelines](https://docs.dagster.io/guides/build)
    * [Projects and workspaces](https://docs.dagster.io/guides/build/projects)
    * [Assets](https://docs.dagster.io/guides/build/assets)
      * [Defining assets](https://docs.dagster.io/guides/build/assets/defining-assets)
      * [Defining assets that depend on other assets](https://docs.dagster.io/guides/build/assets/defining-assets-with-asset-dependencies)
      * [Modeling ETL pipelines with assets](https://docs.dagster.io/guides/build/assets/modeling-etl-pipelines)
      * [Passing data between assets](https://docs.dagster.io/guides/build/assets/passing-data-between-assets)
      * [Configuring assets in the UI](https://docs.dagster.io/guides/build/assets/configuring-assets)
      * [Creating asset factories](https://docs.dagster.io/guides/build/assets/creating-asset-factories)
      * [Defining dependencies with asset factories](https://docs.dagster.io/guides/build/assets/defining-dependencies-with-asset-factories)
      * [External assets](https://docs.dagster.io/guides/build/assets/external-assets)
      * [Virtual assets](https://docs.dagster.io/guides/build/assets/virtual-assets)
      * [Asset metadata and tags](https://docs.dagster.io/guides/build/assets/metadata-and-tags)
      * [Asset selection](https://docs.dagster.io/guides/build/assets/asset-selection-syntax)
      * [Asset versioning and caching](https://docs.dagster.io/guides/build/assets/asset-versioning-and-caching)
      * [Graph-backed assets](https://docs.dagster.io/guides/build/assets/graph-backed-assets)
    * [Components](https://docs.dagster.io/guides/build/components)
    * [Partitions and backfills](https://docs.dagster.io/guides/build/partitions-and-backfills)
    * [External resources](https://docs.dagster.io/guides/build/external-resources)
    * [I/O managers](https://docs.dagster.io/guides/build/io-managers)
    * [Ops](https://docs.dagster.io/guides/build/ops)
    * [Jobs](https://docs.dagster.io/guides/build/jobs)
  * [Automate](https://docs.dagster.io/guides/automate)
    * [Automate](https://docs.dagster.io/guides/automate)
    * [Schedules](https://docs.dagster.io/guides/automate/schedules)
    * [Declarative Automation](https://docs.dagster.io/guides/automate/declarative-automation)
    * [Sensors](https://docs.dagster.io/guides/automate/sensors)
    * [Asset sensors](https://docs.dagster.io/guides/automate/asset-sensors)
  * [Operate](https://docs.dagster.io/guides/operate)
    * [Configuration](https://docs.dagster.io/guides/operate/configuration)
    * [Operating pipelines](https://docs.dagster.io/guides/operate)
    * [Dagster webserver and UI](https://docs.dagster.io/guides/operate/webserver)
    * [User settings in the UI](https://docs.dagster.io/guides/operate/ui-user-settings)
    * [Run executors](https://docs.dagster.io/guides/operate/run-executors)
    * [Managing concurrency](https://docs.dagster.io/guides/operate/managing-concurrency)
  * [Log & debug](https://docs.dagster.io/guides/log-debug)
    * [Logging & debugging pipelines](https://docs.dagster.io/guides/log-debug)
    * [Logging](https://docs.dagster.io/guides/log-debug/logging)
    * [Debugging](https://docs.dagster.io/guides/log-debug/debugging)
  * [Observe](https://docs.dagster.io/guides/observe)
    * [Asset catalog (Dagster+)](https://docs.dagster.io/guides/observe/asset-catalog)
    * [Alerts (Dagster+)](https://docs.dagster.io/guides/observe/alerts)
    * [Asset health status (Dagster+)](https://docs.dagster.io/guides/observe/asset-health-status)
    * [Asset freshness policies](https://docs.dagster.io/guides/observe/asset-freshness-policies)
    * [Insights (Dagster+)](https://docs.dagster.io/guides/observe/insights)
    * [Observe](https://docs.dagster.io/guides/observe)
  * [Test](https://docs.dagster.io/guides/test)
    * [Testing assets](https://docs.dagster.io/guides/test)
    * [Asset checks](https://docs.dagster.io/guides/test/asset-checks)
    * [Running a subset of asset checks](https://docs.dagster.io/guides/test/running-a-subset-of-asset-checks)
    * [Unit testing assets and ops](https://docs.dagster.io/guides/test/unit-testing-assets-and-ops)
    * [Testing partitioned config and jobs](https://docs.dagster.io/guides/test/testing-partitioned-config-and-jobs)
    * [Data contracts with asset checks](https://docs.dagster.io/guides/test/data-contracts)
  * [Labs](https://docs.dagster.io/guides/labs)
    * [Dagster+ AI](https://docs.dagster.io/guides/labs/dagster-ai)
    * [Issues](https://docs.dagster.io/guides/labs/issues)
    * [Connections](https://docs.dagster.io/guides/labs/connections)
    * [Webhooks](https://docs.dagster.io/guides/labs/webhook-alerts)
    * [Labs](https://docs.dagster.io/guides/labs)
  * [About](https://docs.dagster.io/guides/build/assets/defining-assets)
    * [Community](https://docs.dagster.io/about/community)
    * [Contributing code](https://docs.dagster.io/about/contributing)
    * [Contributing documentation](https://docs.dagster.io/about/contributing-docs)
    * [Dagster telemetry](https://docs.dagster.io/about/telemetry)
    * [Releases](https://docs.dagster.io/about/releases)
    * [Changelog](https://docs.dagster.io/about/changelog)
    * [Data portability](https://docs.dagster.io/about/data-portability)


  * [](https://docs.dagster.io/)
  * [Build](https://docs.dagster.io/guides/build)
  * [Assets](https://docs.dagster.io/guides/build/assets)
  * Defining assets


On this page
# Defining assets
The most common way to create a data asset in Dagster is by annotating a Python function with an [`@dg.asset`](https://docs.dagster.io/api/dagster/assets#dagster.asset) decorator. The function computes the contents of the asset, such as a database table or file.
tip
You can scaffold assets from the command line by running `dg scaffold defs dagster.asset <path/to/asset_file.py>`. For more information, see the [`dg` CLI docs](https://docs.dagster.io/api/clis/dg-cli/dg-cli-reference#dg-scaffold).
An asset definition includes the following:
  * An `AssetKey`, which is a handle for referring to the asset.
  * A set of upstream asset keys, which refer to assets that the contents of the asset definition are derived from.
  * A Python function, which is responsible for computing the contents of the asset from its upstream dependencies and storing the results.


## Asset decorators[​](https://docs.dagster.io/guides/build/assets/defining-assets#asset-decorators "Direct link to Asset decorators")
Dagster has four types of asset decorators:  
| Decorator  | Description  |  
| --- | --- |  
| `@asset`  | Defines a single asset. [See an example](https://docs.dagster.io/guides/build/assets/defining-assets#single-asset).  |  
| `@multi_asset`  | Outputs multiple assets from a single operation. [See an example](https://docs.dagster.io/guides/build/assets/defining-assets#multi-asset).  |  
| `@graph_asset`  | Outputs a single asset from multiple operations without making each operation itself an asset. [See an example](https://docs.dagster.io/guides/build/assets/defining-assets#graph-asset).  |  
| `@graph_multi_asset`  | Outputs multiple assets from multiple operations  |  
## Defining operations that create a single asset[​](https://docs.dagster.io/guides/build/assets/defining-assets#single-asset "Direct link to Defining operations that create a single asset")
The simplest way to define a data asset in Dagster is by using the [`@dg.asset`](https://docs.dagster.io/api/dagster/assets#dagster.asset) decorator. This decorator marks a Python function as an asset.
src/<project_name>/defs/assets.py

```
import dagster as dg  
  
  
@dg.asset  
def daily_sales() -> None: ...  
  
  
@dg.asset(deps=[daily_sales], group_name="sales")  
def weekly_sales() -> None: ...  
  
  
@dg.asset(  
    deps=[weekly_sales],  
    owners=["bighead@hooli.com", "team:roof", "team:corpdev"],  
)  
def weekly_sales_report(context: dg.AssetExecutionContext):  
    context.log.info("Loading data for my_dataset")  

```

In this example, `weekly_sales_report` is an asset that logs its output. Dagster automatically tracks its dependencies and handles its execution within the pipeline.
## Defining operations that create multiple assets[​](https://docs.dagster.io/guides/build/assets/defining-assets#multi-asset "Direct link to Defining operations that create multiple assets")
When you need to generate multiple assets from a single operation, you can use the [`@dg.multi_asset`](https://docs.dagster.io/api/dagster/assets#dagster.multi_asset) decorator. This allows you to output multiple assets while maintaining a single processing function, which could be useful for:
  * Making a single call to an API that updates multiple tables
  * Using the same in-memory object to compute multiple assets


In this example, `my_multi_asset` is a single function that materializes two assets: `asset_one` and `asset_two`. This makes it easier to handle related data transformations together:
src/<project_name>/defs/assets.py

```
import dagster as dg  
  
  
@dg.multi_asset(specs=[dg.AssetSpec("asset_one"), dg.AssetSpec("asset_two")])  
def my_multi_asset():  
    yield dg.MaterializeResult(asset_key="asset_one", metadata={"num_rows": 10})  
    yield dg.MaterializeResult(asset_key="asset_two", metadata={"num_rows": 24})  

```

The function `my_multi_asset` produces two separate assets that appear in your asset graph:
![2048 resolution](https://docs.dagster.io/assets/images/multi_asset-e2445c2551d8b71ade3f0fb2778400d1.png)
Note that `my_multi_asset` is the function name, not an asset itself. When you materialize either `asset_one` or `asset_two`, the `my_multi_asset` function is executed.
## Defining multiple operations that create a single asset[​](https://docs.dagster.io/guides/build/assets/defining-assets#graph-asset "Direct link to Defining multiple operations that create a single asset")
For cases where you need to perform multiple operations to produce a single asset, you can use the [`@dg.graph_asset`](https://docs.dagster.io/api/dagster/assets#dagster.graph_asset) decorator. This approach encapsulates a series of operations and exposes them as a single asset, allowing you to model complex pipelines while only exposing the final output.
src/<project_name>/defs/assets.py

```
from random import randint  
  
import dagster as dg  
  
  
@dg.op(  
    retry_policy=dg.RetryPolicy(  
        max_retries=5,  
        delay=0.2,  # 200ms  
        backoff=dg.Backoff.EXPONENTIAL,  
        jitter=dg.Jitter.PLUS_MINUS,  
    )  
)  
def step_one() -> int:  
    if randint(0, 2) >= 1:  
        raise Exception("Flaky step that may fail randomly")  
    return 42  
  
  
@dg.op  
def step_two(num: int):  
    return num**2  
  
  
@dg.graph_asset  
def complex_asset():  
    return step_two(step_one())  

```

In this example, `complex_asset` is an asset that's the result of two operations: `step_one` and `step_two`. These steps are combined into a single asset, abstracting away the intermediate representations:
![2048 resolution](https://docs.dagster.io/assets/images/complex_asset-ca60184cf66c5c3dbb1922e5cee8d870.png)
## Asset context[​](https://docs.dagster.io/guides/build/assets/defining-assets#asset-context "Direct link to Asset context")
When defining an asset, you can optionally provide a first parameter, `context`. When this parameter is supplied, Dagster will supply an [`AssetExecutionContext`](https://docs.dagster.io/api/dagster/execution#dagster.AssetExecutionContext) object to the body of the asset which provides access to system information like loggers and the current run ID.
For example, to access the logger and log an info message:
src/<project_name>/defs/assets.py

```
import dagster as dg  
  
  
@dg.asset  
def context_asset(context: dg.AssetExecutionContext):  
    context.log.info(f"My run ID is {context.run.run_id}")  
    ...  
  

```

## Asset code versions[​](https://docs.dagster.io/guides/build/assets/defining-assets#asset-code-versions "Direct link to Asset code versions")
Assets may be assigned a `code_version`. Versions let you help Dagster track what assets haven't been re-materialized since their code has changed, and avoid performing redundant computation.
src/<project_name>/defs/assets.py

```
@dg.asset(code_version="1")  
def asset_with_version():  
    with open("data/asset_with_version.json", "w") as f:  
        json.dump(100, f)  
  

```

When an asset with a code version is materialized, the generated `AssetMaterialization` is tagged with the version. The UI will indicate when an asset has a different code version than the code version used for its most recent materialization.
## Assets with multi-part keys[​](https://docs.dagster.io/guides/build/assets/defining-assets#assets-with-multi-part-keys "Direct link to Assets with multi-part keys")
Assets are often objects in systems with hierarchical namespaces, like filesystems. Because of this, it often makes sense for an asset key to be a list of strings, instead of just a single string. To define an asset with a multi-part asset key, use the `key_prefix` argument with a list of strings. The full asset key is formed by prepending the `key_prefix` to the asset name (which defaults to the name of the decorated function).
src/<project_name>/defs/assets.py

```
import dagster as dg  
  
  
@dg.asset(key_prefix=["one", "two", "three"])  
def upstream_asset():  
    return [1, 2, 3]  
  
  
@dg.asset(ins={"upstream_asset": dg.AssetIn(key_prefix=["one", "two", "three"])})  
def downstream_asset(upstream_asset):  
    return upstream_asset + [4]  
  

```

## Next steps[​](https://docs.dagster.io/guides/build/assets/defining-assets#next-steps "Direct link to Next steps")
  * Learn how to model ETL pipelines and other multi-step processes in [Modeling ETL pipelines with assets](https://docs.dagster.io/guides/build/assets/modeling-etl-pipelines)
  * Enrich Dagster's built-in data catalog with [asset metadata](https://docs.dagster.io/guides/build/assets/metadata-and-tags)
  * Learn to [pass data between assets](https://docs.dagster.io/guides/build/assets/passing-data-between-assets)
  * Learn to use a [factory pattern](https://docs.dagster.io/guides/build/assets/creating-asset-factories) to create multiple, similar assets


[Edit this page](https://github.com/dagster-io/dagster/tree/master/docs/docs/guides/build/assets/defining-assets.md)
[Previous Assets](https://docs.dagster.io/guides/build/assets)[Next Defining assets that depend on other assets](https://docs.dagster.io/guides/build/assets/defining-assets-with-asset-dependencies)
  * [Asset decorators](https://docs.dagster.io/guides/build/assets/defining-assets#asset-decorators)
  * [Defining operations that create a single asset](https://docs.dagster.io/guides/build/assets/defining-assets#single-asset)
  * [Defining operations that create multiple assets](https://docs.dagster.io/guides/build/assets/defining-assets#multi-asset)
  * [Defining multiple operations that create a single asset](https://docs.dagster.io/guides/build/assets/defining-assets#graph-asset)
  * [Asset context](https://docs.dagster.io/guides/build/assets/defining-assets#asset-context)
  * [Asset code versions](https://docs.dagster.io/guides/build/assets/defining-assets#asset-code-versions)
  * [Assets with multi-part keys](https://docs.dagster.io/guides/build/assets/defining-assets#assets-with-multi-part-keys)
  * [Next steps](https://docs.dagster.io/guides/build/assets/defining-assets#next-steps)


[Terms of Service](https://www.dagster.io/terms) [Privacy Policy](https://www.dagster.io/privacy/) [Security](https://www.dagster.io/security/) Cookie Preferences
[![](https://docs.dagster.io/icons/twitter.svg)](https://twitter.com/dagster "X") [![](https://docs.dagster.io/icons/slack.svg)](https://www.dagster.io/slack/ "Community Slack") [![](https://docs.dagster.io/icons/github.svg)](https://github.com/dagster-io/dagster "GitHub") [![](https://docs.dagster.io/icons/youtube.svg)](https://www.youtube.com/channel/UCfLnv9X8jyHTe6gJ4hVBo9Q/videos "Youtube")
[![Dagster Logo](https://docs.dagster.io/img/dagster_labs-primary-horizontal.svg)](https://docs.dagster.io/)
Copyright 2026 Dagster Labs
Ask Dagster AI
![](https://bat.bing.com/action/0?ti=343107175&tm=gtm002&Ver=2&mid=63d1bf18-2d12-494b-aca9-120598a41674&bo=1&sid=c01f0ac06dd211f1adbd59eeff959f92&vid=c01f26406dd211f197091d06e3e73ee8&vids=1&msclkid=N&pi=918639831&lg=en-US&sw=1080&sh=600&sc=24&tl=Defining%20assets%20%7C%20Dagster%20Docs&kw=assets,defining,decorator&p=https%3A%2F%2Fdocs.dagster.io%2Fguides%2Fbuild%2Fassets%2Fdefining-assets&r=&lt=580&evt=pageLoad&sv=2&cdb=ARoR&rn=2372)
