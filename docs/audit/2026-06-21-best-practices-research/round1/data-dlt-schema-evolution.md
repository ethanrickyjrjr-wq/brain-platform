We use essential cookies to make our site work. With your consent, we may also use non-essential cookies to improve user experience and analyze website traffic. By clicking “Accept,” you agree to our website's cookie use as described in our Cookie Policy. You can change your cookie settings at any time by clicking “Preferences.” 
PreferencesDeclineAccept
[Skip to main content](https://dlthub.com/docs/general-usage/schema-evolution#__docusaurus_skipToContent_fallback)
[![dlt Docs Logo](https://dlthub.com/docs/img/dlthub-logo.png)](https://dlthub.com)
[1.28.1 (latest)](https://dlthub.com/docs/general-usage/schema-evolution)
  * [devel](https://dlthub.com/docs/devel/general-usage/schema-evolution)
  * [1.28.1 (latest)](https://dlthub.com/docs/general-usage/schema-evolution)


[dltHub](https://dlthub.com/docs/hub/getting-started/introduction)[dlt](https://dlthub.com/docs/intro)[Cookbook](https://dlthub.com/docs/examples)[Education](https://dlthub.com/docs/tutorial/education)[What's new?](https://dlthub.com/docs/release-highlights)
[Blog](https://dlthub.com/blog)[](https://dlthub.com/community)[](https://github.com/dlt-hub/dlt)
Search
  * [Getting started](https://dlthub.com/docs/general-usage/schema-evolution)
  * [Core concepts](https://dlthub.com/docs/general-usage/schema-evolution)
  * [Sources](https://dlthub.com/docs/general-usage/schema-evolution)
  * [Destinations](https://dlthub.com/docs/general-usage/schema-evolution)
  * [Configuration & secrets](https://dlthub.com/docs/general-usage/credentials)
  * [Load strategy](https://dlthub.com/docs/general-usage/schema-evolution)
  * [Schema management](https://dlthub.com/docs/general-usage/schema-evolution)
    * [Schema contract](https://dlthub.com/docs/general-usage/schema-contracts)
    * [Schema evolution](https://dlthub.com/docs/general-usage/schema-evolution)
    * [Export & visualize](https://dlthub.com/docs/general-usage/dataset-access/view-dlt-schema)
    * [Destination tables & lineage](https://dlthub.com/docs/general-usage/destination-tables)
    * [Manually edit a schema](https://dlthub.com/docs/walkthroughs/adjust-a-schema)
    * [Naming convention](https://dlthub.com/docs/general-usage/naming-convention)
  * [Transformations](https://dlthub.com/docs/dlt-ecosystem/transformations)
  * [Data quality](https://dlthub.com/docs/general-usage/schema-evolution)
  * [Deploy](https://dlthub.com/docs/walkthroughs/deploy-a-pipeline)
  * [Performance](https://dlthub.com/docs/reference/performance)
  * [Reference](https://dlthub.com/docs/general-usage/schema-evolution)


  * Schema management
  * Schema evolution

Version: 1.28.1 (latest) [View Markdown](https://dlthub.com/docs/general-usage/schema-evolution.md)
On this page
# Schema evolution
## Schema evolution with `dlt`[​](https://dlthub.com/docs/general-usage/schema-evolution#schema-evolution-with-dlt "Direct link to schema-evolution-with-dlt")
`dlt` automatically infers the initial schema for your first pipeline run. However, in most cases, the schema tends to change over time, which makes it critical for downstream consumers to adapt to schema changes.
As the structure of data changes, such as the addition of new columns or changing data types, `dlt` handles these schema changes, enabling you to adapt to changes without losing velocity.
## Inferring a schema from nested data[​](https://dlthub.com/docs/general-usage/schema-evolution#inferring-a-schema-from-nested-data "Direct link to Inferring a schema from nested data")
The first run of a pipeline will scan the data that goes through it and generate a schema. To convert nested data into a relational format, `dlt` flattens dictionaries and unpacks nested lists into sub-tables.
We'll review some examples here and figure out how `dlt` creates the initial schema and how normalization works. Consider a pipeline that loads the following schema:

```
data = [{  
    "organization": "Tech Innovations Inc.",  
    "address": {  
        'building': 'r&d',  
        "room": 7890,  
    },  
    "Inventory": [  
        {"name": "Plasma ray", "inventory nr": 2411},  
        {"name": "Self-aware Roomba", "inventory nr": 268},  
        {"name": "Type-inferrer", "inventory nr": 3621}  
    ]  
}]  
  
# Run `dlt` pipeline  
dlt.pipeline("organizations_pipeline", destination="duckdb").run(data, table_name="org")  

```

The schema of data above is loaded to the destination as follows:
### What did the schema inference engine do?[​](https://dlthub.com/docs/general-usage/schema-evolution#what-did-the-schema-inference-engine-do "Direct link to What did the schema inference engine do?")
As you can see above, the dlt's inference engine generates the structure of the data based on the source and provided hints. It normalizes the data, creates tables and columns, and infers data types.
For more information, you can refer to the [Schema](https://dlthub.com/docs/general-usage/schema) and [Adjust a Schema](https://dlthub.com/docs/walkthroughs/adjust-a-schema) sections in the documentation.
## Evolving the schema[​](https://dlthub.com/docs/general-usage/schema-evolution#evolving-the-schema "Direct link to Evolving the schema")
For a typical data source, the schema tends to change over time, and dlt handles this changing schema seamlessly.
Let’s add the following 4 cases:
  * A column is added: a field named “CEO” was added.
  * A column type is changed: The datatype of the column named “inventory_nr” was changed from integer to string.
  * A column is removed: a field named “room” was commented out/removed.
  * A column is renamed: a field “building” was renamed to “main_block”.


Please update the pipeline for the cases discussed above.

```
data = [{  
    "organization": "Tech Innovations Inc.",  
    # Column added:  
    "CEO": "Alice Smith",  
    "address": {  
        # 'building' renamed to 'main_block'  
        'main_block': 'r&d',  
	      # Removed room column  
        # "room": 7890,  
    },  
    "Inventory": [  
        # Type change: 'inventory_nr' changed to string from int  
        {"name": "Plasma ray", "inventory nr": "AR2411"},  
        {"name": "Self-aware Roomba", "inventory nr": "AR268"},  
        {"name": "Type-inferrer", "inventory nr": "AR3621"}  
    ]  
}]  
  
# Run `dlt` pipeline  
dlt.pipeline("organizations_pipeline", destination="duckdb").run(data, table_name="org")  

```

Let’s load the data and look at the tables:
What happened?
  * Added column:
    * A new column named `ceo` is added to the “org” table.
  * Variant column:
    * A new column named `inventory_nr__v_text` is added as the datatype of the column was changed from “integer” to “string”.
  * Removed column stopped loading:
    * New data to column `room` is not loaded.
  * Column stopped loading and new one was added:
    * A new column `address__main_block` was added and now data will be loaded to that and stop loading in the column `address__building`.


## Alert schema changes to curate new data[​](https://dlthub.com/docs/general-usage/schema-evolution#alert-schema-changes-to-curate-new-data "Direct link to Alert schema changes to curate new data")
By separating the technical process of loading data from curation, you free the data engineer to do engineering, and the analytics to curate data without technical obstacles. So, the analyst must be kept in the loop.
**Tracking column lineage**
The column lineage can be tracked by loading the 'load_info' to the destination. The 'load_info' contains information about columns’ data types, add times, and load id. To read more please see [the data lineage article](https://dlthub.com/blog/dlt-data-lineage) we have on the blog.
**Getting notifications**
We can read the load outcome and send it to a Slack webhook with dlt.

```
# Import the send_slack_message function from the dlt library  
from dlt.common.runtime.slack import send_slack_message  
  
# Define the URL for your Slack webhook  
hook = "https://hooks.slack.com/services/xxx/xxx/xxx"  
  
# Iterate over each package in the load_info object  
for package in load_info.load_packages:  
    # Iterate over each table in the schema_update of the current package  
    for table_name, table in package.schema_update.items():  
        # Iterate over each column in the current table  
        for column_name, column in table["columns"].items():  
            # Send a message to the Slack channel with the table  
						# and column update information  
            send_slack_message(  
                hook,  
                message=(  
                    f"\tTable updated: {table_name}: "  
                    f"Column changed: {column_name}: "  
                    f"{column['data_type']}"  
                )  
            )  

```

This script sends Slack notifications for schema updates using the `send_slack_message` function from the `dlt` library. It provides details on the updated table and column.
## How to control evolution[​](https://dlthub.com/docs/general-usage/schema-evolution#how-to-control-evolution "Direct link to How to control evolution")
`dlt` allows schema evolution control via its schema and data contracts. Refer to our **[documentation](https://dlthub.com/docs/general-usage/schema-contracts)** for details.
### How to test for removed columns - applying "not null" constraint[​](https://dlthub.com/docs/general-usage/schema-evolution#how-to-test-for-removed-columns---applying-not-null-constraint "Direct link to How to test for removed columns - applying "not null" constraint")
A column not existing and a column being null are two different things. However, when it comes to APIs and JSON, it’s usually all treated the same - the key-value pair will simply not exist.
To remove a column, exclude it from the output of the resource function. Subsequent data inserts will treat this column as null. Verify column removal by applying a not null constraint. For instance, after removing the "room" column, apply a not null constraint to confirm its exclusion.

```
data = [{  
    "organization": "Tech Innovations Inc.",  
    "address": {  
        'building': 'r&d'  
        #"room": 7890,  
    },  
    "Inventory": [  
        {"name": "Plasma ray", "inventory nr": 2411},  
        {"name": "Self-aware Roomba", "inventory nr": 268},  
        {"name": "Type-inferrer", "inventory nr": 3621}  
    ]  
}]  
  
pipeline = dlt.pipeline("organizations_pipeline", destination="duckdb")  
# Adding not null constraint  
pipeline.run(data, table_name="org", columns={"room": {"data_type": "bigint", "nullable": False}})  

```

During pipeline execution, a data validation error indicates that a removed column is being passed as null.
## Some schema changes in the data[​](https://dlthub.com/docs/general-usage/schema-evolution#some-schema-changes-in-the-data "Direct link to Some schema changes in the data")
The data in the pipeline mentioned above is modified.

```
data = [{  
    "organization": "Tech Innovations Inc.",  
    "CEO": "Alice Smith",  
    "address": {'main_block': 'r&d'},  
    "Inventory": [  
        {"name": "Plasma ray", "inventory nr": "AR2411"},  
        {"name": "Self-aware Roomba", "inventory nr": "AR268"},  
        {  
            "name": "Type-inferrer", "inventory nr": "AR3621",  
            "details": {  
                "category": "Computing Devices",  
                "id": 369,  
                "specifications": [{  
                    "processor": "Quantum Core",  
                    "memory": "512PB"  
                }]  
            }  
        }  
    ]  
}]  
  
# Run `dlt` pipeline  
dlt.pipeline("organizations_pipeline", destination="duckdb").run(data, table_name="org")  

```

The schema of the data above is loaded to the destination as follows:
## What did the schema evolution engine do?[​](https://dlthub.com/docs/general-usage/schema-evolution#what-did-the-schema-evolution-engine-do "Direct link to What did the schema evolution engine do?")
The schema evolution engine in the `dlt` library is designed to handle changes in the structure of your data over time. For example:
  * As above in continuation of the inferred schema, the “specifications” are nested in "details", which are nested in “Inventory”, all under the table name “org”. So the table created for projects is `org__inventory__details__specifications`.


This is a simple example of how schema evolution works.
## Schema evolution using schema and data contracts[​](https://dlthub.com/docs/general-usage/schema-evolution#schema-evolution-using-schema-and-data-contracts "Direct link to Schema evolution using schema and data contracts")
Demonstrating schema evolution without talking about schema and data contracts is only one side of the coin. Schema and data contracts dictate the terms of how the schema being written to the destination should evolve.
Schema and data contracts can be applied to entities such as ‘tables’, ‘columns’, and ‘data_types’ using contract modes such as ‘evolve’, ‘freeze’, ‘discard_rows’, and ‘discard_columns’ to tell dlt how to apply contracts for a particular entity. To read more about **schema and data contracts** , read our [documentation](https://dlthub.com/docs/general-usage/schema-contracts).
[Edit this page](https://github.com/dlt-hub/dlt/tree/devel/docs/website/docs/general-usage/schema-evolution.md)
[Previous Schema contract](https://dlthub.com/docs/general-usage/schema-contracts)[Next Export & visualize](https://dlthub.com/docs/general-usage/dataset-access/view-dlt-schema)
  * [Schema evolution with `dlt`](https://dlthub.com/docs/general-usage/schema-evolution#schema-evolution-with-dlt)
  * [Inferring a schema from nested data](https://dlthub.com/docs/general-usage/schema-evolution#inferring-a-schema-from-nested-data)
    * [What did the schema inference engine do?](https://dlthub.com/docs/general-usage/schema-evolution#what-did-the-schema-inference-engine-do)
  * [Evolving the schema](https://dlthub.com/docs/general-usage/schema-evolution#evolving-the-schema)
  * [Alert schema changes to curate new data](https://dlthub.com/docs/general-usage/schema-evolution#alert-schema-changes-to-curate-new-data)
  * [How to control evolution](https://dlthub.com/docs/general-usage/schema-evolution#how-to-control-evolution)
    * [How to test for removed columns - applying "not null" constraint](https://dlthub.com/docs/general-usage/schema-evolution#how-to-test-for-removed-columns---applying-not-null-constraint)
  * [Some schema changes in the data](https://dlthub.com/docs/general-usage/schema-evolution#some-schema-changes-in-the-data)
  * [What did the schema evolution engine do?](https://dlthub.com/docs/general-usage/schema-evolution#what-did-the-schema-evolution-engine-do)
  * [Schema evolution using schema and data contracts](https://dlthub.com/docs/general-usage/schema-evolution#schema-evolution-using-schema-and-data-contracts)


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
