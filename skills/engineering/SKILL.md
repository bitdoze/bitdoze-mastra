---
name: engineering
description: Run the standard dev workflow lint, type-check, test, build. Fix errors in order and repeat until clean.
version: 1.0.0
tags:
  - testing
  - build
  - ci
---

# Engineering Skill

## When to use

Use this skill when asked to write, test, lint, or build code. It covers the
standard development workflow: lint, type-check, test, build, fix, repeat.

## Workflow

1. **Lint** — run the project's linter and fix all errors.
2. **Type-check** — run the TypeScript compiler in check mode.
3. **Test** — run the test suite and fix failures.
4. **Build** — run the production build and resolve any errors.
5. **Repeat** until all steps pass cleanly.

## Commands (Bun project)

```sh
# Lint (if configured)
bun run lint

# Type-check
bunx tsc --noEmit

# Tests
bun test

# Build
bun run build
```

## Guidelines

- Always run lint before type-check, and type-check before build.
- Fix errors in order: lint errors first, then type errors, then test failures.
- Do not skip steps. If a step fails, fix it and re-run from the top.
- Keep commits focused — one logical change per commit.
