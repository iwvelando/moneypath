---
name: Roadmap feature
about: Define an accepted roadmap feature and its delivery boundaries
title: "[Rxx] Feature name"
labels: "roadmap, kind:feature, stage:needs-design"
---

## Intent

<!-- Link the feature's entry in ROADMAP.md. Describe the decision the user can make,
     or the question they can answer, once this exists. -->

## Scope and boundaries

<!-- What is new versus existing behavior? What is included and excluded? -->

## Feature acceptance

<!-- Observable outcomes: what the CLI and the web app show, which figures are pinned by
     fixtures, and what happens to plans and saved drafts that predate the feature. -->

## Dependencies and delivery

<!-- Set the milestone and native relationships. Describe the capability actually consumed
     from each prerequisite. Add implementation sub-issues when ready; do not repeat their
     progress in prose. -->

## Starting context and open design questions

<!-- Focused code and spec references and the revision checked. Separate settled decisions
     from open choices. Name the spec chapters the feature changes and their status. -->

## Delivery procedure

Follow `AGENTS.md` and `DEVELOPMENT.md`, "Roadmap assignments". This parent defines
acceptance; implementation assignments belong in its sub-issues. Specified behavior
lives in `spec/` and verification in PRs. Required scope is not dropped because the
existing children are closed.
