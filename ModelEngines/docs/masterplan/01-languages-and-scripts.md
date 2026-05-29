# 01 · Languages & Scripts

## The 14 languages (locked)

The categorizer covers **13 Indian scheduled languages + English**, chosen as
the set that (a) covers the overwhelming majority of real Indian app usage and
(b) Opus 4.8 can generate high-quality, *verifiable* data for. No translator is
used — Opus generates all of it directly.

| # | Language | ISO 639 | Primary script | Latin/Romanized? | Opus confidence | Approx native speakers |
|---|---|---|---|---|---|---|
| 1 | Hindi | hi | Devanagari | yes (very common) | High | ~520M |
| 2 | Bengali | bn | Bengali–Assamese | yes | High | ~97M |
| 3 | Marathi | mr | Devanagari | yes | High | ~83M |
| 4 | Telugu | te | Telugu | yes | High | ~81M |
| 5 | Tamil | ta | Tamil | yes (very common) | High | ~69M |
| 6 | Gujarati | gu | Gujarati | yes | High | ~55M |
| 7 | Urdu | ur | Perso-Arabic (Nastaliq) | yes | High | ~50M |
| 8 | Kannada | kn | Kannada | yes | High | ~44M |
| 9 | Odia | or | Odia | yes | High | ~38M |
| 10 | Malayalam | ml | Malayalam | yes (very common) | High | ~35M |
| 11 | Punjabi | pa | Gurmukhi | yes | High | ~33M |
| 12 | Assamese | as | Bengali–Assamese | yes | **Moderate** | ~15M |
| 13 | Maithili | mai | Devanagari (Tirhuta hist.) | yes | **Moderate** | ~14M |
| 14 | English | en | Latin | n/a | High | (lingua franca) |

**Scripts to handle (≈9 distinct):** Devanagari (Hindi/Marathi/Maithili),
Bengali–Assamese (Bengali/Assamese), Telugu, Tamil, Gujarati, Perso-Arabic
(Urdu), Kannada, Odia, Malayalam, Gurmukhi (Punjabi), Latin (English + all
Romanized).

## Why these 14 (and not all 22)

- **Coverage vs effort:** these 14 cover ~99% of realistic Indian fintech app
  usage. The remaining 8 scheduled languages are either extremely low-resource
  (Sanskrit ~25k speakers; Bodo/Dogri/Santali small + niche scripts) or ones
  Opus cannot generate *verifiable* data for. Generating data we can't
  self-check would **poison** the model for those languages — worse than not
  covering them.
- **Opus-only constraint:** the project requires Opus as the sole data
  generator (no translator). The 14 are exactly where Opus is reliable. Maithili
  and Assamese are the two soft spots — included because they're real and
  Devanagari/Bengali-adjacent (so Opus + script transfer works), but flagged.

## Per-language handling rules

### High-confidence languages (12)
Opus generates native-script + Romanized data directly, full volume. Standard
eval floors apply.

### Moderate-confidence languages (Assamese, Maithili)
- Opus generates, but we **lean more on transliteration from the close sibling**
  (Assamese ← Bengali script-shared; Maithili ← Hindi Devanagari-shared) to
  bolster coverage.
- **Extra eval scrutiny**: a larger hand-checked eval slice; interim ship floor
  may be 88% (vs 92%) while flagged, tracked as a known limitation in the model
  card.
- The flywheel closes the gap fastest here once real users arrive.

## The transliteration multiplier (free, critical)

Indians frequently type Indian languages in **Latin script** ("groceries ke
liye", "sapadu ku 180", "amma ku 500 anuppi"). So every native-script row is
**also** produced in Latin via deterministic transliteration libraries
(`indic-transliteration` / Aksharamukha), and Opus directly authors common
Romanized forms too. This doubles the script axis for free and matches real
typing behavior. (Details: doc 03.)

## Script normalization at runtime

The runtime Normalizer (doc 05) detects script, applies Unicode NFC
normalization, and — for retrieval robustness — can canonicalize to a common
representation. The model is trained on all scripts, so normalization is for
noise reduction, not a hard dependency.

## Language matrix file

`config.py` carries the machine-readable matrix:
```python
LANGUAGES_V2 = [
  # (code, name, script, opus_tier)
  ("hi","Hindi","Devanagari","high"),
  ("bn","Bengali","Bengali","high"),
  ("mr","Marathi","Devanagari","high"),
  ("te","Telugu","Telugu","high"),
  ("ta","Tamil","Tamil","high"),
  ("gu","Gujarati","Gujarati","high"),
  ("ur","Urdu","Arabic","high"),
  ("kn","Kannada","Kannada","high"),
  ("or","Odia","Odia","high"),
  ("ml","Malayalam","Malayalam","high"),
  ("pa","Punjabi","Gurmukhi","high"),
  ("as","Assamese","Bengali","moderate"),
  ("mai","Maithili","Devanagari","moderate"),
  ("en","English","Latin","high"),
]
```
The per-language eval gate (doc 08) iterates this list; a missing or failing
language blocks ship.
