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

## Portal Credential Walkthrough

Use this path to fill `.env.local` for the hosted examples.

1. Create a vault in the web app.

   After the vault is created, copy the displayed `User id` into:

   ```bash
   AE_OWNER_USER_ID=<user-id>
   ```

2. Create the example domain.

   In Domains, use:

   ```text
   Namespace: customer-support
   Domain ID: support-ops
   Kind: agent
   ```

   Enter your vault passphrase and create the domain. No example env vars are copied from this step.

3. Create the delegate.

   Go to Agents, select the authority branch/domain you just created, then create a delegate with:

   ```text
   Allowed operations: read-thread, send-message, issue-refund
   Allowed resources:  thread:*, order:*
   Max mints:          50
   Max uses/action:    1
   Action index min:   0
   Action index max:   100
   Expiry:             about one week
   ```

   Keep `Create legitimacy state for this delegate` selected, then issue the delegate.

4. Copy the issued values.

   From the issued delegate panel:

   ```bash
   AE_DELEGATE_ID=ae-delegate-...
   AE_MINT_MATERIAL=0x...
   ```

   Set your local bot label:

   ```bash
   AE_BOT_ID=support-agent
   ```

5. Copy the legitimacy id.

   In Active delegates, confirm the row shows a legitimacy attachment and an allowed check, for example:

   ```text
   Legitimacy:       ae-legit-...
   Legitimacy check: allowed v1
   ```

   Put that id in:

   ```bash
   AE_LEGITIMACY_ID=ae-legit-...
   ```

6. Generate the bot key locally.

   The bot key is external to the portal because it belongs to this runtime bot. Run:

   ```bash
   npm run portal:setup
   ```

   This generates `AE_BOT_KEY` in `.env.local` if missing and prints the bot public address. It does not print the private key. `AE_BOT_ID` remains the label you choose, such as `support-agent`.

7. Check the setup.

   ```bash
   npm run preflight
   npm run legitimacy
   npm run hosted:multi
   ```
