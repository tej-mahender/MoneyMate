# Data schema — for Power BI and ML integration

This app is built local-first, but every export uses a stable, documented schema
specifically so it plugs into Power BI or a Python/pandas ML pipeline without any
reshaping. This file is the data dictionary for those exports. `schemaVersion`
(currently `5`) is included in the JSON backup and the ML dataset export — check
it before assuming field names haven't changed if you're building an automated
pipeline against this data.

## The data model, in short

Two levels: a **Bracket** (Expenditure, Savings, Investments, Income, or any
custom one the person adds) has a `Kind` — `spend` (a capped budget), `allocation`
(a transfer-out target, like Savings/Investments/EMI), or `income` (a source of
money in). A **Category** belongs to exactly one bracket and inherits its kind —
Rent/Food under Expenditure, Portfolio/Gold under Investments, Salary/Freelance
under Income. A bracket's own total is always the sum of its categories' budgets.

## Exports available (Settings → Analysis exports)

| File                         | Grain                                 | Purpose                                    |
| ---------------------------- | ------------------------------------- | ------------------------------------------ |
| `pfos-transactions-*.csv`    | One row per transaction               | Fact table                                 |
| `pfos-categories-*.csv`      | One row per category                  | Dimension table                            |
| `pfos-brackets-*.csv`        | One row per bracket                   | Dimension table                            |
| `pfos-monthly-summary-*.csv` | One row per (month, category)         | Pre-aggregated budget vs. actual           |
| `pfos-ml-dataset-*.json`     | All tables + recurring rules, bundled | Single-file load for a notebook            |
| `pfos-backup-*.json`         | Full raw state                        | Restore/backup — not intended for analysis |

## `pfos-transactions-*.csv` (fact table)

| Field            | Type                 | Notes                                                                   |
| ---------------- | -------------------- | ----------------------------------------------------------------------- |
| `Date`           | string, `YYYY-MM-DD` |                                                                         |
| `Year`           | integer              |                                                                         |
| `Quarter`        | integer, 1–4         |                                                                         |
| `Month`          | string, `YYYY-MM`    | Join key for the monthly summary table                                  |
| `Week`           | integer, 1–53        | ISO 8601 week number                                                    |
| `Weekday`        | string               | Full name, e.g. `Monday`                                                |
| `IsWeekend`      | boolean              |                                                                         |
| `CategoryId`     | integer              | **Join key** to `pfos-categories-*.csv`                                 |
| `Category`       | string               | Denormalized category name, for convenience                             |
| `Merchant`       | string               | May be blank                                                            |
| `PaymentMethod`  | string               | e.g. `UPI`, `Cash`, `Credit Card` — free text, not a fixed enum         |
| `Amount`         | float                | Always positive; sign is carried by `Type`, not the amount              |
| `Type`           | string               | `expense` or `income`                                                   |
| `RunningBalance` | float                | Cumulative income − expense up to and including this row, in date order |
| `IsRecurring`    | boolean              | True if this row was auto-posted by a recurring rule                    |
| `Notes`          | string               | May be blank                                                            |
| `Tags`           | string               | Pipe-delimited (`tag1\|tag2`), empty string if none                     |

Text fields that could start with `= + - @` are prefixed with a leading `'` to
prevent CSV formula injection when opened in Excel/Sheets — strip that prefix
back off in code if you're parsing programmatically rather than opening by hand.

## `pfos-categories-*.csv` (dimension table)

| Field           | Type    | Notes                                                                                                                                                                                 |
| --------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CategoryId`    | integer | Primary key                                                                                                                                                                           |
| `Name`          | string  |                                                                                                                                                                                       |
| `BracketId`     | integer | **Join key** to `pfos-brackets-*.csv`                                                                                                                                                 |
| `BracketName`   | string  | Denormalized, for convenience                                                                                                                                                         |
| `BracketKind`   | string  | Denormalized from the bracket — `spend`, `allocation`, or `income` (see below)                                                                                                        |
| `Icon`          | string  | Emoji                                                                                                                                                                                 |
| `Color`         | string  | Hex color used in-app                                                                                                                                                                 |
| `MonthlyBudget` | float   | For a `spend`-kind bracket, the budget cap. For `allocation`, the target amount (same field, different meaning — filter on `BracketKind` before aggregating). Always `0` for `income` |
| `Archived`      | boolean | Archived categories are excluded from onboarding/active views but not deleted                                                                                                         |

## `pfos-brackets-*.csv` (dimension table)

| Field       | Type    | Notes                                                                                                                                                                                                                                            |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BracketId` | integer | Primary key                                                                                                                                                                                                                                      |
| `Name`      | string  | e.g. `Expenditure`, `Savings`, `Investments`, `Income`, or any custom bracket added                                                                                                                                                              |
| `Kind`      | string  | `spend` = a capped budget bracket (Rent, Food… roll up into it); `allocation` = a transfer-out-of-income target, not a spend (Savings, Investments, EMI…); `income` = a source of money in (Salary, Freelance…), budget is meaningless for these |
| `Icon`      | string  | Emoji                                                                                                                                                                                                                                            |
| `Color`     | string  | Hex color used in-app                                                                                                                                                                                                                            |
| `Archived`  | boolean |                                                                                                                                                                                                                                                  |

