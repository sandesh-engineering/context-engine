# ADR-005: Local / Free LLM Initially Behind Provider Abstraction

## Status

Accepted

## Context

Knowledge Engine requires a Large Language Model (LLM) to synthesize retrieved document passages into grounded conversational answers. We must choose between proprietary paid LLM services (e.g., OpenAI GPT-4o, Anthropic Claude 3.5) and local/free open-weight models (e.g., Llama 3 / Mistral via Ollama or local inference server).

## Decision

We will use a **local / free LLM** (such as Llama 3 or Mistral running via Ollama or local server) as our baseline provider during initial development, strictly isolated behind a generic **`ILlmProvider` interface boundary**.

## Alternatives Considered

1. **Direct Integration with Commercial SaaS APIs (OpenAI / Anthropic)**:
   - *Pros*: Superior instruction-following and reasoning capabilities out of the box.
   - *Cons*: Token cost accumulation during rapid testing, API key requirement for local developers, vendor lock-in risk if vendor-specific SDK classes leak into application logic.

## Rationale

- **Developer Friction Reduction**: Any engineer can clone the repository and run end-to-end chat integration tests locally without requiring active cloud provider subscriptions or API credentials.
- **Strict Boundary Enforcement**: Isolating the LLM behind `ILlmProvider` forces clean architecture boundaries. Application code relies on abstract methods (`generateStream(prompt, history)`), making the system agnostic to underlying model hosting.
- **Sufficient Baseline**: Open-weight local models are fully capable of executing grounded summarization when provided structured context and strict system prompt constraints.

## Consequences

### Positive
- Zero cost for development, integration testing, and local developer experimentation.
- Complete control over model hosting environment and privacy.
- Plug-and-play capability to swap to Anthropic/OpenAI providers by supplying an alternative adapter.

### Negative
- Local LLM inference requires sufficient RAM/GPU hardware on local dev machines or staging servers.
- Smaller open-weight models may exhibit weaker instruction adherence compared to frontier commercial models.

## Revisit When

Reconsider this decision if:
1. Production quality metrics require frontier model reasoning capabilities beyond local open-weight model capacities.

## Related Documentation

- [[../architecture/chat]]
- [[../domain/conversations]]
- [[ADR-004-self-hosted-embeddings]]
