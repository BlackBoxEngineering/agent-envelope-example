# Portal Hosted Bot

## Abstract

This is the basic hosted governance flow. A bot uses `AE_API_KEY`, `AE_BOT_KEY`, `AE_DELEGATE_ID`, and `AE_MINT_MATERIAL` to fetch a portal-issued delegate, mint through the hosted API, derive a local action capability, and verify a hosted public record.

## Run

```bash
npm run portal:setup
npm run bot
npm run verifier
```

Or run the basic chain:

```bash
npm run demo
```

## Expected Result

The bot receives a valid hosted mint receipt, signs locally without sending signing material to the API, and the verifier can look up the corresponding hosted public action record.
