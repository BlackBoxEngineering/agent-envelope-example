# Portal Hosted Bot

## Abstract

This is the basic hosted governance flow. A bot uses `AE_API_KEY`, `AE_BOT_KEY`, `AE_DELEGATE_ID`, and `AE_MINT_MATERIAL` to fetch a portal-issued delegate, mint through the hosted API, derive a local action capability, and verify a hosted public record.

`AE_BOT_KEY` is generated locally because it belongs to the runtime bot, not the portal vault. The portal issues authority through delegates and mint material; the bot keeps its own private identity key in its own secret store and uses it to prove itself when signing mint requests. Many bots can use the same portal pattern, so the web app should not generate or retain their private keys.

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
