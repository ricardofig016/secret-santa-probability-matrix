# DrawNames Portugal pairing research

Research date 25 November 2026. Scope covers fixed-roster, one-recipient web draws on DrawNames Portugal. The term *unrestricted* means the draw has no configured exclusions. Self-exclusion still applies.

## Findings and implications

- **Reciprocal pairs and multiple cycles are possible.** A five-person draw produced a reciprocal pair alongside a three-cycle. A six-person draw produced two separate three-cycles.
- **Strict single-cycle-first fails with exclusions.** All three mixed-support draws split even though a six-cycle was legal. With just one exclusion, two of four draws split despite 96 legal six-cycles.
- **Unrestricted six-person draws favored a single cycle in this sample.** All six were six-cycles. Under uniform sampling over all valid assignments, the probability of that result is 0.862%. The sample leaves room for a range of cycle preferences.
- **Solver baseline.** Keep all valid assignments eligible. Compare uniform sampling with a soft single-cycle preference for unrestricted six-person groups. Keep the cycle preference configurable and apply it before conditioning on clues.

## Documented rules and observed workflow

DrawNames documents that every participant in a standard draw gives to and receives from one person, with self-draws excluded. Custom exclusions are directional and private by default. Reusing a previous celebration can exclude the previous year's pairings. The FAQ describes the draw as random. The exact weighting, random generator, and timing of the full permutation remain unknown. [DrawNames Portugal setup](https://www.drawnames.pt/sorteio-amigo-secreto) · [Official FAQ](https://www.drawnames.com/help)

The FAQ also describes reassignment after membership changes. Removing someone can reconnect their giver to their recipient. Adding someone after everyone has viewed a recipient can change the organizer's assignment. Keep membership changes in the draw history when they apply. The live trials used fixed rosters. [Official FAQ](https://www.drawnames.com/help)

The public Vue setup client sends JSON requests to /lottery/checknames, /lottery/checkexcludes, /lottery/checkgroupname, and /lottery/checkdetails. The inspected bundles cover setup, exclusions, and the organizer view. The pairing generator remains unlocated. The setup bundle's adjacent source-map request returned HTTP 404. [Setup bundle](https://static-cdn.drawnames.com/dist/assets/Bly-Atd4y-qzQ8el.js) · [Exclusion editor](https://static-cdn.drawnames.com/dist/assets/Dwammuht0QdoDzm72.js) · [Organizer overview bundle](https://static-cdn.drawnames.com/dist/assets/QW9dlhpIA5ACogLh.js)

The organizer confirmed the first group with a five-digit email code. Later groups created in a signed-in session proceeded directly to the invitation screen. In the pilot, the overview marked the group as drawn before anyone had viewed a recipient, and the organizer's first reveal page already contained the recipient before its animation. These observations establish when the recipient was available to the client. [Organizer confirmation client](https://static-cdn.drawnames.com/dist/assets/nvilH_t8OZtugsSZ2.js) · [Organizer sign-in client](https://static-cdn.drawnames.com/dist/assets/B5Z4mjvk3e4A0tyQ.js) · [Participant reveal client](https://static-cdn.drawnames.com/dist/assets/CU4pNwYVEGQmOLk6.js)

