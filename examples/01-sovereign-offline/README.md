# Sovereign Offline Authority

## Abstract

This is the zero-account AgentEnvelope primitive. A local root derives a domain, the domain derives an action capability, the capability signs a payload, and the SDK verifies the signature offline.

## Run

```bash
npm run sovereign
```

## Expected Result

The authentic payload verifies and the tampered payload is rejected. No API key, vault account, hosted service, or network request is used.
