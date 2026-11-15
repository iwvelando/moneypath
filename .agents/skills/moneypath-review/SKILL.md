---
name: moneypath-review
description: Review a moneypath PR, branch, or local diff for approach, correctness, spec and fixture discipline, regression coverage, and repository standards, including fresh-context reviews and authorized takeovers. Use for review requests, not for ordinary implementation that merely touches this repository.
---

# moneypath review

Produce an evidence-based review of the requested change. [AGENTS.md](../../../AGENTS.md)
is the policy and [REVIEWING.md](../../../REVIEWING.md) is the procedure; read both
unless they are already in context. These links resolve from this skill's directory,
so they refer to the containing checkout.

1. **Frame it.** Establish the intended behavior, the base, the reviewed revision and
   any uncommitted scope. Determine whether the request is for findings only or also
   authorizes fixes, pushing or merging. Do not post findings externally or turn a
   review into a takeover without that authorization.
2. **Reconstruct the change from the code**, not from its description. Use the table
   in [Follow the change beyond the diff](../../../REVIEWING.md#follow-the-change-beyond-the-diff)
   to load only the checks the change calls for, and follow affected callers outside
   the diff.
3. **Check the spec discipline first** when engine or config behavior moved: chapter
   before code, fixtures in the same commit, the commit message saying so, and no
   fixture edited to make code pass. A chapter and a fixture that disagree go to the
   owner.
4. **Challenge one assumption at a time.** For each material doubt, note the contract,
   how it could fail, who consumes it, and the smallest test, mutation or reading
   that would settle it. Read assertions before running tests.
5. **Report** as [Findings and verification](../../../REVIEWING.md#findings-and-verification)
   sets out: revision and scope, prioritized findings with evidence, checks you ran
   apart from checks the author reported, and deferred work with its owner. A sound
   change gets a no-findings conclusion.
6. **For authorized fixes**, work test-first, rerun `make pre-pr` when application
   code changed after the author's run, and finish as
   [Completion](../../../REVIEWING.md#completion) describes. Merge only with explicit
   authorization and passing CI on the final head.
