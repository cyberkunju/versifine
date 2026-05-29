# 02 · Taxonomy

The label space is the foundation: comprehensive (nothing real-world missed),
unambiguous (each leaf distinct), India-first, hierarchical (groups → leaves),
and **language-independent** (a category is a concept; the 14 languages are just
surface forms of the same 59 leaves).

## Source of truth

- `taxonomy/taxonomy.json` — 13 groups, 59 leaves; loaded + validated by
  `taxonomy/taxonomy.py`.
- `taxonomy/crosswalk.json` — maps external standards (MCC, Plaid PFC, Foursquare
  families) onto our leaves; validated by `taxonomy/crosswalk.py`.

Both MUST pass before any build:
```sh
python -m taxonomy.taxonomy --validate    # 13 groups / 59 leaves, consistent
python -m taxonomy.crosswalk --validate   # 87 MCC ranges / 105 plaid / 37 fsq, valid
```

## Design principles

1. **Anchored on standards, not invented** — Plaid Personal Finance Categories
   (purpose-built for txn categorization) + ISO 18245 MCC (~1000 card-network
   codes → exhaustive coverage). If MCC+Plaid have a spend type, we have a home.
2. **Groups → leaves** — model predicts a leaf (precise); UI may roll up to a
   group (tidy). A new leaf still rolls up sensibly, so budgets never see an
   orphan.
3. **India-first leaves** — Mobile Recharge, DTH & Cable, Gas & LPG (cylinder),
   Domestic Help, Loans & EMI, Investments (SIP/MF/FD), Charity & Donations
   (temple/daan), auto/rickshaw under Ride-hailing, FASTag under Tolls.
4. **`kind` per leaf** — expense / income / transfer / neutral → downstream
   flows filter correctly.
5. **`legacy` per leaf** — every leaf maps to one of the v1 23 categories for
   backward compatibility with stored transactions.
6. **`examples` per leaf** — seed phrases (English/concept) that seed the example
   bank and let synthesis cover a leaf even with zero harvested merchants.

## The 13 groups / 59 leaves

| Group | Leaves |
|---|---|
| Food & Drink | groceries, restaurants, fast_food, food_delivery, coffee_beverages, alcohol_bars |
| Transport | ride_hailing_taxi, public_transit, fuel, parking_tolls, vehicle_maintenance |
| Shopping | shopping_retail, clothing, electronics, convenience, home_goods, gifts |
| Bills & Utilities | electricity, water, gas_lpg, mobile_recharge, internet_broadband, dth_cable |
| Housing | rent, mortgage_home_loan, maintenance_society, domestic_help, home_services |
| Health & Wellness | healthcare_medical, pharmacy, personal_care, fitness_sports |
| Entertainment & Leisure | entertainment, subscriptions, gaming, hobbies |
| Travel | flights, hotels_lodging, trains_intercity, travel_other |
| Finance & Obligations | loan_emi, insurance, investments, bank_fees, taxes, credit_card_payment |
| Education & Family | education, childcare, pets |
| Giving & Transfers | charity_donations, transfers, people_payments, cash_atm |
| Income | salary, business_income, investment_income, refunds_cashback, other_income |
| Miscellaneous | other |

(Authoritative list is always `taxonomy.json`; run the validator `summary`.)

## The crosswalk (external → our leaves)

Validated so every target leaf exists:
- **`mcc_ranges`** — ISO 18245 ranges → leaf, **most-specific-wins** resolution
  (single code 5541 fuel overrides band 5511-5599 vehicle_maintenance). 87
  ranges.
- **`plaid_pfc`** — Plaid PFCv2 detailed keys → leaf. 105 keys.
- **`foursquare_families`** — FSQ/Overture top-level family → leaf. 37 families.

Unmapped external codes fall through to fuzzy name match → drop. **Never guess a
hard label** (a wrong label poisons training worse than a missing row).

## Known confusable clusters (mitigations)

These are inherently hard from short text and are where the cross-encoder +
flywheel earn their keep. Tracked per-group in eval:

- restaurants vs fast_food vs food_delivery vs coffee_beverages vs alcohol_bars
  (venue/channel)
- shopping_retail vs clothing vs electronics vs home_goods (what's bought)
- transfers vs people_payments vs cash_atm vs credit_card_payment (self vs
  person vs ATM vs card-bill)
- loan_emi vs mortgage_home_loan; investments vs investment_income (out vs in)
- rent vs maintenance_society vs domestic_help

The teacher SPEC (doc 03) gives each cluster explicit disambiguation hints so
generated data stays clean.

## Extending the taxonomy (open vocabulary)

Adding a category = **data, not a retrain**:
1. Add a leaf to `taxonomy.json` (name, kind, legacy, ≥8 examples).
2. Optionally add crosswalk entries.
3. `python -m taxonomy.taxonomy --validate`.
4. Generate teacher data for it (subagents) + regenerate its example-bank
   embeddings.
The model can retrieve the new leaf immediately (works); a retrain with its data
sharpens precision (better). "Works without retrain, improves with retrain."

## Versioning

`taxonomy.json.version` bumps on any change; the build writes the leaf list into
`manifest.json`; the API reads the label set from the manifest, so model and app
never disagree. Taxonomy change is deliberate and recorded.

## Coverage notes for v2 (tracked, not blocking v1)

Candidate future leaves if real usage demands: crypto, EV charging, fines-vs-
taxes split, BNPL-vs-loan, tobacco/paan, gambling, loan-received. Open vocabulary
makes adding them cheap.
