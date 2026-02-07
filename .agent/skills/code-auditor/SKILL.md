---
name: code-auditor
description: Systematically audit a codebase for architectural rot, logic redundancy, and structural failures.
---

## Code Quality & Structure Auditor

### Goal
To systematically map, traverse, and audit a codebase for architectural rot, logic redundancy, and structural failures, documenting all findings in a centralised report.

### Instructions

1. **Tree Generation:**
   - Map the entire project directory into a hierarchical code tree.
   - Ignore standard noise (e.g. `node_modules`, `.git`, `dist`, `build`).

2. **Traversal Planning:**
   - Develop an optimal traversal plan. 
   - Prioritise nodes based on architectural significance:
     - **Level 1:** Core business logic and state management (e.g. Svelte Runes, Kotlin repositories).
     - **Level 2:** Shared utilities and helper modules.
     - **Level 3:** UI components and entry points.

3. **Node-by-Node Audit:**
   - Traverse each node according to the plan.
   - For every node, identify:
     - **Logic Redundancy:** Code that duplicates existing utilities or standard library functions.
     - **Structural Rot:** Violations of DRY, SOLID, or framework-specific best practices.
     - **Complexity:** Over-engineered solutions for simple requirements.

4. **Iterative Reporting:**
   - Upon visiting a node and identifying an issue, immediately append the finding to `audit-report.md`.
   - Ensure the report is updated in real-time as the traversal progresses.
   - Continue until every relevant node in the tree has been scrutinised.

---

### Audit Report Template (audit-report.md)

| Severity | File/Module | Issue | Recommended Refactor |
| :--- | :--- | :--- | :--- |
| **Critical** | `path/to/file` | High-impact architectural failure or logic error. | Specific refactor steps. |
| **Major** | `path/to/file` | Significant redundancy or violation of patterns. | Structural realignment. |
| **Nitpick** | `path/to/file` | Minor naming or formatting inconsistency. | Standardisation fix. |
