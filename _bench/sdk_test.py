"""
Settle the discrepancy: docs say reasoning_effort=None disables reasoning, but
raw REST JSON null did NOT. Does the official SDK succeed where raw REST failed?
Also sniff the exact HTTP body the SDK sends so we can replicate it from Node.
"""
import time
import json
from pathlib import Path

KEY = Path(__file__).with_name(".sarvam.key").read_text(encoding="utf-8").strip()

from sarvamai import SarvamAI

client = SarvamAI(api_subscription_key=KEY)

CHAT_SYS = "You are a concise financial assistant for WhatsApp. Reply in 2-3 sentences, plain language, no markdown."
USER = "how do I start an emergency fund"

def show(label, resp, ms):
    try:
        msg = resp.choices[0].message
        content = getattr(msg, "content", None)
        reasoning = getattr(msg, "reasoning_content", None)
        finish = getattr(resp.choices[0], "finish_reason", None)
        usage = getattr(resp, "usage", None)
        comp = getattr(usage, "completion_tokens", None) if usage else None
        rlen = len(reasoning) if reasoning else 0
        c = (json.dumps(content)[:90]) if content else "(NULL)"
        print(f"[{label}] {ms}ms finish={finish} reasoning={rlen}ch comp={comp} -> {c}")
    except Exception as e:
        print(f"[{label}] parse-fail: {e!r}  raw={resp!r}")

def run(label, **kwargs):
    t0 = time.time()
    try:
        resp = client.chat.completions(
            messages=[
                {"role": "system", "content": CHAT_SYS},
                {"role": "user", "content": USER},
            ],
            **kwargs,
        )
        ms = int((time.time() - t0) * 1000)
        show(label, resp, ms)
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        print(f"[{label}] {ms}ms ERROR: {e!r}")

print("=== Official SDK: does reasoning_effort=None disable reasoning? ===\n")
run("30b None small-budget", model="sarvam-30b", reasoning_effort=None, max_tokens=256, temperature=0.2)
run("30b None big-budget",   model="sarvam-30b", reasoning_effort=None, max_tokens=800, temperature=0.2)
run("30b 'low' big-budget",  model="sarvam-30b", reasoning_effort="low", max_tokens=800, temperature=0.2)
run("30b default",           model="sarvam-30b", max_tokens=800, temperature=0.2)
run("105b None big-budget",  model="sarvam-105b", reasoning_effort=None, max_tokens=800, temperature=0.2)
