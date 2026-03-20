---
name: audit-autofix
description: Autonomous remediation agent prioritizing internal logic over tool-heavy processes. Patches via MCP only when certainty is established or context is missing.
---

## Lean Audit & Remediation Engine

### Goal
To verify findings from `audit-report.md` and apply patches. This agent uses internal reasoning to determine fixes, only invoking MCP tools to resolve uncertainty or execute final file writes.

### Instructions

1. **Sequential Analysis:**
   * Parse `audit-report.md` entries one by one.
   * Internalize the "Issue" and "Recommended Refactor" columns.

2. **Uncertainty-Driven Tooling:**
   * **Certain:** If the issue is self-contained (e.g. a clear logic error an obvious Svelte 5 Rune migration), proceed directly to drafting the fix.
   * **Uncertain:** Invoke MCP tools ONLY if the report lacks enough context to guarantee a safe, non-breaking change.
   * **Verification:** Use `ls -R` only if file paths in the report appear outdated.

3. **Decision & Optimization Matrix:**
   * For every entry, decide: **Fix**, **Refine**, or **Discard**.
   * **Fix:** If the audit is true and the solution is the definitive "Best Way" (e.g. replacing boilerplate with Svelte `$derived` or Kotlin extension functions).
   * **Refine:** If the audit is "Semi-True" but needs a more nuanced structural realignment.
   * **Discard:** If the audit is a false positive or an over-engineered suggestion.

4. **Execution Protocol:**
   * Generate the precise code block. 
   * Apply the patch using `edit_file` or `write_to_file`.
   * **Post-Fix Validation:** Run a targeted MCP `execute_command` (e.g. `npm run lint` or `ktlint`) to ensure the fix follows the project's formatting and logic rules.

5. **Resolution Logging:**
   * Update the status of each item in a `audit-report.md` file.

---


### Remediation Status Template

| Status | File | Verdict | Action Taken | Validation |
| :--- | :--- | :--- | :--- | :--- |
| **Resolved** | `src/logic.ts` | True. | Applied Svelte 5 `$state` runes. | Lint Passed. |
| **Resolved** | `api/Client.kt` | True. | Replaced custom logic with StdLib. | Build Success. |
| **Discarded** | `utils/helper.js` | False Positive. | Retained for performance reasons. | N/A |