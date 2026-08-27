# Vault Delegate

## Abstract

This local example models the portal pattern without hosted services. A vault head issues a bounded MintDelegate, a bot verifies it, mints an action capability, signs an action, and proves that tampering is rejected.

## Run

```bash
npm run vault:delegate
```

## Expected Result

The delegate verifies, the bot request verifies, an action capability is minted, the authentic action verifies, and the tampered action is rejected.