The organizer results became available when the service reported that the celebration date had passed and the group was drawn. The view left unviewed recipients blank after organizer consent. Each fictional guest followed the official invitation, verified a Gmail plus alias, and revealed their recipient. The completed organizer lists matched all individual reveals. [Organizer results client](https://static-cdn.drawnames.com/dist/assets/CMqGZrOUVwrRlp5q.js) · [Invitation client](https://static-cdn.drawnames.com/dist/assets/SNnKhWjWuFLTcjLm2.js) · [Official app link association](https://drawnames.app/.well-known/assetlinks.json)

## Trial design and verification

The 16 completed groups comprise three initial draws and 13 follow-up draws. Each trial used a fresh fictional group, with A as organizer and the participants inserted and revealed in alphabetical order. Results were collected in the Portuguese web interface using one recipient per participant. The experiment treats distinct groups as independent for the binomial calculations. The first two follow-up batches fixed their sample sizes and primary statistic in advance. The one-exclusion batch was specified as an exploratory extension after the first four unrestricted results and triggered when all six unrestricted groups produced six-cycles.

The primary statistic was the count of six-cycles in each batch. Exact upper-tail probabilities measure how often the reference model would produce at least the observed count. The analyzer enumerates the complete assignment space and compares uniform valid assignments, uniform assignments without reciprocals, uniform single cycles, strict single-cycle-first with fallback, and sequential selection with restart in forward and reverse order. The strict fallback hypothesis selects a single cycle whenever the configured graph permits one and otherwise selects a valid derangement.

All 13 follow-up exclusion sets were checked in the saved organizer views, and DrawNames reported them in effect. Two trials had already completed their individual reveals when the first batch runner hit a write-permission error. Their organizer results recovered both permutations without repeating either draw. An early five-person group inherited the organizer's email on guest records. That group was excluded from analysis, and the probe now clears inherited guest email fields.

### Setup validation

- **Two-person diagnostic.** The tested two-name roster was rejected.
- **E1, four-person reciprocal-only.** The selector permits one exclusion per giver for four participants. The proposed two per giver exceeded that cap and the probe stopped before submission.
- **E1b, five-person reciprocal-only.** A, B, and C each excluded D and E. D and E each excluded B and C. The cap permitted the inputs, but the server returned its generic too-many-exclusions error. The graph had two valid permutations, both pairing D and E reciprocally. D and E each had only one eligible giver. The validation rule remains unidentified.
- **E1c, balanced five-person reciprocal-only.** The server accepted A excluding D and E, B excluding C and E, C excluding B and D, D excluding A and B, and E excluding A and C. Each giver and recipient had two eligible counterparts. The only legal recipient sequences in giver order A through E were B A E C D and C D A E B.
- **E2 and E2m, six-person split and mixed support.** The server accepted 18 cross-group exclusions for E2. In E2m it accepted 16, permitting C → D and F → A as the only cross-group edges.
- **E3, E4, E4s, and E6.** The unrestricted four- and six-person setups passed. The six-person E4s and four-person E6 setups passed with only A → B excluded. E6 was a validation and enumeration case.

The observed selector requires at least four participants for exclusions and caps exclusions per giver at roster size minus three in one-recipient mode. Accepted validation responses echoed the submitted directional exclusions. E1b and E1c required the same cycle lengths and produced different validation outcomes.

## Results

### Initial structural draws

- **E1c, five participants.** A ↔ C and B → D → E → B. Both feasible assignments contain a reciprocal pair. This establishes that the service supports reciprocal gifting under the tested exclusions and rules out a universal single-cycle rule or universal reciprocal ban. [Trial record](e1c-reciprocal.jsonl)
- **E2, six participants.** A → B → C → A and D → E → F → D. The 18 exclusions separated the triples, leaving four legal assignments, each with two three-cycles. [Trial record](e2-split.jsonl)
- **E3, unrestricted four participants.** A → B → C → D → A. Uniform derangements include six four-cycles and three assignments with two reciprocal pairs. The observed four-cycle category has probability 2/3 under that baseline. After zero reciprocal draws in 10 or 20 independent groups, the probabilities under that same baseline would be 1.73% and 0.0301%, respectively. Zero in 20 would still give a one-sided 95% upper bound of 13.9% on the reciprocal-group rate. [Trial record](e3-pilot.jsonl)

### Follow-up cycle preference

- **E2m, mixed support.** All three draws split into two three-cycles. The four original split assignments remained legal, and the two cross-group edges allowed exactly one six-cycle, A → B → C → D → E → F → A. The first split falsified strict single-cycle-first in this setup. Under uniform valid assignments, three splits have probability 51.2%, and the upper-tail p-value for favoring six-cycles is 1. The one-sided 95% upper confidence bound on the six-cycle rate is 63.2%. [Trial records](e2m-follow-up.jsonl)
- **E4, unrestricted six participants.** All six draws were six-cycles. Exact enumeration under uniform derangements gives counts of 120, 90, 40, and 15 for cycle structures 6, 4 + 2, 3 + 3, and 2 + 2 + 2. The six-cycle rate is 24/53 under that baseline and 3/4 under uniform no-reciprocal sampling. Six six-cycles have probability 0.862% and 17.8%, respectively. The one-sided 95% lower confidence bound on the six-cycle rate is 60.7%. Both a strict unrestricted rule and a softer preference remain plausible. [Trial records](e4-follow-up.jsonl)
- **E4s, six participants with one exclusion.** With A → B excluded, two of four draws were six-cycles and two were pairs of three-cycles. The case has 212 valid assignments including 96 six-cycles. Its reference six-cycle probabilities remain 24/53 and 3/4. The upper-tail probabilities for at least two six-cycles are 61.4% and 94.9%, respectively. Both references fit this small exploratory batch. The splits rule out strict single-cycle-first even with just one exclusion. [Trial records](e4s-follow-up.jsonl)

Organizer A drew C in five of six unrestricted groups. This pattern emerged after collection. A → C occurred in one of four one-exclusion groups, matching its expected count under uniform reference models for that case. These batches held names, organizer, insertion order, and reveal order fixed. They cannot isolate any of those influences, and the change in exclusions makes the one-exclusion check exploratory.

### Asymmetric four-person reference

With only A → B excluded, E6 has six legal derangements. Exact uniform marginals are below.

| Giver | A | B | C | D |
| --- | ---: | ---: | ---: | ---: |
| A | 0 | 0 | 1/2 | 1/2 |
| B | 1/3 | 0 | 1/3 | 1/3 |
| C | 1/3 | 1/2 | 0 | 1/6 |
| D | 1/3 | 1/2 | 1/6 | 0 |

Uniform single-cycle sampling gives B → A probability 1/2. Sequential selection that chooses uniformly among legal available recipients and starts over at a dead end gives A → C probability 3/7 in forward order and 9/17 in reverse. The analyzer multiplies the per-step probabilities for each successful assignment and normalizes them over all successful assignments. These are model predictions for future frequency tests.

## Probability model and guessing strategy

1. Build the feasible assignment graph from the roster, self-exclusion, verified directional exclusions, and any applicable prior-year restrictions. Keep reciprocal pairs and multiple cycles eligible where the graph permits them. If membership changed after the draw, use the original settings and the known draw history.
2. Use uniform valid assignments as the baseline. For unrestricted six-person groups, compare it with a prior that assigns total mass q to single cycles and 1−q to other assignments, with uniform weighting within each class. The uniform baseline has q = 24/53. With a Beta(1,1) prior on q, six observed six-cycles give a posterior predictive q of 7/8. Treat that value as a sensitivity setting for comparable groups. It assumes independence and a common rate, and the within-class weighting is a modeling choice.
3. Apply the draw prior using the settings DrawNames had at drawing time. Then condition on facts learned afterward, such as confirmed pairings. A clue can rule out an assignment without changing the graph the service used. For a single subjective target q between zero and one, if the current marginal is p between zero and one, multiplying the weights of assignments containing that edge by q(1−p)/(p(1−q)) gives the target marginal. Multiple targets can conflict because they constrain the same permutations.
4. For one point per correct guess, maximize the sum of the selected posterior marginals. If each guessed recipient must be unique, solve a maximum-weight assignment. Apply any extra rules the guessing game imposes on submissions. The most probable complete permutation optimizes the probability of getting every pair right. The probability of winning against other players also depends on their entries and the tie rule.
5. Compare picks across plausible priors. In E2m the uniform baseline's optimal guess is A → B → C → A and D → E → F → D, worth 3.2 expected points. With the same within-class weighting, the recommendation switches to the six-cycle when q exceeds 1/3. For another example, given A → B in an unrestricted four-person group, uniform derangements put B → A at 1/3 and uniform single cycles put it at zero.

## Remaining questions

Uniformity within cycle categories, the exact algorithm, default reciprocal rates, and the effects of names, organizer position, insertion order, and reveal order remain open. A useful next test would replicate the family's configuration with fictional names if its exclusions, group size, or prior-year settings differ from these trials. To study an order effect, use a fresh fixed-size batch with interleaved randomized conditions, change one variable per comparison, and hold the other settings fixed. With sparse permutation counts, use exact model probabilities and simulate the Pearson statistic. Analyze configurations separately and report planned sample sizes and incomplete trials.

## Reproduce

Run from the repository root with Python 3.11 or later. Both scripts use the standard library. Setup probes validate inputs without creating a group or sending email.

~~~powershell
python -B research/drawnames_probe.py probe E1c
python -B research/drawnames_probe.py probe E2
python -B research/drawnames_probe.py probe E2m
python -B research/drawnames_probe.py probe E4
python -B research/drawnames_probe.py probe E4s
python -B research/analyze_draws.py E6
python -B research/analyze_draws.py E1c --trials research/e1c-reciprocal.jsonl
python -B research/analyze_draws.py E2 --trials research/e2-split.jsonl
python -B research/analyze_draws.py E3 --trials research/e3-pilot.jsonl
python -B research/analyze_draws.py E2m --trials research/e2m-follow-up.jsonl
python -B research/analyze_draws.py E4 --trials research/e4-follow-up.jsonl
python -B research/analyze_draws.py E4s --trials research/e4s-follow-up.jsonl
~~~

Use a fresh fictional group and an address you control for a live trial. Choose an event date appropriate to the test. The create command prompts for verification codes, uses one Gmail plus alias per guest, records the reveals, and prints a JSON trial record. It checks the organizer results when the service makes that view available. The standalone collect action expects guests who have yet to register.

~~~powershell
python -B research/drawnames_probe.py create E2m --collect
python -B research/drawnames_probe.py collect E2m
~~~

The research session also read only matching DrawNames verification mail through a read-only Gmail workflow. The raw trial records contain synthetic participants and permutations. Private links, emails, verification codes, and session credentials are excluded.

