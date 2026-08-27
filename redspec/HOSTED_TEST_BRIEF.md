# Hosted Governance Test Brief

Please test the portal-issued delegate and hosted mint/verify path, not only the local example scripts.

## Scope

- Use a dedicated test account and API key only.
- Target hosted delegate fetch, hosted mint, delegated record registration, and hosted verify.
- Treat local example fallback files as demo handoff files, not the trust boundary, unless proving they can override hosted state.
- Classify each result as one of:
  - Hosted enforcement failure
  - Example adapter hardening
  - Out-of-scope business policy

## Primary Test Areas

### 1. Portal Legitimacy Check

Test:

- Mint with a delegate that has a valid portal legitimacy ref.
- Mint with no legitimacy ref.
- Mint with a wrong-scope legitimacy ref.
- Mint after the legitimacy state is suspended, revoked, denied, or expired.

Expected:

- Only valid, active, portal-governed legitimacy should pass when enforcement mode requires it.

### 2. Local Delegate Override Attempt

Test:

- Fetch the delegate by `AE_DELEGATE_ID`.
- Put a stronger local `mint-delegate.json` beside the example, with broader operations or resources.
- Try to mint using the modified local delegate.

Expected:

- Hosted mint should reject any request that is not backed by valid signed authority and current hosted checks.
- A local fallback file must not silently escalate portal-issued authority.

### 3. Wildcard Resource Injection

Test:

- Issue a delegate scoped to a narrow resource, for example `customer:123`.
- Try LLM/tool input that produces:
  - `customer:*`
  - `customer:123:*`
  - `*`
  - `customer:123\ncustomer:*`
  - encoded, padded, or malformed variants

Expected:

- Hosted mint rejects anything outside the delegated resource policy.
- If an example adapter builds unsafe resource strings from raw LLM input, report that separately as adapter hardening.

### 4. Operation Overreach

Test:

- Issue a delegate that only allows a benign operation such as `send-message`.
- Try operations such as:
  - `refund-override`
  - `case-escalate`
  - `customer-data-export`
  - `audit-note-delete`

Expected:

- Overreach is blocked before execution, either by local authority checks or hosted mint.

### 5. Nonce Replay

Test:

- Submit the exact same signed mint request twice.
- Submit many concurrent copies of the same signed mint request.

Expected:

- At most one request succeeds.
- Duplicates should fail with replay or conflict behavior.

### 6. Mint Count Race

Test:

- Issue a delegate with `maxMints = 1` or `maxMints = 2`.
- Fire many concurrent valid mint requests with unique nonces.

Expected:

- No more than `maxMints` requests succeed.

### 7. Action Index Bounds

Test:

- Try action indexes below the delegate minimum.
- Try action indexes above the delegate maximum.
- Try duplicate action indexes.
- Try concurrent requests using the same action index.

Expected:

- Out-of-range indexes are rejected.
- Duplicate in-range indexes are only a vulnerability if the product claims per-index uniqueness. Otherwise nonce replay and delegate mint count are the hosted enforcement boundaries.

### 8. Delegated Record Registration Consistency

Test:

- Complete a hosted mint for operation/resource/actionIndex A.
- Try to register a public record that changes any of:
  - operation
  - resources
  - action index
  - owner
  - agent id
  - domain
  - max uses
  - time window

Expected:

- Delegated registration rejects records that do not match the hosted mint request and stored delegate.

### 9. Revocation

Test:

- Mint successfully with a delegate.
- Revoke the delegate in the portal.
- Try minting again.
- Try delegated record registration after revocation.

Expected:

- Hosted paths reject revoked delegates.

### 10. State Preconditions

Test:

- Use valid cryptographic authority against a nonexistent, refunded, closed, locked, or otherwise invalid business object.

Expected:

- AgentEnvelope should prove bounded authority.
- Application or policy logic should deny invalid business state.
- Report this as a hosted enforcement issue only if the product explicitly claims AgentEnvelope itself enforces object existence or business state.

## Reporting Format

For each finding, please include:

- Title
- Severity
- Classification: hosted enforcement failure, example adapter hardening, or out-of-scope business policy
- Exact route/script tested
- Delegate policy used
- Request body or reproduction steps
- Expected result
- Actual result
- Whether the portal/hosted mint check was exercised

