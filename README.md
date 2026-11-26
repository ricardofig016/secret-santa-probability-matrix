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
3. Choose **Expected score** or **Beat target** below the matrix. Expected-score ballots maximize the average number of correct pairs under the model. Target-score ballots aim to score strictly above the slider value. Each objective has a repeats-allowed ballot and a unique-recipient ballot. The target is a score to beat, not a prediction of how someone else will score.
4. Click a name in the matrix header to highlight its row or column. Click it again to clear the highlight.
5. Turn on **Team of 2** when two people share points and submit separate ballots. The setting is saved with the group. The app chooses the two ballots together and scores each draw by the better ballot. Each card shows the chance of getting at least 4 to 8 pairs right. **Deep search** keeps looking for a better pair in the background for 10 seconds, 30 seconds, 2 minutes or 5 minutes. Cancel it to keep the best pair found so far. Expected-score team cards also show an upper bound. Unique-recipient cards use a tighter bound that allows each person to be guessed at most twice across both ballots.

Run `npm run bench` to compare the team search algorithms on synthetic groups. Small groups are compared with an exhaustive search for the best pair. Add `-- --family data/<group>.yaml` to include a saved group. `SMALL_SEEDS` sets the number of small cases. `DEEP_BUDGETS` lists the small-group deep-search budgets in milliseconds, and `DEEP_BUDGET_MS` sets the larger-group budget. Benchmark budgets are soft limits. The app enforces the duration selected on the card by stopping its worker.

The server saves each group to a separate YAML file in the `data` folder. Run only one server for that folder and avoid editing its files while the app is open. Wait for **Saved** before closing. **Undo** restores the last edit and autosaves the restored inputs. Group switching waits for saves. If a save fails, use **Retry save**. If another tab has saved a newer version, **Reload saved group** discards your unsaved edits after asking for confirmation.

## What the numbers mean

The provisional model starts from equally likely one-to-one assignments without self-pairs. It removes assignments that contradict confirmed pairs or exclusions, then reweights the remaining draws using your relative clues. The matrix reports the probabilities of the resulting model. Reciprocal pairs and multiple cycles remain possible; no inferred DrawNames bias is enabled.

The single-ballot expected-score search is exact under that model. Team searches are approximate, but their displayed scores are exact for the ballots shown. For larger groups the target-score search ordinarily uses a heuristic, then calculates the chance of exceeding the target for the ballot it found. The label distinguishes approximate search from an optimal ballot. These are model probabilities, not verified odds from DrawNames.