## `pfos-monthly-summary-*.csv`

| Field          | Type              | Notes                                                                                                                                                                                        |
| -------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Month`        | string, `YYYY-MM` |                                                                                                                                                                                              |
| `CategoryId`   | integer           | Join key                                                                                                                                                                                     |
| `CategoryName` | string            |                                                                                                                                                                                              |
| `BracketId`    | integer           | Join key to `pfos-brackets-*.csv`                                                                                                                                                            |
| `BracketName`  | string            | Denormalized, for convenience                                                                                                                                                                |
| `BracketKind`  | string            | `spend`, `allocation`, or `income` — filter to `spend` for a true "budget cap" visual; `allocation` rows are target-vs-actual for Savings/Investments/EMI-style categories, not capped spend |
| `Budget`       | float             | Cap for `spend`, target for `allocation`                                                                                                                                                     |
| `Actual`       | float             | Sum of expenses in that category that month                                                                                                                                                  |
| `Variance`     | float             | `Budget - Actual`; negative means over budget (or under target, for `allocation`)                                                                                                            |
| `PctOfBudget`  | float or null     | `Actual / Budget * 100`, rounded to 1 decimal; null if budget is 0                                                                                                                           |

## Power BI setup

1. Get Data → Text/CSV → import `pfos-transactions-*.csv`, `pfos-categories-*.csv`, and `pfos-brackets-*.csv`.
2. Model view → drag `CategoryId` from Transactions to `CategoryId` on Categories
   (many-to-one, Transactions → Categories), and `BracketId` from Categories to
   `BracketId` on Brackets (many-to-one, Categories → Brackets).
3. Optionally also import `pfos-monthly-summary-*.csv` as a second fact table at
   a coarser grain — faster for budget-vs-actual visuals since no DAX aggregation
   is needed.
4. Build measures against `Amount` filtered by `Type = "expense"` / `"income"` as
   needed; `RunningBalance` is already pre-computed if you just want a running
   total visual without a DAX running-total measure. For a true budget-cap
   visual, also filter categories/rows to `BracketKind = "spend"` — `allocation`
   brackets (Savings, Investments, EMI…) are targets, not caps, and mixing
   them into the same visual will overstate or understate the budget picture.

## Using the ML dataset (`pfos-ml-dataset-*.json`)

```python
import json
import pandas as pd

with open("pfos-ml-dataset-2026-07-20.json") as f:
    data = json.load(f)

print(data["schemaVersion"])  # check this before trusting field names

transactions = pd.json_normalize(data["transactions"])
categories = pd.json_normalize(data["categories"])
brackets = pd.json_normalize(data["brackets"])
monthly = pd.json_normalize(data["monthlySummary"])

transactions["Date"] = pd.to_datetime(transactions["Date"])
```

The `transactions` frame already has the date features (`Weekday`, `IsWeekend`,
`Week`, `Quarter`) a forecasting or anomaly-detection model would otherwise need
to engineer — e.g. a simple next-month spend forecast, an over-budget-risk
classifier per category, or an isolation-forest-style anomaly flag on `Amount`
grouped by `CategoryId` are all reasonable first models to try against this shape
of data without any further feature engineering.

## What isn't included on purpose

There's no built-in scheduled export, cloud sync, or automatic pipeline — every
export is a manual, explicit action the person takes from Settings. That's
intentional: the app's entire privacy premise is that nothing leaves the device
without you choosing to move it. An ML or Power BI workflow built on top of this
data is something you run yourself, on your own exported file, not something the
app does on your behalf in the background.
