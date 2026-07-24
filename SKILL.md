---
name: linear-integration
description: >
  Linear issue tracker integration. Pull issues, work on them, mark as Done, and post session summaries. Use when working with Linear issues, tickets, or LIN- identifiers. Trigger terms: Linear, issue, ticket, LIN-, milestone.
---

# Linear Integration Skill

## Tools Available

| Tool | Purpose |
|------|---------|
| `linear_list_projects` | List accessible Linear projects |
| `linear_list_milestones` | List milestones with issue counts |
| `linear_list_issues` | List issues (default: unstarted/Todo) |
| `linear_get_issue` | Full issue details with description, comments, sub-issues |
| `linear_get_my_issues` | Current user's assigned unstarted issues |
| `linear_search_issues` | Search issues by term |
| `linear_add_comment` | Post a markdown comment |
| `linear_update_issue` | Mark issue as Done (PI Agent state) or reassign |
| `linear_create_issue` | Create a new issue, optionally as a child or in a specific project/milestone |

The `/linear-issues` command opens an interactive project → milestone → issue browser.

## Creating Issues

Use `linear_create_issue` to create new issues from the command line or as part of a workflow:
- If a project is cached (from `/linear-issues`), it's used as the default project.
- Issues can be standalone (sibling) or children of existing issues (via `parentId`).
- Team is auto-detected: from the cached project, or from the viewer's teams if there's only one.

---

## Default Workflow

1. **Discover work:** Call `linear_get_my_issues` to see what's assigned to you, or `linear_list_issues` to browse by milestone.
2. **Read the issue:** Call `linear_get_issue` with the issue identifier (e.g. `LIN-42`) to get the full description, comments, and context.
3. **Do the work:** Implement the fix or feature described in the issue.
4. **Mark as Done:** Call `linear_update_issue` with the issue's UUID to transition it to the "PI Agent" completed state.
5. **Post summary:** Call `linear_add_comment` with a summary of what was done, key changes, and decisions made.

## Important Notes

- Issues default to `state.type` in `["unstarted", "backlog"]` — the stable filter for Todo/New and Backlog across all teams.
- `linear_update_issue` without an explicit `stateId` automatically transitions to a "PI Agent" completed state.
- Issue IDs for mutations must be UUIDs (use the `id` field from `linear_list_issues` or `linear_get_issue`).
- Issue identifiers like `LIN-42` can be used with `linear_get_issue` for lookups.
- The `LINEAR_API_KEY` environment variable must be set.

## Best Practices

- Always read the full issue description before starting work.
- Check for sub-issues and parent relationships.
- Review recent comments for context and decisions.
- Mark issue as Done immediately after completing work, before posting the summary.
- Keep summaries concise but include what changed and why.
