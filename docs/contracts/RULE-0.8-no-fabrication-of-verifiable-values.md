# CONTRACT TO INSERT INTO CLAUDE.md (RULE 0.8)

Paste the block below into `CLAUDE.md` directly after RULE 0.7 (keep the house style).
This closes the gap RULE 0.7 left open: the no-invention moat covered SWFL **data
numbers** only — brand colors, logos, dimensions, IDs, versions, and any other
directly-checkable value were never covered, so they kept getting fabricated.

---

# RULE 0.8 — NEVER FABRICATE A VERIFIABLE VALUE. FETCH IT OR SAMPLE IT.

**Locked 2026-06-25 after the SNICKLEFRITZ brand-color fuck-up (twice in one session): the
Century 21 gold was eyeballed off the logo instead of read from the brand page the operator
HANDED OVER (`brandcolorcode.com/century-21` → Relentless Gold `#BEAF88`, Grey `#252526`);
the Powers periwinkle was carried forward from a stale scrape (`#7572b2`) instead of sampled
from the real logo (`#8B8BBC`). Both are fabrication of a value that was one fetch/sample away.**

A value you assert is in exactly **one of two states** — there is no "pretty sure":

1. **VERIFIED** — you fetched, downloaded, opened, queried, or pixel-sampled it from an
   authoritative source **this session**, and you cite that source. Copy it **VERBATIM**.
2. **INFERRED** — you cannot reach the source, so you mark it `[INFERENCE]`, give the base
   value, and state one falsifier (per the Rules of Engagement).

Presenting anything else — a remembered value, an approximation, a "close enough" proxy, a
prior session's/scrape's unchecked value — **as if it were fact is the violation.**

**The rules:**
1. **If ground truth is one fetch/sample away, getting it is mandatory.** A color → read the
   brand's published page OR sample the logo's actual pixels (`sharp` raw RGBA). A number →
   query the lake. A MIME type / model ID / version / endpoint → read the live vendor doc
   (RULE 0.1 Vendor-First). A dimension / hash / id → open the file or hit the API. Eyeballing,
   remembering, or guessing a fetchable value is forbidden.
2. **A proxy is not the value.** The logo's gold ≠ the brand's published gold. A nearby swatch
   ≠ the swatch. "It looks about right" ≠ the hex. Get the real one.
3. **Never launder a stale value.** "The folder/spec/prior session already said X" is NOT
   verification — those can hold a prior fabrication. **Re-verify at the point of use.**
4. **Read the operator's source FIRST.** When he hands you a URL / path / file, open it and
   copy the value verbatim before doing anything else (twin of "read the path the operator
   hands you"). His source is authoritative; your memory is not.
5. **Cost of one fetch ≪ cost of shipping an invented value.** The wrong hex/MIME/ID ships and
   silently breaks. Stop guessing, fetch the source, read it, copy it.

**Scope:** ALL directly-checkable values — colors, logos, image dims, numbers, model IDs, MIME
types, API shapes, versions, file hashes, addresses, names. This is RULE 0.7's no-invention
moat extended from SWFL data to every verifiable fact. Subagents follow it too.

**Self-check before asserting any value:** "Did I fetch/sample this THIS session, or am I
reconstructing it?" If reconstructing and the source is reachable → stop and go get it.
