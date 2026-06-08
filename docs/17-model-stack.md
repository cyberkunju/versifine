# 17 · AI Model Stack

> The single source of truth for which AI model powers each pipeline stage, why,
> and the interim configuration we run until restricted Azure quota is approved.
> Evidence behind these choices lives in `_bench/FINAL_DEEP_RESULTS.txt`
> (≈570 live benchmark calls across intent, category, extraction, chat, injection,
> and an advanced config probe).

## Philosophy

1. **Match the model to the task.** Our tasks (intent, parse, category, short
   finance answers) are *easy* for modern models — a small model already scored
   91–100% in our live benchmark. So the mini/nano tier is the workhorse, and a
   flagship-class model is held only as a low-confidence **escalation** path.
2. **Sarvam where it is SOTA.** Indic speech (Malayalam/Telugu/Tamil/Kannada/Hindi)
   is Sarvam's genuine strength, so audio stays with Sarvam Saaras/Bulbul.
3. **Correctness is a system property, not a model setting.** "No flaws" comes
   from the deterministic layers — regex/amount validator, strict JSON output,
   and the always-confirm flow for images — not from buying a bigger model. The
   model upgrade raises the floor; the deterministic wall prevents failures.
4. **Quality first, then latency, then cost** — but our benchmark showed the
   cheaper tier loses <1% quality on our tasks, so cost mostly takes care of itself.

## Target stack (once Azure quota is approved)

### Azure AI Foundry — model deployments

| Pipeline stage | Model | Notes |
| --- | --- | --- |
| Intent / NLU | **gpt-5.4-nano** | everyday workhorse; reasoning at `none`/`minimal` for speed |
| Parse (amount/type/category) | **gpt-5.4-nano** | strict JSON schema; escalate on low confidence |
| Translate (en→ta/te/kn) | **gpt-5.4-nano** | short messages |
| Vision (GPay/messy screenshots) | **gpt-5.4-nano** (image input) | printed bills go to Document Intelligence first |
| Copilot chat | **gpt-5-mini** | natural, low-latency finance Q&A |
| Escalation / fallback | **gpt-5.4-mini** | fires only when nano returns low confidence on a hard receipt/parse |
| Embeddings | **text-embedding-3-large** | transaction similarity / categorization (3072-dim) |
| English STT | **MAI-Transcribe-1.5** | #1 FLEURS; keyword-biasing toward merchants / "rupees" / UPI / finance terms |

### Sarvam (external account, not Foundry)

| Stage | Model | Notes |
| --- | --- | --- |
| STT — hi/ml/ta/te/kn | **Sarvam Saaras v3** | Indic-first ASR |
| TTS — all languages incl. English | **Sarvam Bulbul v3** | native Indic voices; English supported |

**STT routing:** the engine is chosen by the user's session/profile language —
`en` → MAI-Transcribe-1.5, otherwise → Saaras v3. Both are multilingual, so a
profile/speech mismatch degrades gracefully and never hard-fails.

### Azure AI services — safety / quality layer

**All three Azure AI services were evaluated and cut. The existing stack is sufficient.**

| Service | Verdict |
| --- | --- |
| **Azure-AI-Content-Safety** | 0 value-add on direct chat (benchmarked 22 attacks: built-in filter + hardened prompt = 22/22 blocked, 0 leaks; standalone shield only 55%). |
| **Azure-Language-Text-PII-redaction** | Misses Indian-specific PII (IFSC, UPI ID, PAN, Aadhaar). A ~10-line regex handles those without API overhead. |
| **Azure-AI-Content-Understanding** | prebuilt-receipt requires a connected LLM deployment in Foundry project settings; without it: status=Failed. With it: runs an LLM for extraction — the same job gpt-5.4-nano vision does directly, with no benefit for single-page WhatsApp JPEGs. gpt-5-mini vision extracted correct fields in 6.5s with zero extra setup. |

**Effective safety strategy (no additional Azure services):**
1. Built-in Azure content filter — on by default, blocked 12/22 hard jailbreaks in testing.
2. Hardened system prompt in `guard.ts` — blocked remaining 10/22, 0 leaks total.
3. Deterministic validators — amount regex, strict JSON schema, confirm-before-save.
4. ~10-line regex for Indian PII in log writes (IFSC + UPI patterns).

