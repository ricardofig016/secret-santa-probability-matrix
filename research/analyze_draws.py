import argparse
from collections import Counter
from fractions import Fraction
from itertools import permutations
import json
from math import comb, log
from pathlib import Path
import random
import string

from drawnames_probe import CASES


def cycles(assignment):
    remaining = set(range(len(assignment)))
    lengths = []
    while remaining:
        start = min(remaining)
        member = start
        length = 0
        while member in remaining:
            remaining.remove(member)
            length += 1
            member = assignment[member]
        lengths.append(length)
    return tuple(sorted(lengths, reverse=True))


def distributions(allowed):
    size = len(allowed)
    valid = [draw for draw in permutations(range(size))
             if all(recipient in allowed[giver] for giver, recipient in enumerate(draw))]
    single = [draw for draw in valid if cycles(draw) == (size,)]
    no_reciprocal = [draw for draw in valid if 2 not in cycles(draw)]
    models = {
        name: {draw: Fraction(1, len(support)) for draw in support}
        for name, support in (("derangements", valid), ("no-reciprocal", no_reciprocal),
                              ("single-cycle", single), ("single-cycle-first", single or valid))
    }
    for name, order in (("sequential-forward", list(range(size))),
                        ("sequential-reverse", list(reversed(range(size))))):
        weights = {}
        for draw in valid:
            available = set(range(size))
            probability = Fraction(1)
            for giver in order:
                probability /= len(available & allowed[giver])
                available.remove(draw[giver])
            weights[draw] = probability
        total = sum(weights.values())
        models[name] = {draw: weight / total for draw, weight in weights.items()}
    return models


def load_trials(path, case, participants, allowed):
    trials = Counter()
    ids = set()
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        record = json.loads(line)
        if record.get("case") != case:
            raise ValueError(f"Line {line_number}: expected case {case}")
        trial = record["trial"]
        pairs = record["assignments"]
        if not isinstance(trial, str) or not trial or trial in ids:
            raise ValueError(f"Line {line_number}: expected a unique, nonempty trial label")
        if set(pairs) != set(participants) or set(pairs.values()) != set(participants):
            raise ValueError(f"Line {line_number}: expected a complete one-to-one assignment")
        draw = tuple(participants.index(pairs[giver]) for giver in participants)
        if any(recipient not in allowed[giver] for giver, recipient in enumerate(draw)):
            raise ValueError(f"Line {line_number}: assignment contradicts the configured exclusions")
        trials[draw] += 1
        ids.add(trial)
    return trials


def multinomial_test(model, observed, simulations):
    total = sum(observed.values())
    choices = list(model)
    weights = [float(model[draw]) for draw in choices]
    expected = [total * weight for weight in weights]

    def statistic(counts):
        return sum((counts[draw] - mean) ** 2 / mean for draw, mean in zip(choices, expected))

    actual = statistic(observed)
    rng = random.Random(0)
    extreme = sum(statistic(Counter(rng.choices(choices, weights, k=total))) >= actual - 1e-12
                  for _ in range(simulations))
    return (extreme + 1) / (simulations + 1)


def report(name, model, participants, observed, simulations):
    print(f"\n{name}: {len(model)} supported assignments")
    if not model:
        if observed:
            print("  Every observed trial has probability zero under this model.")
        return
    signatures = Counter()
    marginals = Counter()
    for draw, weight in model.items():
        signatures[cycles(draw)] += weight
        for giver, recipient in enumerate(draw):
            marginals[giver, recipient] += weight
    print("  cycles:", ", ".join(f"{'+'.join(map(str, key))}={weight}"
                                 for key, weight in sorted(signatures.items(), reverse=True)))
    print("  giver ->", " ".join(participants))
    for giver, label in enumerate(participants):
        print(f"  {label:>7}", " ".join(str(marginals[giver, recipient]) for recipient in range(len(participants))))
    if not observed:
        return
    if observed.keys() - model.keys():
        print("  At least one trial has probability zero under this model.")
        return
    print(f"  log likelihood: {sum(count * log(model[draw]) for draw, count in observed.items()):.6f}")
    if simulations:
        print(f"  Monte Carlo Pearson p: {multinomial_test(model, observed, simulations):.6g}")


def main():
    parser = argparse.ArgumentParser(description="Compare DrawNames experiments with exact small-group models")
    parser.add_argument("case", choices=CASES)
    parser.add_argument("--trials", type=Path)
    parser.add_argument("--simulations", type=int, default=0)
    args = parser.parse_args()
    if args.simulations < 0:
        parser.error("--simulations must be nonnegative")
    size, exclusions = CASES[args.case]
    participants = list(string.ascii_uppercase[:size])
    allowed = [{index for index, target in enumerate(participants)
                if target != giver and target not in exclusions.get(giver, "")} for giver in participants]
    try:
        observed = load_trials(args.trials, args.case, participants, allowed) if args.trials else Counter()
    except (OSError, ValueError, TypeError, KeyError) as error:
        parser.error(str(error))
    models = distributions(allowed)
    print(f"{args.case}: {sum(observed.values())} observed complete draws")
    for model_name, model in models.items():
        report(model_name, model, participants, observed, args.simulations)
    if observed:
        total = sum(observed.values())
        signatures = Counter()
        for draw, count in observed.items():
            signatures[cycles(draw)] += count
        print("\nObserved cycles:", dict(signatures))
        single_count = signatures[len(participants),]
        for reference in ("derangements", "no-reciprocal"):
            model = models[reference]
            if not model:
                continue
            probability = sum(weight for draw, weight in model.items() if len(cycles(draw)) == 1)
            tail = sum(comb(total, k) * probability ** k * (1 - probability) ** (total - k)
                       for k in range(single_count, total + 1))
            print(f"single cycle: {single_count}/{total}, {reference} upper tail {float(tail):.6g}")
        if single_count == 0:
            print(f"  95% one-sided upper bound on single-cycle rate: {1 - .05 ** (1 / total):.6g}")
        if single_count == total:
            print(f"  95% one-sided lower bound on single-cycle rate: {.05 ** (1 / total):.6g}")
        events = {"reciprocal draw": lambda draw: 2 in cycles(draw),
                  "multiple cycles": lambda draw: len(cycles(draw)) > 1}
        for event, occurs in events.items():
            count = sum(count for draw, count in observed.items() if occurs(draw))
            probability = sum(weight for draw, weight in models["derangements"].items() if occurs(draw))
            tail = sum(comb(total, k) * probability ** k * (1 - probability) ** (total - k)
                       for k in range(count + 1))
            print(f"{event}: {count}/{total}, uniform derangement lower tail {float(tail):.6g}")
            if count == 0:
                print(f"  95% one-sided upper bound on event rate: {1 - .05 ** (1 / total):.6g}")


if __name__ == "__main__":
    main()
