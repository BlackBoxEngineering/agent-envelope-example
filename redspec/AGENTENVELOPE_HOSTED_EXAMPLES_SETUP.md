# AgentEnvelope Hosted Examples Setup

These instructions let you create your own test credentials for the AgentEnvelope examples. Do not use or share production credentials.

## 1. Install The Example Repo

```bash
npm install
cp .env.example .env.local
```

## 2. Create A Vault

Go to `https://agentenvelope.io`, sign in, then create a vault.

After the vault is created, copy the displayed `User id` into `.env.local`:

```bash
AE_OWNER_USER_ID=<your-user-id>
```

## 3. Create The Example Domain

Go to Domains and create:

```text
Namespace: customer-support
Domain ID: support-ops
Kind: agent
```

Enter your vault passphrase and create the domain.

No env vars are copied from this step.

## 4. Create An API Key

Go to Account / API keys, create or rotate an API key, then put it in `.env.local`:

```bash
AE_API_KEY=<your-api-key>
```

## 5. Choose A Bot Id

Set:

```bash
AE_BOT_ID=support-agent
```

This is just the public label for the worker. It is not a private key.

## 6. Generate The Bot Key Locally

Run:

```bash
npm run portal:setup
```

This creates `AE_BOT_KEY` inside `.env.local` if it is missing. The private key is not printed.

The script prints the bot public address. Keep that handy if you use an address-set bot policy.

## 7. Create The Delegate

Go to Agents, select the domain you created, and create a delegate with:

```text
Allowed operations: read-thread, send-message, issue-refund
Allowed resources:  thread:*, order:*
Max mints:          50
Max uses/action:    1
Action index min:   0
Action index max:   100
Expiry:             about one week
```

Make sure this is selected:

```text
Create legitimacy state for this delegate
```

Then issue the delegate.

## 8. Copy Delegate Outputs

From the issued delegate panel, put these into `.env.local`:

```bash
AE_DELEGATE_ID=ae-delegate-...
AE_MINT_MATERIAL=0x...
```

In Active delegates, find:

```text
Legitimacy: ae-legit-...
Legitimacy check: allowed v1
```

Put that id into `.env.local`:

```bash
AE_LEGITIMACY_ID=ae-legit-...
```

## 9. Check Everything

Run:

```bash
npm run preflight
npm run legitimacy
npm run hosted:multi
```

Expected result: preflight passes, legitimacy shows `status: legitimate`, and hosted multi-flow mints actions, publishes records, and verifies them through the hosted API.