### Retired

`gpt-4o-transcribe`, `gpt-4o-mini-tts`, `gpt-4o-audio-preview`, `gpt-4o`/`gpt-4o-mini`
as the parse/NLU/chat models, `text-embedding-3-small`.

## Interim bootstrap (UNTIL quota is approved)

The Azure quota for `gpt-5.4-nano`, `gpt-5.4-mini`, and `text-embedding-3-large`
is restricted and pending an increase request. Until those unlock, we run a
simplified config that uses only already-available models:

| Stage | Interim model |
| --- | --- |
| Intent, parse, translate, vision, chat, **all LLM purposes** | **gpt-5-mini** |
| Embeddings | **Cohere-embed-v3-multilingual** (1024-dim; strong on Indian languages) |
| English STT | MAI-Transcribe-1.5 *(if available; else Sarvam Saaras as fallback)* |
| Indic STT / all TTS | Sarvam Saaras v3 / Bulbul v3 |

`gpt-5-mini` is multimodal, so it covers vision in the interim too. When the
restricted models are approved, switch the env vars (below) back to the target
stack — no code changes required.

> **Migration note (embeddings):** interim Cohere v3 is **1024-dim**, target
> text-embedding-3-large is **3072-dim**, and the legacy model was 1536-dim.
> Switching embedding models requires resizing the pgvector column and
> **re-embedding all existing transactions**. Plan a one-off backfill on each
> switch, and request embedding quota with headroom for that bulk job.

### Verified Cohere call (interim) — tested live 2026-06-06

```
POST https://aip-f-resource.services.ai.azure.com/models/embeddings?api-version=2024-05-01-preview
headers: api-key: <AZURE_AI_KEY>  (84-char key) ; content-type: application/json
body:    { "model": "Cohere-embed-v3-multilingual", "input": ["text1", "text2"] }
→ 200, 1024-dim vectors, ~295ms
```

Gotchas confirmed by testing: do **not** send Cohere's `input_type` (Azure AI
Inference embeddings schema rejects it → 422); the `model` field is required
(routes to the deployment); use api-version `2024-05-01-preview`; auth header is
`api-key` on the `services.ai.azure.com` host.

**Rate limit (verified):** 200,000 TPM / 1,000 RPM (standard serverless tier;
confirmed by burst probe — 30 concurrent calls, zero throttling). Region: East US 2.
≈6,600 embeddings/min at our input size — ample for a full bulk re-embed. Batch
multiple texts per request (input array) for backfills to stay under the 1,000 RPM.

### Verified gpt-5-mini call (interim) — tested live 2026-06-06

```
POST https://aip-f-resource.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview
headers: api-key: <AZURE_AI_KEY> (same 84-char resource key as Cohere) ; content-type: application/json
body:    { "model": "gpt-5-mini", "messages": [...] }   (max_completion_tokens optional)
→ 200, ~1.5–2.3s
```

Project endpoint (for the AI Foundry SDK) is `…/api/projects/aip-f`, but direct
REST inference uses the `/models/chat/completions` path above with the resource key.

### MAI-Transcribe-1.5 (English STT) — key verified live 2026-06-06

Azure AI Speech resource, region **eastus**, endpoint `https://eastus.api.cognitive.microsoft.com`,
auth header `Ocp-Apim-Subscription-Key: <AZURE_SPEECH_KEY>`. Key validated via
`POST /sts/v1.0/issueToken` → 200 (token issued). Full STT uses the fast-transcription
REST API (`/speechtotext/transcriptions:transcribe?api-version=2024-11-15`) with
`multipart/form-data` (audio file + a `definition` JSON selecting MAI-Transcribe-1.5).
End-to-end audio test pending a real voice sample at wiring time.

## Environment variable mapping

