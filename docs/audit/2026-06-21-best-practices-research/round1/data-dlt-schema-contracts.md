We use essential cookies to make our site work. With your consent, we may also use non-essential cookies to improve user experience and analyze website traffic. By clicking “Accept,” you agree to our website's cookie use as described in our Cookie Policy. You can change your cookie settings at any time by clicking “Preferences.” 
PreferencesDeclineAccept
[Skip to main content](https://dlthub.com/docs/general-usage/schema-contracts#__docusaurus_skipToContent_fallback)
[![dlt Docs Logo](https://dlthub.com/docs/img/dlthub-logo.png)](https://dlthub.com)
[1.28.1 (latest)](https://dlthub.com/docs/general-usage/schema-contracts)
  * [devel](https://dlthub.com/docs/devel/general-usage/schema-contracts)
  * [1.28.1 (latest)](https://dlthub.com/docs/general-usage/schema-contracts)


[dltHub](https://dlthub.com/docs/hub/getting-started/introduction)[dlt](https://dlthub.com/docs/intro)[Cookbook](https://dlthub.com/docs/examples)[Education](https://dlthub.com/docs/tutorial/education)[What's new?](https://dlthub.com/docs/release-highlights)
[Blog](https://dlthub.com/blog)[](https://dlthub.com/community)[](https://github.com/dlt-hub/dlt)
Search
  * [Getting started](https://dlthub.com/docs/general-usage/schema-contracts)
  * [Core concepts](https://dlthub.com/docs/general-usage/schema-contracts)
  * [Sources](https://dlthub.com/docs/general-usage/schema-contracts)
  * [Destinations](https://dlthub.com/docs/general-usage/schema-contracts)
  * [Configuration & secrets](https://dlthub.com/docs/general-usage/credentials)
  * [Load strategy](https://dlthub.com/docs/general-usage/schema-contracts)
  * [Schema management](https://dlthub.com/docs/general-usage/schema-contracts)
    * [Schema contract](https://dlthub.com/docs/general-usage/schema-contracts)
    * [Schema evolution](https://dlthub.com/docs/general-usage/schema-evolution)
    * [Export & visualize](https://dlthub.com/docs/general-usage/dataset-access/view-dlt-schema)
    * [Destination tables & lineage](https://dlthub.com/docs/general-usage/destination-tables)
    * [Manually edit a schema](https://dlthub.com/docs/walkthroughs/adjust-a-schema)
    * [Naming convention](https://dlthub.com/docs/general-usage/naming-convention)
  * [Transformations](https://dlthub.com/docs/dlt-ecosystem/transformations)
  * [Data quality](https://dlthub.com/docs/general-usage/schema-contracts)
  * [Deploy](https://dlthub.com/docs/walkthroughs/deploy-a-pipeline)
  * [Performance](https://dlthub.com/docs/reference/performance)
  * [Reference](https://dlthub.com/docs/general-usage/schema-contracts)


  * Schema management
  * Schema contract

Version: 1.28.1 (latest) [View Markdown](https://dlthub.com/docs/general-usage/schema-contracts.md)
On this page
# Schema contract
`dlt` will evolve the schema at the destination by following the structure and data types of the extracted data. There are several modes that you can use to control this automatic schema evolution, from the default modes where all changes to the schema are accepted to a frozen schema that does not change at all.
Consider this example:

```
@dlt.resource(schema_contract={"tables": "evolve", "columns": "freeze"})  
def items():  
    ...  

```

This resource will allow new tables (both nested tables and [tables with dynamic names](https://dlthub.com/docs/general-usage/resource#dispatch-data-to-many-tables)) to be created, but will throw an exception if data is extracted for an existing table which contains a new column.
### Setting up the contract[​](https://dlthub.com/docs/general-usage/schema-contracts#setting-up-the-contract "Direct link to Setting up the contract")
You can control the following **schema entities** :
  * `tables` - the contract is applied when a new table is created
  * `columns` - the contract is applied when a new column is created on an existing table
  * `data_type` - the contract is applied when a data type property of an existing column changes. This includes variant columns (where data cannot be coerced into the existing type) as well as explicit changes to `data_type`, `nullable`, `precision`, `scale`, or `timezone` on a column that is already complete.


You can use **contract modes** to tell `dlt` how to apply the contract for a particular entity:
  * `evolve`: No constraints on schema changes.
  * `freeze`: This will raise an exception if data is encountered that does not fit the existing schema, so no data will be loaded to the destination.
  * `discard_row`: This will discard any extracted row if it does not adhere to the existing schema, and this row will not be loaded to the destination.
  * `discard_value`: This will discard data in an extracted row that does not adhere to the existing schema, and the row will be loaded without this data.


note
The default mode (**evolve**) works as follows:
  1. New tables may always be created.
  2. New columns may always be appended to the existing table.
  3. Data that do not coerce to the existing data type of a particular column will be sent to a [variant column](https://dlthub.com/docs/general-usage/schema#variant-columns) created for this particular type.


#### Passing the schema_contract argument[​](https://dlthub.com/docs/general-usage/schema-contracts#passing-the-schema_contract-argument "Direct link to Passing the schema_contract argument")
The `schema_contract` exists on the [dlt.source](https://dlthub.com/docs/general-usage/source) decorator as a default for all resources in that source and on the [dlt.resource](https://dlthub.com/docs/general-usage/source) decorator as a directive for the individual resource - and as a consequence - on all tables created by this resource. Additionally, it exists on the `pipeline.run()` method, which will override all existing settings.
The `schema_contract` argument accepts two forms:
  1. **full** : a mapping of schema entities to contract modes
  2. **shorthand** : a contract mode (string) that will be applied to all schema entities.


For example, setting `schema_contract` to _freeze_ will expand to the full form:

```
{"tables": "freeze", "columns": "freeze", "data_type": "freeze"}  

```

You can change the contract on the **source** instance via the `schema_contract` property. For **resource** , you can use [apply_hints](https://dlthub.com/docs/general-usage/resource#set-table-name-and-adjust-schema).
#### Nuances of contract modes[​](https://dlthub.com/docs/general-usage/schema-contracts#nuances-of-contract-modes "Direct link to Nuances of contract modes")
  1. Contracts are applied **after names of tables and columns are normalized**.
  2. A contract defined on a resource is applied to all root tables and nested tables created by that resource.
  3. `discard_row` works on the table level. For example, if you have two tables in a nested relationship, i.e., _users_ and _users__addresses_ , and the contract is violated in the _users__addresses_ table, the row of that table is discarded while the parent row in the _users_ table will be loaded.


### Use Pydantic models for data validation[​](https://dlthub.com/docs/general-usage/schema-contracts#use-pydantic-models-for-data-validation "Direct link to Use Pydantic models for data validation")
Pydantic models can be used to [define table schemas and validate incoming data](https://dlthub.com/docs/general-usage/resource#define-a-schema-with-pydantic). You can use any model you already have. `dlt` will internally synthesize (if necessary) new models that conform to the **schema contract** on the resource.
Just passing a model in the `column` argument of the [dlt.resource](https://dlthub.com/docs/general-usage/resource#define-a-schema-with-pydantic) sets a schema contract that conforms to the default Pydantic behavior:

```
{  
  "tables": "evolve",  
  "columns": "discard_value",  
  "data_type": "freeze"  
}  

```

New tables are allowed, extra fields are ignored, and invalid data raises an exception.
If you pass a schema contract explicitly, the following happens to schema entities:
  1. **tables** do not impact the Pydantic models.
  2. **columns** modes are mapped into the **extra** modes of Pydantic (see below). `dlt` will apply this setting recursively if models contain other models.
  3. **data_type** supports the following modes for Pydantic: **evolve** will synthesize a lenient model that allows for any data type. This may result in variant columns upstream. **freeze** will re-raise `ValidationException`. **discard_row** will remove the non-validating data items. **discard_value** is not currently supported. We may eventually do that in Pydantic v2.


`dlt` maps column contract modes into the extra fields settings as follows.
Note that this works in two directions. If you use a model with such a setting explicitly configured, `dlt` sets the column contract mode accordingly. This also avoids synthesizing modified models.  
| column mode  | pydantic extra  |  
| --- | --- |  
| evolve  | allow  |  
| freeze  | forbid  |  
| discard_value  | ignore  |  
| discard_row  | forbid  |  
`discard_row` requires additional handling when a ValidationError is raised.
tip
Model validation is added as a [transform step](https://dlthub.com/docs/general-usage/resource#filter-transform-and-pivot-data) to the resource. This step will convert the incoming data items into instances of validating models. You could easily convert them back to dictionaries by using `add_map(lambda item: item.model_dump())` on a resource.
Alternatively, you can configure your Pydantic model to return validated model instances instead of dictionaries using the `DltConfig` options. See [Pydantic model configuration](https://dlthub.com/docs/general-usage/resource#define-a-schema-with-pydantic) for available options like `skip_nested_types` and `return_validated_models`.
note
Pydantic models work on the **extracted** data **before names are normalized or nested tables are created**. Make sure to name model fields as in your input data and handle nested data with nested models.
As a consequence, `discard_row` will drop the whole data item - even if a nested model was affected.
### Authoritative Pydantic models[​](https://dlthub.com/docs/general-usage/schema-contracts#authoritative-pydantic-models "Direct link to Authoritative Pydantic models")
Work in progress
Authoritative Pydantic models are under active development. Behavior below may change in future releases.
By default, columns derived from a Pydantic model are subject to schema contract checks just like any other columns. If you want the model to be treated as the **authoritative source of truth** — so its columns bypass `columns` and `data_type` contract enforcement — set `is_authoritative_model` in `DltConfig`:

```
from typing import ClassVar  
  
from pydantic import BaseModel  
  
from dlt.common.libs.pydantic import DltConfig  
  
  
class MyModel(BaseModel):  
    dlt_config: ClassVar[DltConfig] = {"is_authoritative_model": True}  
  
    class Config:  
        extra = "forbid"  
  
    id: int  
    name: str  

```

With `is_authoritative_model=True`, if you later add an `email` field to `MyModel`, the new column will be accepted on existing tables even though `extra=forbid` maps to `columns=freeze`. The `freeze` contract will still reject any extra fields in the **data** that are not defined in the model.
Without `is_authoritative_model` (the default), adding a new field to the model while `columns=freeze` is active will raise a `DataValidationError` — the same as adding a column from any other data source.
tip
If your goal is to maintain strict data validation (`extra=forbid`) while allowing you to change the model explicitly, set `is_authoritative_model=True`. Without it, you would need to set `schema_contract={"columns": "evolve"}`, which would also override `extra=forbid` and allow unknown fields through validation.
### Validating event streams with Pydantic[​](https://dlthub.com/docs/general-usage/schema-contracts#validating-event-streams-with-pydantic "Direct link to Validating event streams with Pydantic")
When a single resource produces items of different types (e.g., an event stream), you can use a Pydantic [discriminated union](https://docs.pydantic.dev/latest/concepts/unions/#discriminated-unions) wrapped in a `RootModel` to validate and dispatch them. Each variant model defines its own columns, and `dlt` resolves the correct variant per item using the discriminator field — without re-validating.
Define variant models with a shared `Literal` discriminator field and combine them in a `RootModel`:

```
from typing import ClassVar, Literal, Union  
from typing_extensions import Annotated  
from pydantic import BaseModel, Field, RootModel  
from dlt.common.libs.pydantic import DltConfig  
  
  
class EventBase(BaseModel):  
    kind: str  
    id: int  
  
class ClickEvent(EventBase):  
    kind: Literal["click"]  
    element_id: str  
  
class PurchaseEvent(EventBase):  
    kind: Literal["purchase"]  
    amount: float  
  
EventUnion = Annotated[  
    Union[ClickEvent, PurchaseEvent],  
    Field(discriminator="kind"),  
]  
  
class Event(RootModel[EventUnion]):  
    dlt_config: ClassVar[DltConfig] = {"is_authoritative_model": True}  

```

A common base class (like `EventBase` above) is optional. When present, `dlt` can derive the shared columns (`kind`, `id`) even without a specific data item.
Dispatch items to per-type tables using `dlt.mark.with_table_name` or a dynamic `table_name` function. The table names do not need to match the discriminator values:

```
import dlt  
  
  
TABLE_MAP = {"click": "click_events", "purchase": "purchase_events"}  
  
@dlt.resource(  
    name="events",  
    columns=Event,  
    schema_contract={"data_type": "discard_row"},  
)  
def event_stream():  
    for item in items:  
        yield dlt.mark.with_table_name(item, TABLE_MAP[item["kind"]])  

```

Each destination table receives only the columns defined by its variant model. For example, the `click_events` table gets `kind`, `id`, and `element_id`, while `purchase_events` gets `kind`, `id`, and `amount`.
#### Items not matching any variant[​](https://dlthub.com/docs/general-usage/schema-contracts#items-not-matching-any-variant "Direct link to Items not matching any variant")
When an item's discriminator value does not match any variant in the union (e.g., a `"debug"` event when only `"click"` and `"purchase"` are defined), the **data_type** contract controls what happens:  
| data_type mode  | behavior  |  
| --- | --- |  
| evolve  | Validation is bypassed; the item passes through as-is  |  
| discard_row  | The item is silently dropped  |  
| freeze  | Raises an exception  |  
note
`data_type: discard_value` is not supported with Pydantic models. Use `discard_row` instead.
### Set contracts on Arrow tables, Pandas, and Polars[​](https://dlthub.com/docs/general-usage/schema-contracts#set-contracts-on-arrow-tables-pandas-and-polars "Direct link to Set contracts on Arrow tables, Pandas, and Polars")
All contract settings apply to [Arrow tables, Pandas or Polars DataFrames](https://dlthub.com/docs/dlt-ecosystem/verified-sources/arrow-pandas) as well.
  1. **tables** mode is the same - no matter what the data item type is.
  2. **columns** will allow new columns, raise an exception, or modify tables/frames still in the extract step to avoid rewriting Parquet files.
  3. **data_type** applies to variant columns and to changes in type properties (`data_type`, `nullable`, `precision`, `scale`, `timezone`) on existing complete columns. The contract will raise an exception, discard the column, or discard the row depending on the mode.


Here's how `dlt` deals with column modes:
  1. **evolve** new columns are allowed (the table may be reordered to put them at the end).
  2. **discard_value** the column will be deleted.
  3. **discard_row** rows with the column present will be deleted and then the column will be deleted.
  4. **freeze** an exception on a new column.


### Get context from DataValidationError in freeze mode[​](https://dlthub.com/docs/general-usage/schema-contracts#get-context-from-datavalidationerror-in-freeze-mode "Direct link to Get context from DataValidationError in freeze mode")
When a contract is violated in freeze mode, `dlt` raises a `DataValidationError` exception. This exception provides access to the full context and passes the evidence to the caller. As with any other exception coming from a pipeline run, it will be re-raised via a `PipelineStepFailed` exception, which you should catch in an except block:

```
try:  
  pipeline.run()  
except PipelineStepFailed as pip_ex:  
  if pip_ex.step == "normalize":  
    if isinstance(pip_ex.__context__.__context__, DataValidationError):  
      ...  
  if pip_ex.step == "extract":  
    if isinstance(pip_ex.__context__, DataValidationError):  
      ...  

```

`DataValidationError` provides the following context:
  1. `schema_name`, `table_name`, and `column_name` provide the logical "location" at which the contract was violated.
  2. `schema_entity` and `contract_mode` indicate which contract was violated.
  3. `table_schema` contains the schema against which the contract was validated. It may be a Pydantic model or a dlt `TTableSchema` instance.
  4. `schema_contract` is the full, expanded schema contract.
  5. `data_item` is the causing data item (Python dict, arrow table, Pydantic model, or list thereof).


### Contracts on new tables[​](https://dlthub.com/docs/general-usage/schema-contracts#contracts-on-new-tables "Direct link to Contracts on new tables")
If a table is a **new table** that has not been created on the destination yet, dlt will allow the creation of new columns. For a single pipeline run, the column mode is changed (internally) to **evolve** and then reverted back to the original mode. This allows for initial schema inference to happen, and then on subsequent runs, the inferred contract will be applied to the new data.
The following tables are considered new:
  1. Child tables inferred from nested data.
  2. Dynamic tables created from the data during extraction.
  3. Tables containing **incomplete** columns - columns without a data type bound to them.


For example, such a table is considered new because the column **number** is incomplete (defined as primary key and NOT null but no data type):

```
blocks:  
  description: Ethereum blocks  
  write_disposition: append  
  columns:  
    number:  
      nullable: false  
      primary_key: true  
      name: number  

```

Tables that are not considered new:
  1. Those that already exist in the schema with at least one complete column (a column with a `data_type`).


### Working with datasets that have manually added tables and columns on the first load[​](https://dlthub.com/docs/general-usage/schema-contracts#working-with-datasets-that-have-manually-added-tables-and-columns-on-the-first-load "Direct link to Working with datasets that have manually added tables and columns on the first load")
In some cases, you might be working with datasets that have tables or columns created outside of dlt. If you are loading to a table not created by dlt for the first time, dlt will not know about this table while enforcing schema contracts. This means that if you do a load where the `tables` are set to `evolve`, all will work as planned. If you have `tables` set to `freeze`, dlt will raise an exception because it thinks you are creating a new table (which you are from dlt's perspective). You can allow `evolve` for one load and then switch back to `freeze`.
The same thing will happen if `dlt` knows your table, but you have manually added a column to your destination and you have `columns` set to `freeze`.
### Code examples[​](https://dlthub.com/docs/general-usage/schema-contracts#code-examples "Direct link to Code examples")
The below code will silently ignore new subtables, allow new columns to be added to existing tables, and raise an error if a variant of a column is discovered.

```
@dlt.resource(schema_contract={"tables": "discard_row", "columns": "evolve", "data_type": "freeze"})  
def items():  
    ...  

```

The below code will raise an error on any encountered schema change. Note: You can always set a string which will be interpreted as though all keys are set to these values.

```
pipeline.run(my_source, schema_contract="freeze")  

```

The below code defines some settings on the source which can be overwritten on the resource, which in turn can be overwritten by the global override on the `run` method. Here, for all resources, variant columns are frozen and raise an error if encountered. On `items`, new columns are allowed, but `other_items` inherits the `freeze` setting from the source, thus new columns are frozen there. New tables are allowed.

```
@dlt.resource(schema_contract={"columns": "evolve"})  
def items():  
    ...  
  
@dlt.resource()  
def other_items():  
    ...  
  
@dlt.source(schema_contract={"columns": "freeze", "data_type": "freeze"})  
def frozen_source():  
  return [items(), other_items()]  
  
  
# this will use the settings defined by the decorators  
pipeline.run(frozen_source())  
  
# this will freeze the whole schema, regardless of the decorator settings  
pipeline.run(frozen_source(), schema_contract="freeze")  
  

```

[Edit this page](https://github.com/dlt-hub/dlt/tree/devel/docs/website/docs/general-usage/schema-contracts.md)
[Previous Staging](https://dlthub.com/docs/dlt-ecosystem/staging)[Next Schema evolution](https://dlthub.com/docs/general-usage/schema-evolution)
  * [Setting up the contract](https://dlthub.com/docs/general-usage/schema-contracts#setting-up-the-contract)
  * [Use Pydantic models for data validation](https://dlthub.com/docs/general-usage/schema-contracts#use-pydantic-models-for-data-validation)
  * [Authoritative Pydantic models](https://dlthub.com/docs/general-usage/schema-contracts#authoritative-pydantic-models)
  * [Validating event streams with Pydantic](https://dlthub.com/docs/general-usage/schema-contracts#validating-event-streams-with-pydantic)
  * [Set contracts on Arrow tables, Pandas, and Polars](https://dlthub.com/docs/general-usage/schema-contracts#set-contracts-on-arrow-tables-pandas-and-polars)
  * [Get context from DataValidationError in freeze mode](https://dlthub.com/docs/general-usage/schema-contracts#get-context-from-datavalidationerror-in-freeze-mode)
  * [Contracts on new tables](https://dlthub.com/docs/general-usage/schema-contracts#contracts-on-new-tables)
  * [Working with datasets that have manually added tables and columns on the first load](https://dlthub.com/docs/general-usage/schema-contracts#working-with-datasets-that-have-manually-added-tables-and-columns-on-the-first-load)
  * [Code examples](https://dlthub.com/docs/general-usage/schema-contracts#code-examples)


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
