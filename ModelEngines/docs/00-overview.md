# 00 · Overview & Vision

## The problem

Versifine is a personal-finance manager whose core promise is **frictionless
capture**: a user types or speaks "chai 30", snaps a receipt, or forwards a UPI
SMS, and the expense is logged, categorized, and folded into budgets, forecasts,
and the AI copilot. Categorization is the spine of all of that — a wrong or
missing category corrupts budgets, reports, advice, and trust.

The input is uniquely hostile to clean classification:

- **Messy by nature.** Real transaction text is `UPI/swiggy/8821@ybl/MUMBAI`,
  `POS 4521 BLR`, `pertol 500`, `chai-paani`, `Rs.450/-`, ALL CAPS, no spaces,
  typos, merchant IDs, city codes, reference numbers.
- **Multilingual + code-mixed.** Indian users write in English, Hindi,
  Malayalam, Tamil, Telugu, Kannada — and *mix* them in one line
  (`sapadu ku 180 spend panninen`, `food-inu 200 aayi`).
- **Long tail of merchants.** Tens of thousands of local kiranas, brands,
  apps, and services, most of which no static list will ever contain.

## What went wrong in v1

The v1 categorizer was a **closed 23-class classifier** with a 4-tier waterfall
(user overrides → curated merchant DB → MiniLM ONNX → `Other`). Two structural
failures:

1. **The ML tier never shipped.** The fine-tuned MiniLM needed an ONNX export
   that was never produced (`manifest.json: hasOnnx: false`). So in production
   there was **no semantic understanding at all** — anything not in the 427-entry
   merchant DB fell straight to `Other`. "cab" → `Other`. "chai" → `Other`.
2. **Closed vocabulary.** Even working, it could only ever emit 1 of 23 labels.
   A huge amount of real spending (loans/EMI, investments, salon, gym, pets,
   gifts, bank fees, taxes) had **no honest home** and got dumped into `Other`
   or a wrong neighbor.

## The vision for v2

A categorizer that **never structurally misses a category** and **understands
any phrasing, however messy**, while running **locally and offline** at
inference time. Three ideas make this real:

### 1. Open vocabulary via retrieval
Don't classify into fixed slots. **Embed** the transaction and **retrieve** the
nearest category from an *example bank*. The label set becomes **data** — adding
a category = adding example phrases + one centroid, **no retraining**. This is
what makes "nothing should be missed" structurally true instead of aspirational.

### 2. Retrieve → rerank (not kNN voting)
A **bi-encoder** retrieves the top-k candidate categories fast; a **cross-encoder**
reranks them with full cross-attention for precision on hard, ambiguous pairs
("coffee at airport" vs "airport lounge"). This two-stage stack is the modern
SOTA and adds several accuracy points over nearest-neighbor voting.

### 3. Distill the teacher; never serve it
A single strong open LLM (**Gemma 4 31B-it**) is used **only at build time** to
generate realistic, messy, multilingual training diversity. That knowledge is
**distilled into the small encoders**. At runtime there is **no LLM call** —
inference is two tiny ONNX models, fast, free, private, offline-capable. This is
strictly better than calling an LLM per transaction: same quality, 100× cheaper
and faster, and it works in the browser for Privacy Mode.

### 4. The flywheel
Every **user correction** and every **hard-case decision** is embedded and added
back into the example bank. Hard cases become known cases. The categorizer gets
smarter every day with **zero retraining**. This compounds — the longer it runs,
the better it gets.

## Why this matters beyond accuracy

- **Trust.** A finance app that miscategorizes loses users on day one.
- **Downstream correctness.** Budgets, forecasts, advice, and the copilot all
  read categories. Garbage in, garbage everywhere.
- **India-first differentiation.** Almost no categorizer handles code-mixed
  Indic transaction text well. Doing this is a genuine moat.
- **Privacy.** Local/offline inference means a user can run categorization
  without sending their spending to any cloud — the basis of Privacy Mode.

## What "done" looks like

A published model bundle (`CyberKunju/versifine-categorizer-v2`) containing two
INT8 ONNX encoders + an example bank + calibration, that the API and the web app
load locally, achieving **≥95% top-1 on a hard, hand-checked, code-mixed eval
set**, improving over time via the flywheel, built for **under $30**.

See [01-goals-and-success-criteria.md](01-goals-and-success-criteria.md) for the
precise targets.
