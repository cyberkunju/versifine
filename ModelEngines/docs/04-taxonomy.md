# 04 · Taxonomy

The label space is the foundation. It must be **comprehensive** (nothing
real-world is missed), **unambiguous** (each leaf is clearly distinct),
**India-first**, and **hierarchical** (groups → leaves) so the UI can roll up
and budgets never break on a new leaf.

## Source of truth

`taxonomy/taxonomy.json` — loaded + validated by `taxonomy/taxonomy.py`.
`taxonomy/crosswalk.json` — maps external standards onto our leaves, validated
by `taxonomy/crosswalk.py`.

Both MUST pass `--validate` before any build:
```sh
python -m taxonomy.taxonomy --validate
python -m taxonomy.crosswalk --validate
```

## Design principles

1. **Anchored on standards, not invented.** Structure derives from **Plaid
   Personal Finance Categories** (purpose-built for txn categorization) and
   **ISO 18245 MCC** (the card-network standard, ~1000 codes → exhaustive
   coverage). If MCC + Plaid have a spend type, we have a home for it.
2. **Groups → leaves.** ~13 groups, ~59 leaves. The model predicts a **leaf**
   (precise); the UI may display the **group** (tidy). A brand-new leaf still
   rolls up to a sensible group, so reports/budgets never see an orphan.
3. **India-first leaves.** Categories that matter in India but are absent from
   US-centric taxonomies are first-class: Mobile Recharge, DTH & Cable,
   Gas & LPG (cylinder), Domestic Help, Loans & EMI, Investments (SIP/MF/FD),
   Charity & Donations (temple/daan), Auto/Rickshaw under Ride-hailing.
4. **`kind` per leaf** — `expense | income | transfer | neutral` — so downstream
   flows filter correctly (expense reports exclude income/transfers; Cash & ATM
   is neutral).
5. **`legacy` per leaf** — every leaf maps back to one of the v1 23 categories,
   for backward compatibility with stored transactions + the API enum.
6. **`examples` per leaf** — seed phrases that (a) seed the example bank and (b)
   let synthesis cover a leaf even with zero harvested merchants. Validator
   requires every leaf to have examples.

## The 13 groups (current: v2.0.0)

| Group | Leaves | Notes |
|---|---|---|
| Food & Drink | groceries, restaurants, fast_food, food_delivery, coffee_beverages, alcohol_bars | India splits delivery (Swiggy/Zomato) from dine-in |
| Transport | ride_hailing_taxi, public_transit, fuel, parking_tolls, vehicle_maintenance | auto/rickshaw/Ola/Rapido under ride-hailing; FASTag under tolls |
| Shopping | shopping_retail, clothing, electronics, convenience, home_goods, gifts | gifts ≠ charity |
| Bills & Utilities | electricity, water, gas_lpg, mobile_recharge, internet_broadband, dth_cable | recharge + DTH are India staples |
| Housing | rent, mortgage_home_loan, maintenance_society, domestic_help, home_services | domestic help = maid/cook/driver |
| Health & Wellness | healthcare_medical, pharmacy, personal_care, fitness_sports | salon + gym were missing in v1 |
| Entertainment & Leisure | entertainment, subscriptions, gaming, hobbies | |
| Travel | flights, hotels_lodging, trains_intercity, travel_other | |
| Finance & Obligations | loan_emi, insurance, investments, bank_fees, taxes, credit_card_payment | all missing/dumped in v1 |
| Education & Family | education, childcare, pets | pets was missing in v1 |
| Giving & Transfers | charity_donations, transfers, people_payments, cash_atm | P2P split from self-transfer |
| Income | salary, business_income, investment_income, refunds_cashback, other_income | |
| Miscellaneous | other | true last resort only |

(Exact, current leaf list is always whatever `taxonomy.json` says — this table
is illustrative. Run the validator's `summary` for the live list.)

## The crosswalk (external → our leaves)

`crosswalk.json` has three maps, validated so every target leaf exists:

- **`mcc_ranges`** — ISO 18245 code ranges → leaf. Resolution is
  **most-specific-wins**: a single-code rule (5541 fuel) overrides a broad band
  (5511-5599 vehicle_maintenance) regardless of order. 87 ranges.
- **`plaid_pfc`** — Plaid PFCv2 detailed keys → leaf. 105 keys.
- **`foursquare_families`** — FSQ/Overture top-level family → leaf. 37 families.

Unmapped external codes fall through to a fuzzy name match, then `other`. We
never guess a hard label.

## How to extend the taxonomy (open vocabulary)

Adding a category is **data, not a retrain**:

1. Add a leaf to `taxonomy.json` under the right group, with `name`, `kind`,
   `legacy`, and at least ~8 `examples`.
2. (Optional) add crosswalk entries so harvested merchants of that type get
   auto-labeled.
3. `python -m taxonomy.taxonomy --validate` (must pass).
4. Regenerate the example bank for that leaf (a tiny step in `jobs/03`) so the
   bi-encoder can retrieve it. **No encoder retraining required** for the model
   to start predicting the new leaf — though a retrain with the new leaf's data
   improves precision.

### Rules for a good new leaf
- It must be **clearly distinct** from its neighbours (else it just confuses).
- It must have a **legacy** mapping (validator enforces).
- Prefer adding a leaf under an existing group over inventing a group.
- If a leaf is very rare, consider whether it should be examples under an
  existing leaf instead.

## Versioning

`taxonomy.json.version` is bumped on any change. The build writes the leaf list
into `manifest.json`; the API reads the label set from the manifest, so model
and app never disagree. Changing the taxonomy is a deliberate, recorded act
(non-negotiable P5).
