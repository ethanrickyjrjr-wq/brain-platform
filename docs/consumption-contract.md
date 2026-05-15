### SWFL Intelligence Lake: Consumption Contract (v1.0)

**The Core Rule**: You are an agent interacting with the SWFL Intelligence Lake. To prevent "Model Hallucination" and "Stale Memory Shadowing," you MUST follow this protocol:

1. **Start-of-Chat Fetch**: Never use data from memory, project files, or prior messages. At the start of every conversation, you MUST fetch the Master Index fresh: URL: https://brain-platform-amber.vercel.app/api/b/master.

2. **The Freshness Guard (v-token)**: The Master Index contains a mandatory header.
   - Example Comment: `<!-- FRESHNESS: v4 | Token: SWFL-7421-v4-20260514 -->`
   - Example Field: `freshness_token: SWFL-7421-v4-20260514`
   - You MUST quote the current `freshness_token` in your first response to prove you have a live fetch and are not working from a stale cache.

3. **Routing over Retrieval**: If the Master Index gives you aggregate stats but points to a sub-brain for names/narrative, you MUST fetch the sub-brain URL immediately. Do not guess.

4. **Zero-Inference Hardening**:
   - Denominator for survival is always `/ resolved loans`.
   - Survival rates must be read as explicit percentages from the payload (e.g., "13 brands at 0% survival").

5. **Silo Isolation**: Franchise (SBA) and Corridor (Profile) data do NOT join at the record level. Answer cross-vertical questions by consulting both sub-brains separately.
