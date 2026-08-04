# Data schema — for Power BI and ML integration

This app is built local-first, but every export uses a stable, documented schema
specifically so it plugs into Power BI or a Python/pandas ML pipeline without any
reshaping. This file is the data dictionary for those exports. `schemaVersion`
(currently `3`) is included in the JSON backup and the ML dataset export — check
it before assuming field names haven't changed if you're building an automated
pipeline against this data.

## Exports available (Settings → Analysis exports)

| File | Grain | Purpose |
|---|---|---|
| `pfos-transactions-*.csv` | One row per transaction | Fact table |
| `pfos-categories-*.csv` | One row per category | Dimension table |
| `pfos-monthly-summary-*.csv` | One row per (month, category) | Pre-aggregated budget vs. actual |
| `pfos-ml-dataset-*.json` | All three tables + recurring rules, bundled | Single-file load for a notebook |
| `pfos-backup-*.json` | Full raw state | Restore/backup — not intended for analysis |

## `pfos-transactions-*.csv` (fact table)

| Field | Type | Notes |
|---|---|---|
| `Date` | string, `YYYY-MM-DD` | |
| `Year` | integer | |
| `Quarter` | integer, 1–4 | |
| `Month` | string, `YYYY-MM` | Join key for the monthly summary table |
| `Week` | integer, 1–53 | ISO 8601 week number |
| `Weekday` | string | Full name, e.g. `Monday` |
| `IsWeekend` | boolean | |
| `CategoryId` | integer | **Join key** to `pfos-categories-*.csv` |
| `Category` | string | Denormalized category name, for convenience |
| `Merchant` | string | May be blank |
| `PaymentMethod` | string | e.g. `UPI`, `Cash`, `Credit Card` — free text, not a fixed enum |
| `Amount` | float | Always positive; sign is carried by `Type`, not the amount |
| `Type` | string | `expense` or `income` |
| `RunningBalance` | float | Cumulative income − expense up to and including this row, in date order |
| `IsRecurring` | boolean | True if this row was auto-posted by a recurring rule |
| `Notes` | string | May be blank |
| `Tags` | string | Pipe-delimited (`tag1\|tag2`), empty string if none |

Text fields that could start with `= + - @` are prefixed with a leading `'` to
prevent CSV formula injection when opened in Excel/Sheets — strip that prefix
back off in code if you're parsing programmatically rather than opening by hand.

## `pfos-categories-*.csv` (dimension table)

| Field | Type | Notes |
|---|---|---|
| `CategoryId` | integer | Primary key |
| `Name` | string | |
| `Type` | string | `expense` or `income` — as of schema v3, income sources (Salary, Freelance, etc.) are separate from spending categories and never carry a budget |
| `Icon` | string | Emoji |
| `Color` | string | Hex color used in-app |
| `MonthlyBudget` | float | The budget cap — always `0` for `Type = income`, since budgets don't apply to income sources |
| `Archived` | boolean | Archived categories are excluded from onboarding/active views but not deleted |

## `pfos-monthly-summary-*.csv`

| Field | Type | Notes |
|---|---|---|
| `Month` | string, `YYYY-MM` | |
| `CategoryId` | integer | Join key |
| `CategoryName` | string | |
| `Budget` | float | |
| `Actual` | float | Sum of expenses in that category that month |
| `Variance` | float | `Budget - Actual`; negative means over budget |
| `PctOfBudget` | float or null | `Actual / Budget * 100`, rounded to 1 decimal; null if budget is 0 |

## Power BI setup

1. Get Data → Text/CSV → import `pfos-transactions-*.csv` and `pfos-categories-*.csv`.
2. Model view → drag `CategoryId` from Transactions to `CategoryId` on Categories to create the relationship (many-to-one, Transactions → Categories).
3. Optionally also import `pfos-monthly-summary-*.csv` as a second fact table at
   a coarser grain — faster for budget-vs-actual visuals since no DAX aggregation
   is needed.
4. Build measures against `Amount` filtered by `Type = "expense"` / `"income"` as
   needed; `RunningBalance` is already pre-computed if you just want a running
   total visual without a DAX running-total measure.

## Using the ML dataset (`pfos-ml-dataset-*.json`)

```python
import json
import pandas as pd

with open("pfos-ml-dataset-2026-07-20.json") as f:
    data = json.load(f)

print(data["schemaVersion"])  # check this before trusting field names

transactions = pd.json_normalize(data["transactions"])
categories = pd.json_normalize(data["categories"])
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