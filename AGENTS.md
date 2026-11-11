# File Access Restrictions

- Never read, open, inspect, parse, or analyze any `.txt` files.
- Do not use terminal commands to read their contents.
- If a task references a `.txt` file, treat it as inaccessible.
- Do not include contents of `.txt` files in context.
- If a task requires information from a `.txt` file, ask me to provide the relevant information explicitly.
- These restrictions apply even when I mention a `.txt` filename in the conversation.


# Project Instructions

## Project
Single-page HTML application.

## Architecture
- index.html is the main entry point.
- CSS is stored in /css.
- JavaScript is stored in /js.
- Project documentation is stored in /docs.

## Core Rules
1. Never read the entire project unless necessary.
2. Inspect only files relevant to the current task.
3. Search for relevant IDs, classes, functions and selectors first.
4. Read only the required code sections.
5. Make minimal targeted changes.
6. Never rewrite the entire HTML document for a small change.
7. Preserve existing functionality and event handlers.
8. Do not duplicate existing CSS or JavaScript.
9. Do not modify unrelated components.
10. Verify all changes.

## File Restrictions
- Do not read or analyze restricted TXT files.
- Do not access restricted files through terminal commands.
- If restricted information is required, ask the user.

## Workflow
1. Understand the requested change.
2. Locate relevant code.
3. Inspect dependencies.
4. Make targeted modifications.
5. Verify functionality.
6. Report modified files and potential issues.

## Safety
- Never delete existing functionality without approval.
- Never perform large refactoring without approval.
- Never overwrite unrelated user changes.


# Project Continuity Rules

- Always use PROJECT_MAP.md as the architectural reference.
- Always check PROJECT_STATUS.md before starting work.
- Always check NEXT_STEPS.md to determine the next task.
- Never repeat completed implementation or analysis.
- Avoid scanning unrelated files.
- Avoid reading entire files when targeted sections are sufficient.
- Do not recreate existing documentation.
- Update project state after completing significant tasks.
- Keep documentation concise and actionable.
- Never assume an implementation is complete without verification.


# Pre-Job Verification Protocol

- Before starting any new task, verify current working state and recent modifications (check PROJECT_STATUS.md and latest summary in docs/).
- Inspect git diff or status to ensure no unverified or stray changes exist.
- Cross-reference board targets, MCU IDs, or binary presets against verified documentation before flashing or refactoring.
