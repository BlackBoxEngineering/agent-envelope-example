# Hosted Multi-Agent Transcript

This is a recorded example of `npm run hosted:multi` for readers who do not have
access to the hosted portal.

The run uses a portal-issued `MintDelegate` for the domain
`customer-support / support-ops / operation` with these operations:

```text
read-thread, send-message, issue-refund
```

The bot holds only:

- `AE_API_KEY`
- `AE_BOT_ID`
- `AE_DELEGATE_ID`
- `AE_BOT_KEY`
- `AE_MINT_MATERIAL`
- `mint-delegate.json` with `domainSummary` metadata

Record registration remains account-owned and Cognito authenticated. The example
demonstrates hosted mint receipts; record-backed hosted verification works once
the owner registers the generated public record manifests through the portal.

## Successful Hosted Mint Run

Command:

```powershell
npm run hosted:multi
```

Representative output:

```text
1. Fetch delegate from hosted API
   GET /sovereign/delegates/ae-delegate-9d4b42fc948a6193
   ✓ Delegate verified
   Issuer:     0xa520a28fdc2456fb592a694fcfe84b28aeeceeda
   Operations: read-thread, send-message, issue-refund
   Resources:  *

2. Initialize bot with delegate + mint material
   Bot address: 0x2e74ed20c9dec944ab56bf3ac03885690c0560ca
   Agent id prefix: support-agent
   ✓ Ready to mint and generate seedless public record manifests
   Record registration remains account-owned and Cognito authenticated

3. User prompt
   "Customer in thread customer-123 wants a refund for order ORD-456 ($99.99). Handle it."

4. Agent loop (LLM → Bot → Hosted API)

   LLM: "I'll handle this refund request by first reading the thread, processing the refund, and then confirming with the customer."

   Tool calls (each goes through hosted mint):

     read_thread
     Input: {"threadId":"customer-123"}
     ✓ EXECUTED
       Agent:   0x6026e54245bb8be6d0ce7df0d1f023cf05bd0c28
       Sig:     0x2f9a349c670b76e43a...
       Receipt: ae-request-dbb4fb9d92bd76de (valid: true)

   LLM: "Now I'll process the refund and send a confirmation message to the customer."

   Tool calls (each goes through hosted mint):

     issue_refund
     Input: {"orderId":"ORD-456","amount":99.99}
     ✓ EXECUTED
       Agent:   0x3ec06c98fecd4800a3c12a6383b66f20e4bb9462
       Sig:     0x122a5c81fbf88d38d3...
       Receipt: ae-request-9f26eb69f2b46262 (valid: true)

     send_message
     Input: {"threadId":"customer-123","message":"Hi! I've processed your refund for order ORD-456..."}
     ✓ EXECUTED
       Agent:   0xbb2dd2c2c12ff0a6672f4a6d686b0374593be2f1
       Sig:     0xd024111429e931a1b9...
       Receipt: ae-request-6e90aa7c6eff81e2 (valid: true)

   LLM: "Done! I've successfully:
   1. Read the thread
   2. Processed the refund
   3. Sent a confirmation message to the customer"

   Generated 3 public record manifest(s): hosted-records.json

5. Hosted verification (POST /sovereign/verify)
   ✗ support-agent-read-thread-0: No hosted public record was registered for this action
   ✗ support-agent-issue-refund-1: No hosted public record was registered for this action
   ✗ support-agent-send-message-2: No hosted public record was registered for this action

6. Summary
   Executed: 3 (read_thread, issue_refund, send_message)
   Blocked:  0 (none)
   Records:  3 generated locally, 0 registered

   │ Every mint went through POST /sovereign/mint.              │
   │ The hosted API verified delegate + bot + policy bounds.    │
   │ Receipts prove the mint was valid at that moment.          │
   │ Seedless public record manifests were generated locally.   │
   │ Registration is intentionally portal/account governed.     │
   │ Hosted record verification waits until records are live.   │
```

## Exhausted Delegate Run

After the same delegate's `maxMints` were consumed, the delegate still fetched
and verified, but the hosted mint endpoint refused new action keys.

Representative output:

```text
1. Fetch delegate from hosted API
   GET /sovereign/delegates/ae-delegate-9d4b42fc948a6193
   ✓ Delegate verified
   Operations: read-thread, send-message, issue-refund
   Resources:  *

4. Agent loop (LLM → Bot → Hosted API)

   Tool calls (each goes through hosted mint):

     read_thread
     ✗ BLOCKED at hosted_mint
       Reason: Mint failed: 409 {"error":"delegate mint limit reached"}

     issue_refund
     ✗ BLOCKED at hosted_mint
       Reason: Mint failed: 409 {"error":"delegate mint limit reached"}

   LLM: "Contact your system administrator about the delegate mint limit reached error..."

6. Summary
   Executed: 0 (none)
   Blocked:  2 (read_thread, issue_refund)

   │ Every mint went through POST /sovereign/mint.              │
   │ The hosted API verified delegate + bot + policy bounds.    │
   │ Receipts prove the mint was valid at that moment.          │
   │ Domain metadata was available, but no records were         │
   │ generated because no hosted mint completed successfully.   │
   │ Check blocked tool reasons above, such as mint limits.     │
```

The important behavior is that the LLM can keep trying to complete the task, but
it cannot cross the hosted authority boundary. Once the delegate mint limit is
reached, the hosted API refuses to mint new request-scoped action keys.

