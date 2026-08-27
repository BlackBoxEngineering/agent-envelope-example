# LLM Drift

## Abstract

This shows the boundary between model intent and delegated authority. The LLM can ask for extra tool calls, but the bot can only mint capabilities allowed by the active delegate.

## Run

```bash
npm run llm:drift
npm run llm:drift:portal
```

## Expected Result

The local run blocks operations outside a narrow delegate. The portal run uses the real hosted delegate and shows the model acting only within the configured operations and resources.