| Env var | Target | **Live now** |
| --- | --- | --- |
| `OPENAI_NLU_MODEL` | gpt-5.4-nano | **gpt-5.4-nano** ✅ (approved + cutover 2026-06-08) |
| `OPENAI_PARSE_MODEL` | gpt-5.4-nano | **gpt-5.4-nano** ✅ |
| `OPENAI_TRANSLATE_MODEL` | gpt-5.4-nano | **gpt-5.4-nano** ✅ (api + wa-bot) |
| `OPENAI_VISION_MODEL` | gpt-5.4-nano | **gpt-5.4-nano** ✅ |
| `OPENAI_CHAT_MODEL` | gpt-5-mini | gpt-5-mini |
| `OPENAI_ESCALATION_MODEL` *(new)* | gpt-5.4-mini | not wired (⏳ needs gpt-5.4-mini quota) |
| `OPENAI_EMBED_MODEL` | text-embedding-3-large | Cohere-embed-v3-multilingual (⏳ 3-large quota pending + bulk re-embed) |
| `OPENAI_TRANSCRIPTION_MODEL` | MAI-Transcribe-1.5 | MAI-Transcribe-1.5 |
| `SARVAM_STT_MODEL` *(new)* | saaras:v3 | saaras:v3 |
| `SARVAM_TTS_MODEL` *(new)* | bulbul:v3 | bulbul:v3 (speaker `kabir`) |

> **gpt-5.4-nano cutover (2026-06-08):** nano quota was approved and the four
> workhorse stages (intent, parse, translate, vision) were switched from the
> interim `gpt-5-mini` to `gpt-5.4-nano` on the live server — a pure env swap,
> no code change (`normalizeChatParams` already maps the `gpt-5*` family to
> `max_completion_tokens` + `reasoning_effort: minimal`). Verified live: valid
> JSON intent/parse, multilingual fraction parse (`ढाई सौ`→₹250, `सवा लाख`→₹1,25,000),
> Hindi translate, and image input — 0 failures, ~350ms vs gpt-5-mini's ~1.5–2.3s.
> Still on the interim tier: copilot chat (`gpt-5-mini`), embeddings (Cohere v3),
> and the low-confidence escalation path (needs `gpt-5.4-mini` quota).

> Azure uses *deployment names* (chosen at deploy time) + a Foundry endpoint +
> `api-version`, not the raw OpenAI base URL. `client.ts` switches to the Azure
> client; Cohere embeddings and the Azure AI services use their own endpoints.

## Quota request (Global Standard)

Submitted as TOTAL kTPM (the field value = TPM ÷ 1000):

| Model | Request (kTPM) | Basis |
| --- | --- | --- |
| gpt-5.4-nano | 200 (300 for max headroom) | workhorse; carries most calls + image reads; covers a heavy beta peak |
| gpt-5.4-mini | 80 (150 if chat later moves here) | escalation only; small fraction of requests |
| text-embedding-3-large | 120 | tiny per call; headroom for bulk re-embedding |

## Approximate cost (target stack, mini/nano tier)

Per active user/month, dominated by Sarvam TTS and copilot chat (LLM text tasks
are effectively free). Light ≈ ₹3 · Typical ≈ ₹10–15 · Heavy ≈ ₹40–50.
Per-op highlights: intent/parse ≈ ₹0.02, chat ≈ ₹0.04, vision ≈ ₹0.06–0.10,
STT ≈ ₹0.13/note, TTS ≈ ₹0.60/reply. (List prices; Azure deployment type adds 15–40%.)

## Why these picks (evidence)

- Our live benchmark: a small model hit **91% intent / 100% category / 100%
  extraction** — flagship is overkill for our tasks.
- Independent 2026 benchmark: GPT-5 vs GPT-5-mini differ by **<1%** on most tasks.
- Sarvam text models are blocked for real-time use: reasoning **cannot be disabled**
  over their API (confirmed by Sarvam DevRel + our tests), forcing 4–13s replies —
  so Sarvam stays audio-only, where it is genuinely SOTA for Indic.
- gpt-5.4-nano/mini chosen over gpt-4.1-mini/gpt-5.2: newer, cheaper, multimodal,
  configurable reasoning, ~2x faster, near-flagship quality.

## Open integration tasks (when keys land)

**STATUS: the interim Azure/Sarvam stack is LIVE in production (cutover 2026-06-06);
the four workhorse stages were upgraded to `gpt-5.4-nano` on 2026-06-08.**
Direct OpenAI is no longer used except as a TTS fallback. Remaining *target*
work is the embeddings upgrade (text-embedding-3-large + bulk re-embed) and the
low-confidence escalation path (`gpt-5.4-mini`), both pending their own quota.

