# Hosted Multi-Flow

## Abstract

This is the current hosted showcase. The bot fetches a portal delegate, sends every tool call through hosted mint, derives and signs locally, publishes seedless `remote-mint-delegate` public records, and verifies them through the hosted API.

## Run

```bash
npm run hosted:multi
```

## Expected Result

The script executes read-thread, issue-refund, and send-message; publishes three hosted records; writes `hosted-records.json`; and verifies all three records through `POST /sovereign/verify`.

See `TRANSCRIPT.md` for an older captured transcript.
