"""
Prompt templates for the Gemma 4 31B-it teacher.

The teacher does NOT label millions of rows (that would be slow + costly).
Instead it produces, per leaf, a compact pack of high-diversity building blocks
that the laptop explodes combinatorially into millions of labeled rows:

  1. templates       — sentence skeletons with {merchant} {amount} {noise} slots
  2. merchant_aliases — realistic merchant/vendor names for that leaf (India-first)
  3. phrasings       — short freeform descriptions a user might type/say
  4. code_mixed      — Hinglish / Manglish / Tanglish etc. variants

It also runs a self-consistency VERIFY pass on the ambiguous tail (rows where
the bi-encoder later disagrees with the deterministic label) — but that is a
separate, smaller call defined in jobs/01_gemma_generate.py.

All outputs are strict JSON so the laptop can parse without an LLM.
"""
from __future__ import annotations

GENERATION_SYSTEM = """You are a data engineer building a training set for an Indian-first \
personal-finance transaction categorizer. You generate REALISTIC, messy, \
real-world transaction text exactly as it appears in Indian bank statements, \
UPI apps, SMS alerts, and how people actually type/speak when logging money.

You must reflect reality, not clean textbook examples:
- UPI noise: "UPI/swiggy/8821@ybl/MUMBAI", "PAYTM-12345", "POS 4521 BLR"
- abbreviations, missing spaces, ALL CAPS, lowercase, typos ("grosery","pertol")
- Indian merchants, brands, and slang ("kirana","sabzi","auto","chai","tapri")
- code-mixed languages (Hinglish, Manglish, Tanglish, Tenglish, Kanglish)
- amounts written many ways (₹450, Rs.450, 450/-, 1.5k, 2 lakh)

You output STRICT JSON only — no prose, no markdown fences."""

GENERATION_USER = """Category: "{leaf_name}" (group: {group_name})
What belongs here: {description}
Seed examples: {examples}

Generate a JSON object with these keys (counts are minimums):
{{
  "templates": [ {n_templates} skeletons using slots {{merchant}} {{amount}} {{noise}} \
{{date}} — vary structure heavily; some slot-free freeform too ],
  "merchant_aliases": [ {n_aliases} realistic merchant/vendor names that fit this \
category, India-first but include global brands Indians use ],
  "phrasings": [ 30 short ways a user would TYPE this when logging it, including \
typos and abbreviations ],
  "code_mixed": [ 25 code-mixed (Hinglish/Manglish/Tanglish/Tenglish/Kanglish) \
ways to express this category, Latin script ]
}}

Rules:
- Everything must clearly belong to "{leaf_name}", not a neighbouring category.
- Make merchant_aliases specific and real-sounding (e.g. for Pharmacy: \
"Apollo Pharmacy","MedPlus","Wellness Forever","Netmeds","1mg").
- Templates should produce natural results when slots are filled.
- Output ONLY the JSON object."""


def build_generation_messages(
    leaf_name: str,
    group_name: str,
    description: str,
    examples: list[str],
    n_templates: int,
    n_aliases: int,
) -> list[dict]:
    return [
        {"role": "system", "content": GENERATION_SYSTEM},
        {
            "role": "user",
            "content": GENERATION_USER.format(
                leaf_name=leaf_name,
                group_name=group_name,
                description=description,
                examples=", ".join(examples[:12]),
                n_templates=n_templates,
                n_aliases=n_aliases,
            ),
        },
    ]


# ----------------------------------------------------------------------------
# Verify pass (self-consistency). Used only on the ambiguous tail.
# ----------------------------------------------------------------------------
VERIFY_SYSTEM = """You are a precise classifier for Indian personal-finance \
transactions. Given a transaction string and a fixed list of candidate \
categories, pick the SINGLE best category key. The text may be messy, \
code-mixed, abbreviated, or full of UPI/POS noise. Output STRICT JSON only."""

VERIFY_USER = """Transaction: "{text}"

Candidate categories (key — what belongs):
{candidates}

Return JSON: {{"leaf": "<the single best key from the list>", "confidence": 0.0-1.0}}
If genuinely none fit, use "other". Output ONLY the JSON object."""


def build_verify_messages(text: str, candidates: list[tuple[str, str]]) -> list[dict]:
    cand_lines = "\n".join(f"- {key} — {desc}" for key, desc in candidates)
    return [
        {"role": "system", "content": VERIFY_SYSTEM},
        {"role": "user", "content": VERIFY_USER.format(text=text, candidates=cand_lines)},
    ]

