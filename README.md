# Secret Santa guessing board

Track clues and compare guesses for a fixed-roster, one-recipient DrawNames Portugal celebration. The app runs on your computer and does not contact DrawNames.

## Run locally

Install Node.js 22 or newer, then run these commands from the project folder:

```powershell
npm install
npm start
```

Open <http://127.0.0.1:8765/>. Keep the terminal open while you use the page. Run `npm test` to check the solver and local storage.

## Use the board

1. Choose **New group** and add the participants, one name per line. The board supports up to 18 people. Use the **Group** dropdown to switch celebrations.
2. Select a matrix cell to open its clue menu. Rows give and columns receive. Use **Definitely excluded** and **Confirmed** for facts. Relative clues multiply the odds by ¼, ½, 2, or 4 without locking in a percentage.
3. Compare four ballots below the matrix. Expected-score ballots maximize the average number of correct pairs under the model. Target-score ballots aim to score strictly above the slider value. Each objective has a repeats-allowed ballot and a unique-recipient ballot. The target is a score to beat, not a prediction of how someone else will score.

The server saves each group to a separate YAML file in the `data` folder. Run only one server for that folder and avoid editing its files while the app is open. Wait for **Saved** before closing. **Undo** restores the last edit and autosaves the restored inputs. Group switching waits for saves. If a save fails, use **Retry save**. If another tab has saved a newer version, **Reload saved group** discards your unsaved edits after asking for confirmation.

## What the numbers mean

The provisional model starts from equally likely one-to-one assignments without self-pairs. It removes assignments that contradict confirmed pairs or exclusions, then reweights the remaining draws using your relative clues. The matrix reports the probabilities of the resulting model. Reciprocal pairs and multiple cycles remain possible; no inferred DrawNames bias is enabled.

The expected-score search is exact under that model. For larger groups the target-score search ordinarily uses a heuristic, then calculates the chance of exceeding the target for the ballot it found. The label distinguishes approximate search from an optimal ballot. These are model probabilities, not verified odds from DrawNames.
