# DEVELOPMENT WORKFLOW & BRANCH GOVERNANCE

This document establishes the permanent software delivery lifecycle and branch governance for `business-os`.

---

## 1. The Core Lifecycle

All code changes must follow this strict sequential lifecycle:

```
1. Task Assignment   ──> Define clear scope, acceptance criteria, and risks.
2. Feature Branch    ──> Create a dedicated branch: `git checkout -b feat/xyz` or `fix/xyz`.
3. Implementation    ──> Write typed, modular code adhering to `AGENTS.md`.
4. Local Tests       ──> Run `pnpm run test`, `pnpm run typecheck`, and `pnpm run format:check`.
5. Pull Request      ──> Open a Pull Request targeting `main`.
6. Automated CI      ──> GitHub Actions runs lint, build, typecheck, and full test suite.
7. Human Review      ──> Human owner inspects changes and approves.
8. Merge             ──> Squash & merge to `main`.
```

---

## 2. GitHub Branch Protection Settings (Recommended)

To preserve architectural integrity and prevent inadvertent breaking changes on `main`, the repository owner should configure the following settings in GitHub:

1. Navigate to **Repository Settings** ➔ **Branches** ➔ **Branch protection rules** ➔ **Add rule**.
2. Set **Branch name pattern** to `main`.
3. Check **Require a pull request before merging**:
   - Require approvals: `1` (or self-review).
   - Dismiss stale pull request approvals when new commits are pushed.
4. Check **Require status checks to pass before merging**:
   - Check **Require branches to be up to date before merging**.
   - Status checks to require: `Lint, Typecheck, Build & Test`.
5. Check **Do not allow bypassing the above settings**.

---

## 3. Commit Message Standard

All commits must follow Conventional Commits:

- `feat(scope): ...` — New capability or module.
- `fix(scope): ...` — Bug fix or error resolution.
- `refactor(scope): ...` — Code reorganization without functional change.
- `test(scope): ...` — New or improved test suites.
- `docs(scope): ...` — Documentation updates.
- `chore(scope): ...` — Maintenance, dependencies, or configuration.
