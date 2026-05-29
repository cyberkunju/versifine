# teacher/SPEC.md — the generation contract

Every pack a subagent produces MUST follow this contract exactly, so
`local/expand.py` can consume it and the resulting training data is high
quality. This is the "what" the teacher generates.

## Output: one JSON object per leaf, one per line (JSONL)

```json
{"leaf":"<leaf_key>","templates":[...],"merchant_aliases":[...],"phrasings":[...],"code_mixed":[...]}
```

- `leaf` MUST be the exact leaf key (snake_case) given in the assignment.
- All four arrays are required and MUST be non-empty.

## Field requirements

### templates  (>= 40)
Sentence skeletons using ONLY these slots: `{merchant}` `{amount}` `{noise}`
`{date}`. Vary structure heavily; include some slot-free freeform too.
Examples that read naturally once filled:
- `"{merchant} {amount} {noise}"`
- `"paid {amount} at {merchant}"`
- `"{merchant} - {amount}"`
- `"{amount} spent on {merchant} {date}"`
- `"UPI/{merchant}/{noise}"`
The goal: when `{merchant}` is replaced with a real vendor and `{amount}` with
a rupee figure, the line looks like a real bank/UPI/typed entry for THIS leaf.

### merchant_aliases  (>= 60)
Realistic merchant/vendor names that fit THIS category, India-first, but include
global brands Indians actually use. Be specific and real-sounding.
- Pharmacy → "Apollo Pharmacy","MedPlus","Netmeds","1mg","Wellness Forever",...
- Fuel → "Indian Oil","HP Petrol Pump","Bharat Petroleum","Shell","Nayara",...
Do NOT include names that belong to a neighbouring category.

### phrasings  (>= 30)
Short, messy ways a real user TYPES this when logging it. Include typos,
abbreviations, missing spaces, lowercase, ALL CAPS, amount clutter.
- "grocery run dmart", "veggies 250", "monthly ration kirana", "GROCERIES 1840",
  "bigbasket order", "sabji mandi", "grocries dmart"  (typo intentional)

### code_mixed  (>= 25)
Code-mixed (Hinglish / Manglish / Tanglish / Tenglish / Kanglish) ways to
express this category, in LATIN script. Spread across the languages.
- "groceries ke liye paise diye", "sabzi ku 200 spend", "enikku grocery venam",
  "kirana kaagidam 500", "grocery ki kharch"

## Quality rules (non-negotiable)

1. Everything in a pack MUST clearly belong to its leaf, NOT a neighbour. This
   is the most important rule — mislabeled diversity poisons training.
   - food_delivery = Swiggy/Zomato ordering, NOT dine-in restaurants.
   - investments = buying SIP/MF/stocks/FD, NOT interest RECEIVED (that's
     investment_income).
   - transfers = moving your OWN money; people_payments = paying a PERSON.
   - credit_card_payment = paying the card BILL, not spending on the card.
2. India-first realism: UPI noise, ₹/Rs/lakh formats, local merchants, slang.
3. No duplicates within a pack. No `{slots}` other than the four allowed.
4. Output STRICT JSONL — one compact JSON object per line, nothing else, no
   markdown fences, no commentary.

## Leaf-specific disambiguation hints (use these)

- groceries vs convenience: convenience = small general/stationery store; groceries = supermarket/kirana/veg.
- restaurants vs fast_food vs food_delivery vs coffee_beverages vs alcohol_bars: by venue type / channel.
- ride_hailing_taxi vs public_transit vs trains_intercity: app cab/auto vs metro/bus vs intercity train/bus.
- electricity vs water vs gas_lpg vs mobile_recharge vs internet_broadband vs dth_cable: the specific utility.
- rent vs mortgage_home_loan vs maintenance_society: paying landlord vs home-loan EMI vs society fees.
- healthcare_medical vs pharmacy: clinic/hospital/doctor vs buying medicines.
- loan_emi vs investments vs insurance vs bank_fees vs taxes vs credit_card_payment: keep these crisp.
- salary vs business_income vs investment_income vs refunds_cashback vs other_income: source of inflow.
