# Manufacturing Legitimacy

## Abstract

This is the robot and trolley example. A signed command says `robot2.pickUp(trolley4, bay7)`, but sensor reality says the trolley is now in another bay. The signature remains valid, while legitimacy denies the old command and permits the corrected one.

## Run

```bash
npm run manufacturing:legitimacy
```

## Expected Result

The old command is denied as `state.mismatched`, a legitimacy patch is shown, and a corrected command for the observed bay is allowed.
