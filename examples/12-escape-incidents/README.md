# Escape Incidents

## Abstract

This demo maps known unsafe operation/resource patterns to AgentEnvelope action envelopes. It shows an approval gateway allowing declared in-range work while rejecting substitutions, benchmark answer access, package publishing, public forge writes, secret publishing, and tunnel attempts.

## Run

```bash
npm run escape:incidents
```

## Expected Result

The declared safe action is allowed and the listed incident attempts are blocked before execution.
