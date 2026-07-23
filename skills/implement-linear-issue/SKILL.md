---
name: implement-linear-issue
description: >
  Full workflow for implementing a Linear issue end-to-end. Use when the user asks to "work on an issue", "implement a Linear ticket", "fix LIN-...", or "do the Linear flow". Trigger terms: implement issue, work on ticket, fix linear issue, linear workflow.
---

# Implement Linear Issue — Full Workflow

Follow this workflow exactly when the user asks to implement a Linear issue.

## Step 1: Discover the issue

If the user hasn't specified an issue identifier, ask them to run `/linear-issues` to browse, or call `linear_get_my_issues` to list assigned unstarted issues. Let the user pick.

## Step 2: Read the issue

Call `linear_get_issue` with the issue identifier (e.g. `LIN-42`) to get:
- Full description
- Comments and context
- Sub-issues and parent relationships
- Current state and priority

Read the issue description thoroughly before writing any code.

## Step 3: Implement the fix

Write the necessary code changes. Follow these rules:
- Read existing files before editing
- Make targeted, minimal changes
- Run tests or type-check if the project has them
- Keep changes focused on the issue scope only

## Step 4: Commit

Commit the changes with a descriptive message that references the issue identifier:
```
git add <files>
git commit -m "fix: <description> (LIN-42)"
```

## Step 5: Mark as Done

Call `linear_update_issue` with just the issueId (UUID) to transition it to the "PI Agent" completed state. Do this **before** posting the summary comment.

## Step 6: Post Summary

Call `linear_add_comment` with a markdown summary including:
- What was changed and why
- Key decisions made
- Files modified
- Any follow-up notes

## One-shot example prompt

User can trigger the full flow with:
"Implement TWO-6" or "Work on the issue from my list" or "Run the Linear workflow"