Done at cutover:
1. ✅ `client.ts` (api + wa-bot) targets Azure AI Foundry when `AZURE_AI_KEY` +
   `AZURE_AI_ENDPOINT` are set (baseURL `<endpoint>/models`, `api-key` header,
   `api-version` query); chat + embeddings both route through it.
2. ✅ Env remapped on the server: NLU/parse/translate/vision → `gpt-5.4-nano`
   (upgraded from interim `gpt-5-mini` on 2026-06-08), chat → `gpt-5-mini`,
   embeddings → `Cohere-embed-v3-multilingual`.
3. ⏳ nano→gpt-5.4-mini escalation — pending `gpt-5.4-mini` quota.
4. ✅ STT router in `transcribe.ts`: `en` → MAI-Transcribe-1.5 (Azure Speech),
   Indic → Sarvam Saarika `saarika:v2.5`.
5. ✅ Sarvam Bulbul TTS wired (`bulbulSpeech.ts`) for all languages; OpenAI TTS
   kept as a decoupled fallback (`getOpenAITTS`, never Azure).
6. ❌ Content Safety / PII — cut (see above), regex-only.
7. ⏳ Document Intelligence — not needed; gpt-5-mini vision covers receipts.
8. ✅ Embeddings backfill: migration `0008` moved both vector columns to
   `vector(1024)` and truncated the (rebuildable) caches.

### Integration gotchas (verified live, save the next person the debugging)

- **Cohere embeddings need an ARRAY input.** `{"input":"text"}` → HTTP 422;
  `{"input":["text"]}` → 200. The OpenAI SDK passes a bare string by default,
  so `embed()` wraps it in an array.
- **Sarvam STT rejects `audio/ogg; codecs=opus`** (the exact MIME WhatsApp
  sends) → 400, but accepts the same Opus bytes as `audio/ogg`. Strip the codec
  param. 30s sync cap — longer notes need the batch API (we fall back to MAI).
- **Sarvam Bulbul can emit MP3** via `output_audio_codec: "mp3"` (default is
  WAV, which WhatsApp rejects) — so no ffmpeg/transcode step is needed.
  `bulbul:v2` speaker `anushka`; `bulbul:v3` needs different speakers.
- **gpt-5-mini honours `reasoning_effort: "minimal"` on Azure** (0 reasoning
  tokens) — essential, or hidden reasoning eats the `max_completion_tokens`
  budget and the answer comes back empty.
- **Drizzle migration journal**: a prior corrupted `created_at`
  (`1780671812458355524`, beyond JS safe-integer range) made new migrations
  look "older" and silently skip; the SERIAL `id` sequence was also desynced.
  Fixed both directly in `drizzle.__drizzle_migrations`.

## Benchmark: new (Azure interim) vs old (OpenAI-only) — 2026-06-06

Full head-to-head, 274 live calls across 3 parallel agents. Detail in
`_bench/BENCHMARK_new_vs_old.txt`.

| Component | New (Azure) | Old (OpenAI) | Result |
| --- | --- | --- | --- |
| Intent acc | 98.0% | 95.9% | ~tie |
| Category acc | 96.7% | 100% | ~tie |
| Extraction (amt/type/cat) | 100% | 100% | tie |
| Chat language discipline | 100% | 81.8% | **New** (old drifts to Spanish/French) |
| Injection safety | 0 leaks | 0 leaks | tie (both safe) |
| Embeddings top-1 | 91.7% | 75.0% | **New** |
| Embeddings cross-lingual | 66.7% | 33.3% | **New** |
| STT normalized WER | 4.8% | 4.8% | tie |
| LLM latency (median) | ~1.0–4.5s | ~0.6–1.2s | Old faster (gpt-5-mini reasoning tax) |

Verdict: new stack is at-least-as-good on quality, clearly better on embeddings
and multilingual chat. Must-fix before interim chat ships on gpt-5-mini:
(1) raise `max_completion_tokens` to ~1500–2000 for Indic chats (1000 truncated a
Malayalam reply to null); (2) treat Azure content-filter HTTP 400 as a graceful
in-app refusal; (3) latency improves at target stack (gpt-5.4-nano workhorse).
