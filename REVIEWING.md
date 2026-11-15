# Reviewing changes

Use this for a PR, a branch or a local diff, including a review started in a fresh
context. [AGENTS.md](AGENTS.md) is the policy and [DEVELOPMENT.md](DEVELOPMENT.md)
holds the build, test and delivery procedures. The
[moneypath-review skill](.agents/skills/moneypath-review/SKILL.md) is an entry point
for an agent; the procedure is the same without it.

## Establish the review

Record the base, the merge base and the head reviewed, or the base and the uncommitted
scope for a local diff. Settle whether this is review only or an authorized takeover
that includes fixes. A review request does not by itself authorize posting comments,
pushing, merging or deploying. Preserve the author's work; run experiments in a
scratch copy.

Read what the change is meant to do, then reconstruct what it does from the code. The
author's description, reported checks and test names are claims to verify. Keep what
you reproduced apart from what was reported.

A takeover after an implementer's handoff includes the PR's CI: the implementer opens
the PR without waiting for it, so its first results are the reviewer's to read. Before
rerunning a failure the change did not cause, record it in its issue (DEVELOPMENT.md,
"Recording failures and bugs").

## Follow the change beyond the diff

Trace changed values through their callers, including ones outside the diff and ones
that landed on `main` since the branch was cut. Load guidance by what the change
touches:

| Change or risk | Check |
|---|---|
| Config format, engine semantics, the normative parts of the architecture chapter | The chapter was edited first, the fixtures that pin the new numbers are in the same commit, and the commit message says specified behavior changed. No fixture was edited to make failing code pass. |
| A new or changed number in a fixture | Derive it independently, by hand or a throwaway calculation, not by running the engine and pasting the output. |
| A comparison that decides behavior (a payoff, a floor, a threshold) | Both sides are rounded to cents first. Test just below, at and just above the boundary. |
| Anything under `engine/` | Still pure: no I/O, no clock read, no logging. "Now" arrives as an argument. |
| CSV or results output | Native and WASM stay byte-identical (`TestCLIWASMParity`), which needs a real `make dist` build, not the placeholder. |
| A field added to the web editor model | An old saved draft, which lacks the key, restores with the field blank; the sparse-draft tests reach it. `make typecheck` passes. |
| Any text a user can read | No spec paths, chapter numbers, fixture names or Go identifiers; no notation to decode. |
| Controls, focus, touch, layout | Nothing scrolls sideways at 360 px. WebKit behavior is in `web/e2e/webkit.spec.ts`. Phone-only checks are listed as pending, not passed. |
| A new kind of resource (worker, font, `data:` image, fetch) | `deploy/content-security-policy.txt` changed, and the matching cloud-accounts change lands first. |
| The legacy migration | The v1 format chapter is frozen; only an error in it is corrected. |
| A new runtime dependency | Its license reaches `web/dist/` (`make notices`, `check-dist.mjs`). Dependabot merges later updates unreviewed, so the tests must cover what the dependency does. |
| A `@smoke` test | Fast and read-only: it runs against the live site. |

## Challenge the approach

Name the assumption most likely to be wrong and pick the smallest experiment that
could disprove it. For money math, that is usually a boundary month, a zero or
negative balance, a rate of zero, a loan that ends mid-scenario, or two events landing
in the same month. For editor state, it is a sequence: edit, reload, upload over a
draft, switch scenario.

Read the assertions before running the tests. Confirm the fixture or test reaches the
condition its name claims and goes through the production entry point. A passing
comparison of two empty results proves nothing, and a full suite adds breadth over the
assertions that exist; it supplies none that are missing.

Where an assertion looks too easy to pass, mutate the code in a scratch copy: flip a
comparison, drop a rounding, skip a cap, swap the order of two steps in a month. A
mutation that still passes every test is either equivalent, inside an allowed margin,
or a coverage gap; say which. Discard the scratch copy afterward and add no mutation
tooling to the repository.

A spec chapter and a fixture that disagree are not the reviewer's to reconcile
silently. Flag it to the owner.

## Findings and verification

Classify each observation: demonstrated bug, coverage gap, spec or documentation
inconsistency, defensive improvement, optional cleanup. For a bug, give the triggering
config or sequence, the expected and actual result, the location and the evidence. A
coverage gap is not automatically a bug. Rank by what a user would lose, not by the
size of the fix.

If fixes are authorized, reproduce the failure with a test before changing code, then
recheck the affected callers. If the task is review only, leave the submitted change
as it is and report. A sound change may need no edits; there is no quota of findings.

The report states:

- the revision and scope reviewed;
- findings in priority order, with locations and evidence, optional cleanup apart;
- the checks you ran yourself, and the author's reported checks named as such;
- open questions, deferred checks and who owns them.

A fix that changes application code after the author's `make pre-pr` needs that run
again on the final head. A review verdict and completed verification are separate
statements; make both.

## Completion

For a takeover, update the PR description before handing it back: replace stale
"still to run" notes with what actually happened, name the reviewed and tested
revisions, and keep unfinished checks and their owner explicit. A green CI run does
not show that a local command ran.

Merge only when the takeover authorizes it, material findings are resolved, required
verification is complete and CI passes on the final head. Then follow the `main` run
through its deploy and the live `@smoke` tests, and report a failed deploy rather than
retrying it another way.

Stop when the material questions are resolved or plainly qualified and the handoff is
accurate. Further experiments need a concrete unresolved risk.
