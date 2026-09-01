# Pure-M10 local AI research

This audit contains the zero-recurring-credit Windows VPS local-model work.

- Production base: current pure M10 EA.
- Selected local runtime/model: native llama.cpp + Qwen3 0.6B Q8_0.
- Paid AI default: disabled.
- Local-confidence rule: below 70% means deterministic fallback.
- Prompt/cache contract: `xaucloud-local-ai-v4`.
- Research EAs: `research/local_ai_m10/`.
- Live deployment: prohibited until the fixed Model=4 replay and holdout pass.

Documents:

- `01_VPS_HARDWARE_AND_RUNTIME_AUDIT.md`
- `02_IMPLEMENTATION_AND_REPLAY_STATUS.md`
