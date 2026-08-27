# Multi-Agent Workflow

## Abstract

This is a local three-bot support workflow. OpsBot reads the thread, FinanceBot issues the refund, and MsgBot sends the customer update. Each bot has a separate authority.

## Run

```bash
npm run multi:agent
```

## Expected Result

The LLM orchestrates the workflow while each bot enforces its own operation and resource bounds.
