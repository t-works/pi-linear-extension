# pi-linear — Linear Integration for pi

Linear issue tracker integration for the [pi coding agent](https://pi.dev). Pull issues, work on them with full agent context, mark them as Done, and post session summaries back as Linear comments — all without leaving the terminal.

## Prerequisites

1. A [Linear](https://linear.app) account
2. A personal Linear API key — create one at https://linear.app/settings/api
3. Node.js 18+ (for built-in `fetch`)

## Install

```bash
# From npm (once published)
pi install npm:pi-linear

# From git
pi install git:github.com/YOUR_USER/pi-linear

# Local development
pi -e ./extensions/linear.ts
```

## Setup

Set your Linear API key as an environment variable:

```bash
export LINEAR_API_KEY=lin_api_your_key_here
```

> **Note on OAuth tokens:** If you're using a Linear OAuth access token instead of a personal API key, prefix it with `Bearer `:
> ```bash
> export LINEAR_API_KEY="Bearer your_oauth_token"
> ```
> Personal API keys (`lin_api_...`) do NOT need the `Bearer` prefix.

## Quick Start

1. Start pi
2. Type `/linear-issues` to browse projects → milestones → issues
3. Tell pi: "Work on LIN-42"
4. Pi reads the issue, does the work, and marks it Done

## Available Tools

| Tool | Description |
|------|-------------|
| `linear_list_projects` | List accessible Linear projects |
| `linear_list_milestones` | List milestones with issue counts |
| `linear_list_issues` | List issues (defaults to unstarted/Todo) |
| `linear_get_issue` | Full issue details with description, comments, sub-issues |
| `linear_get_my_issues` | Current user's assigned unstarted issues |
| `linear_search_issues` | Search issues by term |
| `linear_add_comment` | Post a markdown comment on an issue |
| `linear_update_issue` | Update issue state, assignee, or priority |

## Commands

| Command | Description |
|---------|-------------|
| `/linear-issues` | Interactive project → milestone → issue browser |

## Default Behavior

- **Unstarted only:** `linear_list_issues` and `linear_get_my_issues` default to filtering for issues with `state.type: "unstarted"` (the stable category for Todo/New/Backlog states). Finished/completed issues are excluded from the work queue by default.
- **PI Agent state:** `linear_update_issue` without an explicit `stateId` transitions issues to a "PI Agent" completed state. This state is created automatically per team if it doesn't exist, giving a clear visual indicator that pi completed the work.

## Example Workflow

```
User: What issues are assigned to me?
Agent calls: linear_get_my_issues
→ Shows 3 unstarted issues

User: Tell me about LIN-42
Agent calls: linear_get_issue(issueId: "LIN-42")
→ Shows full description, comments, sub-issues

User: Implement the fix described in LIN-42
Agent: [reads code, writes fix, runs tests]

Agent calls: linear_update_issue(issueId: "...")
→ LIN-42 transitions to PI Agent (Done)

Agent calls: linear_add_comment(issueId: "...", body: "...")
→ Posts summary of changes
```

## Architecture

- **Zero runtime dependencies** — uses Node.js built-in `fetch` for GraphQL calls
- **GraphQL-only** — Linear's GraphQL API is the only integration surface
- **API key from env** — reads `LINEAR_API_KEY` on every call, never cached
- **Tools-first** — all Linear operations are pi tools the agent calls autonomously
- **Composable** — other skills/extensions can build on these tools

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `LINEAR_API_KEY` not set | Clear error with setup instructions |
| Invalid API key | "Invalid Linear API key" with link to settings |
| Rate limited (429) | Error with retry-after info |
| Issue not found | "Issue <id> not found" |
| Network timeout (10s) | "Linear API request timed out" |

## License

MIT
