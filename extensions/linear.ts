/**
 * Linear Integration extension for pi.
 *
 * Registers tools for Linear issue management and an interactive
 * `/linear-issues` command for browsing projects → milestones → issues.
 *
 * Tools:
 *   linear_list_projects    — List accessible projects
 *   linear_list_milestones  — List milestones with issue counts
 *   linear_list_issues      — List issues (defaults to unstarted)
 *   linear_get_issue        — Full issue details with comments
 *   linear_get_my_issues    — Current user's assigned unstarted issues
 *   linear_search_issues    — Search issues by text
 *   linear_add_comment      — Post a markdown comment
 *   linear_update_issue     — Update issue (primary use: → PI Agent completed state)
 *
 * Command:
 *   /linear-issues          — Interactive project → milestone → issue browser
 *
 * Default filter: state.type "unstarted" (the stable category for Todo/New/Backlog).
 * Completed/canceled issues are excluded from the work queue by default.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { graphqlRequest, sanitizeText } from "./linear-client";

// ─── Types ───────────────────────────────────────────────────────────────────

interface LinearTeam {
  id: string;
  name: string;
  key: string;
  workflowStates?: { nodes: LinearWorkflowState[] };
}

interface LinearWorkflowState {
  id: string;
  name: string;
  type: string;
}

interface LinearProject {
  id: string;
  name: string;
  description?: string;
}

interface LinearMilestone {
  id: string;
  name: string;
  description?: string;
  progress: number;
  targetDate?: string;
  issueCounts?: MilestoneIssueCounts;
}

interface MilestoneIssueCounts {
  total: number;
  byState: Record<string, number>;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: { id: string; name: string; type: string };
  priority: number;
  priorityLabel: string;
  assignee?: { id: string; name: string };
  projectMilestone?: { id: string; name: string };
  team: { id: string; name: string; key: string };
  url: string;
  createdAt: string;
  updatedAt: string;
  parent?: { id: string; identifier: string; title: string };
  children?: { nodes: Array<{ id: string; identifier: string; title: string; state: { name: string; type: string } }> };
  comments?: { nodes: LinearComment[] };
}

interface LinearComment {
  id: string;
  body: string;
  user?: { name: string };
  createdAt: string;
}

interface LinearViewer {
  id: string;
  name: string;
  assignedIssues: { nodes: LinearIssue[] };
}

// ─── GraphQL Fragments ──────────────────────────────────────────────────────

const ISSUE_FIELDS = `
  id identifier title description
  state { id name type }
  priority priorityLabel
  assignee { id name }
  projectMilestone { id name }
  team { id name key }
  url createdAt updatedAt
  parent { id identifier title }
`;

// ─── Formatting Helpers ─────────────────────────────────────────────────────

function formatIssueLine(issue: LinearIssue, index: number): string {
  const title = sanitizeText(issue.title);
  const state = issue.state?.name ?? "Unknown";
  const priority = issue.priorityLabel;
  const assignee = issue.assignee?.name;
  const parts = [`${index + 1}. ${issue.identifier} — ${title}`];
  parts.push(`[${state}]`);
  if (priority && priority !== "No priority") parts.push(`(priority: ${priority})`);
  if (assignee) parts.push(`(assignee: ${assignee})`);
  return parts.join(" ");
}

function formatIssueDetail(issue: LinearIssue): string {
  const lines: string[] = [];
  lines.push(`# ${issue.identifier} — ${sanitizeText(issue.title)}`);
  lines.push("");
  lines.push(`**ID:** ${issue.id}`);
  lines.push(`**URL:** ${issue.url}`);
  lines.push(`**State:** ${issue.state?.name ?? "Unknown"} (type: ${issue.state?.type ?? "unknown"})`);
  lines.push(`**Priority:** ${issue.priorityLabel} (${issue.priority})`);
  if (issue.assignee) lines.push(`**Assignee:** ${issue.assignee.name}`);
  if (issue.projectMilestone) lines.push(`**Milestone:** ${issue.projectMilestone.name}`);
  lines.push(`**Team:** ${issue.team?.name ?? "Unknown"} (${issue.team?.key ?? ""})`);
  lines.push(`**Created:** ${issue.createdAt}`);
  lines.push(`**Updated:** ${issue.updatedAt}`);
  if (issue.parent) lines.push(`**Parent:** ${issue.parent.identifier} — ${issue.parent.title}`);

  if (issue.description) {
    lines.push("");
    lines.push("## Description");
    lines.push("");
    lines.push(sanitizeText(issue.description));
  }

  if (issue.children?.nodes?.length) {
    lines.push("");
    lines.push("## Sub-issues");
    for (const child of issue.children.nodes) {
      lines.push(`- ${child.identifier} — ${sanitizeText(child.title)} [${child.state.name}]`);
    }
  }

  if (issue.comments?.nodes?.length) {
    lines.push("");
    lines.push("## Recent Comments");
    for (const comment of issue.comments.nodes) {
      const author = comment.user?.name ?? "Unknown";
      const body = sanitizeText(comment.body).slice(0, 500);
      lines.push(`**${author}** (${comment.createdAt}):`);
      lines.push(`${body}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ─── PI Agent State Management ──────────────────────────────────────────────

/** teamId → completed state ID */
const piAgentStateCache = new Map<string, string>();

async function ensurePiAgentStates(): Promise<void> {
  if (piAgentStateCache.size > 0) return; // already initialized

  // Fetch all teams first, then query workflow states per team
  const teamsData = await graphqlRequest<{
    teams: { nodes: Array<{ id: string; name: string; key: string }> };
  }>(`
    query {
      teams(first: 50) {
        nodes { id name key }
      }
    }
  `);

  for (const team of teamsData.teams.nodes) {
    // Query workflow states for this team
    const statesData = await graphqlRequest<{
      workflowStates: { nodes: LinearWorkflowState[] };
    }>(`
      query($teamId: String!) {
        workflowStates(filter: { team: { id: { eq: $teamId } } }) {
          nodes { id name type }
        }
      }
    `, { teamId: team.id });

    const states = statesData.workflowStates.nodes;
    const existing = states.find(
      (s) => s.name === "PI Agent" && s.type === "completed",
    );
    if (existing) {
      piAgentStateCache.set(team.id, existing.id);
    } else {
      // Create the PI Agent completed state
      try {
        const result = await graphqlRequest<{
          workflowStateCreate: { success: boolean; workflowState: { id: string; name: string; type: string } };
        }>(`
          mutation($input: WorkflowStateCreateInput!) {
            workflowStateCreate(input: $input) {
              success
              workflowState { id name type }
            }
          }
        `, {
          input: {
            teamId: team.id,
            type: "completed",
            name: "PI Agent",
            color: "#5E6AD2",
          },
        });
        if (result.workflowStateCreate.success) {
          piAgentStateCache.set(team.id, result.workflowStateCreate.workflowState.id);
        }
      } catch {
        // State creation failed — update_issue will need explicit stateId
      }
    }
  }
}

async function getCompletedStateId(teamId: string): Promise<string | undefined> {
  await ensurePiAgentStates();
  return piAgentStateCache.get(teamId);
}

// ─── Extension Entry ────────────────────────────────────────────────────────

export default function linearExtension(pi: ExtensionAPI) {
  // ── Session-scoped cache ─────────────────────────────────────────────────
  let cachedProjectId: string | undefined;

  pi.on("session_start", async () => {
    cachedProjectId = undefined;
    piAgentStateCache.clear();
    // Pre-warm PI Agent states (non-blocking)
    ensurePiAgentStates().catch(() => {
      // Non-fatal — states will be created on first update_issue call
    });
  });

  // ── Tool: linear_list_projects ──────────────────────────────────────────

  pi.registerTool({
    name: "linear_list_projects",
    label: "Linear: List Projects",
    description:
      "List all accessible Linear projects. Use this to discover project IDs for filtering milestones and issues.",
    promptSnippet: "List accessible Linear projects",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
      try {
        const data = await graphqlRequest<{
          projects: { nodes: LinearProject[] };
        }>(`
          query {
            projects(first: 50) {
              nodes { id name description }
            }
          }
        `);

        if (!data.projects.nodes.length) {
          return {
            content: [{ type: "text", text: "No projects found." }],
            details: { projects: [], count: 0 },
          };
        }

        const lines = data.projects.nodes.map(
          (p, i) => `${i + 1}. ${sanitizeText(p.name)} (id: ${p.id})${p.description ? ` — ${sanitizeText(p.description).slice(0, 100)}` : ""}`,
        );

        return {
          content: [
            {
              type: "text",
              text: `Found ${data.projects.nodes.length} projects:\n\n${lines.join("\n")}`,
            },
          ],
          details: { projects: data.projects.nodes, count: data.projects.nodes.length },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          details: { error: true },
          isError: true,
        };
      }
    },
  });

  // ── Tool: linear_list_milestones ────────────────────────────────────────

  pi.registerTool({
    name: "linear_list_milestones",
    label: "Linear: List Milestones",
    description:
      "List milestones with issue counts for a project. Shows only started/planned milestones. Used by the /linear-issues command and callable directly by the agent.",
    promptSnippet: "List Linear milestones with issue counts, optionally filtered by projectId",
    parameters: Type.Object({
      projectId: Type.Optional(
        Type.String({ description: "Project ID to filter milestones. If omitted, uses cached project from /linear-issues or returns all." }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      try {
        const projectId = params.projectId || cachedProjectId;

        const data = await graphqlRequest<{
          projectMilestones: {
            nodes: Array<{
              id: string;
              name: string;
              description?: string;
              progress: number;
              targetDate?: string;
              issues: { nodes: Array<{ id: string; state: { name: string; type: string } }> };
            }>;
          };
        }>(`
          query($filter: ProjectMilestoneFilter) {
            projectMilestones(
              filter: $filter
              includeArchived: false
              first: 50
            ) {
              nodes {
                id name description progress targetDate
                issues(filter: { state: { type: { nin: ["completed", "canceled"] } } }) {
                  nodes { id state { name type } }
                }
              }
            }
          }
        `, {
          filter: projectId
            ? { project: { id: { eq: projectId } } }
            : {},
        });

        const milestones = data.projectMilestones.nodes.map((m) => {
          const byState: Record<string, number> = {};
          for (const issue of m.issues.nodes) {
            const name = issue.state.name;
            byState[name] = (byState[name] || 0) + 1;
          }
          return {
            id: m.id,
            name: m.name,
            description: m.description,
            progress: m.progress,
            targetDate: m.targetDate,
            issueCounts: {
              total: m.issues.nodes.length,
              byState,
            },
          };
        });

        if (!milestones.length) {
          return {
            content: [{ type: "text", text: "No milestones found." }],
            details: { milestones: [], count: 0 },
          };
        }

        const lines = milestones.map((m, i) => {
          const counts = Object.entries(m.issueCounts.byState)
            .map(([state, count]) => `${count} ${state.toLowerCase()}`)
            .join(", ");
          return `${i + 1}. ${sanitizeText(m.name)} — ${m.issueCounts.total} open${counts ? ` (${counts})` : ""}`;
        });

        return {
          content: [
            {
              type: "text",
              text: `Found ${milestones.length} milestones:\n\n${lines.join("\n")}`,
            },
          ],
          details: { milestones, count: milestones.length },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          details: { error: true },
          isError: true,
        };
      }
    },
  });

  // ── Tool: linear_list_issues ────────────────────────────────────────────

  pi.registerTool({
    name: "linear_list_issues",
    label: "Linear: List Issues",
    description:
      "List Linear issues. Defaults to unstarted issues (Todo/Backlog). Filter by milestone, team, assignee, or status. Use this to find issues to work on.",
    promptSnippet: "List Linear issues (defaults to unstarted), optionally filtered by milestoneId, teamId, assigneeId, status, search, limit",
    promptGuidelines: [
      "Use linear_list_issues to find unstarted issues to work on. Default filter returns only Todo/Backlog items.",
      "After completing work on an issue, call linear_update_issue to mark it as Done, then linear_add_comment to post a summary.",
    ],
    parameters: Type.Object({
      milestoneId: Type.Optional(Type.String({ description: "Filter by milestone ID" })),
      teamId: Type.Optional(Type.String({ description: "Filter by team ID" })),
      assigneeId: Type.Optional(Type.String({ description: "Filter by assignee ID" })),
      status: Type.Optional(
        Type.Array(Type.String(), { description: 'Override the default "unstarted" filter with specific state names, e.g. ["In Progress", "Todo"]' }),
      ),
      limit: Type.Optional(Type.Number({ description: "Max issues to return (default: 50)", default: 50 })),
      search: Type.Optional(Type.String({ description: "Search term to filter issues by title/description" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      try {
        const first = params.limit ?? 50;
        const filter: Record<string, unknown> = {};

        // Default: unstarted only, unless status is explicitly provided
        if (params.status && params.status.length > 0) {
          filter.state = { name: { in: params.status } };
        } else {
          filter.state = { type: { eq: "unstarted" } };
        }

        if (params.milestoneId) filter.projectMilestone = { id: { eq: params.milestoneId } };
        if (params.teamId) filter.team = { id: { eq: params.teamId } };
        if (params.assigneeId) filter.assignee = { id: { eq: params.assigneeId } };
        if (params.search) {
          // When searching, we still include additional filters via AND
          // We build a compound filter
        }

        // Build filter with and/or for search
        let queryFilter: Record<string, unknown>;
        if (params.search) {
          queryFilter = {
            and: [
              filter,
              { or: [
                { title: { contains: params.search } },
                { description: { contains: params.search } },
              ] },
            ],
          };
        } else {
          queryFilter = filter;
        }

        const data = await graphqlRequest<{
          issues: { nodes: LinearIssue[] };
        }>(`
          query($filter: IssueFilter, $first: Int) {
            issues(filter: $filter, first: $first) {
              nodes {
                ${ISSUE_FIELDS}
              }
            }
          }
        `, { filter: queryFilter, first });

        const issues = data.issues.nodes;

        if (!issues.length) {
          return {
            content: [{ type: "text", text: "No issues found matching the filter." }],
            details: { issues: [], count: 0 },
          };
        }

        const lines = issues.map((issue, i) => formatIssueLine(issue, i));

        return {
          content: [
            {
              type: "text",
              text: `Found ${issues.length} issues:\n\n${lines.join("\n")}`,
            },
          ],
          details: { issues, count: issues.length },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          details: { error: true },
          isError: true,
        };
      }
    },
  });

  // ── Tool: linear_get_issue ──────────────────────────────────────────────

  pi.registerTool({
    name: "linear_get_issue",
    label: "Linear: Get Issue",
    description:
      "Get full details of a Linear issue by ID or identifier (e.g. 'LIN-42'). Includes description, comments, sub-issues, and parent issue.",
    promptSnippet: "Get full details of a Linear issue by ID or identifier like LIN-42",
    parameters: Type.Object({
      issueId: Type.String({ description: "Issue identifier (e.g. 'LIN-42') or UUID" }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      try {
        const issueId = params.issueId.trim();

        // Linear's issue(id:) accepts both identifiers ("LIN-42") and UUIDs
        const data = await graphqlRequest<{
          issue: LinearIssue;
        }>(`
          query($id: String!) {
            issue(id: $id) {
              ${ISSUE_FIELDS}
              children { nodes { id identifier title state { name type } } }
              comments(first: 20) {
                nodes { id body user { name } createdAt }
              }
            }
          }
        `, { id: issueId });

        const issue = data.issue;

        if (!issue) {
          return {
            content: [{ type: "text", text: `Issue "${issueId}" not found.` }],
            details: { error: true },
            isError: true,
          };
        }

        const detailText = formatIssueDetail(issue);

        return {
          content: [{ type: "text", text: detailText }],
          details: { issue },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          details: { error: true },
          isError: true,
        };
      }
    },
  });

  // ── Tool: linear_get_my_issues ──────────────────────────────────────────

  pi.registerTool({
    name: "linear_get_my_issues",
    label: "Linear: My Issues",
    description:
      "Get issues assigned to the current user. Defaults to unstarted issues (Todo/Backlog). Convenience tool — no need to know your user ID.",
    promptSnippet: "Get current user's assigned Linear issues (defaults to unstarted)",
    parameters: Type.Object({
      status: Type.Optional(
        Type.Array(Type.String(), { description: 'Override default unstarted filter, e.g. ["In Progress"]' }),
      ),
      limit: Type.Optional(Type.Number({ description: "Max issues to return (default: 20)", default: 20 })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      try {
        const first = params.limit ?? 20;
        const filter: Record<string, unknown> = {};

        if (params.status && params.status.length > 0) {
          filter.state = { name: { in: params.status } };
        } else {
          filter.state = { type: { eq: "unstarted" } };
        }

        const data = await graphqlRequest<{
          viewer: LinearViewer;
        }>(`
          query($filter: IssueFilter, $first: Int) {
            viewer {
              id name
              assignedIssues(filter: $filter, first: $first) {
                nodes {
                  id identifier title
                  state { name type }
                  priority priorityLabel
                  projectMilestone { id name }
                  team { id name key }
                  url
                }
              }
            }
          }
        `, { filter, first });

        const issues = data.viewer.assignedIssues.nodes;

        if (!issues.length) {
          const scope = params.status?.length ? "matching" : "unstarted";
          return {
            content: [{ type: "text", text: `No ${scope} issues assigned to you.` }],
            details: { issues: [], count: 0 },
          };
        }

        const lines = issues.map((issue, i) => formatIssueLine(issue, i));

        return {
          content: [
            {
              type: "text",
              text: `You have ${issues.length} assigned issues:\n\n${lines.join("\n")}`,
            },
          ],
          details: { issues, count: issues.length },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          details: { error: true },
          isError: true,
        };
      }
    },
  });

  // ── Tool: linear_search_issues ──────────────────────────────────────────

  pi.registerTool({
    name: "linear_search_issues",
    label: "Linear: Search Issues",
    description: "Search Linear issues by term across all states. Returns matching issues with their URL and state.",
    promptSnippet: "Search Linear issues by term",
    parameters: Type.Object({
      term: Type.String({ description: "Search term to find issues" }),
      limit: Type.Optional(Type.Number({ description: "Max results (default: 20)", default: 20 })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      try {
        const first = params.limit ?? 20;

        const data = await graphqlRequest<{
          searchIssues: { nodes: LinearIssue[] };
        }>(`
          query($term: String!, $first: Int) {
            searchIssues(term: $term, first: $first) {
              nodes {
                id identifier title
                state { name type }
                priority priorityLabel
                assignee { name }
                team { id name key }
                url
              }
            }
          }
        `, { term: params.term, first });

        const issues = data.searchIssues.nodes;

        if (!issues.length) {
          return {
            content: [{ type: "text", text: `No issues found for "${params.term}".` }],
            details: { issues: [], count: 0 },
          };
        }

        const lines = issues.map((issue, i) => formatIssueLine(issue, i));

        return {
          content: [
            {
              type: "text",
              text: `Found ${issues.length} issues for "${params.term}":\n\n${lines.join("\n")}`,
            },
          ],
          details: { issues, count: issues.length },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          details: { error: true },
          isError: true,
        };
      }
    },
  });

  // ── Tool: linear_add_comment ────────────────────────────────────────────

  pi.registerTool({
    name: "linear_add_comment",
    label: "Linear: Add Comment",
    description:
      "Post a markdown comment on a Linear issue. Use this after completing work to post a session summary or progress update.",
    promptSnippet: "Post a markdown comment on a Linear issue",
    promptGuidelines: [
      "After completing work on an issue, call linear_add_comment to post a summary of what was done, including key changes and decisions.",
    ],
    parameters: Type.Object({
      issueId: Type.String({ description: "Issue ID (UUID format, e.g. from linear_get_issue)" }),
      body: Type.String({ description: "Comment body in markdown format" }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      try {
        const data = await graphqlRequest<{
          commentCreate: { success: boolean; comment: { id: string; url: string; body: string } };
        }>(`
          mutation($input: CommentCreateInput!) {
            commentCreate(input: $input) {
              success
              comment { id url body }
            }
          }
        `, { input: { issueId: params.issueId, body: params.body } });

        if (!data.commentCreate.success) {
          return {
            content: [{ type: "text", text: "Failed to post comment." }],
            details: { error: true },
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Comment posted: ${data.commentCreate.comment.url}`,
            },
          ],
          details: { comment: data.commentCreate.comment },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          details: { error: true },
          isError: true,
        };
      }
    },
  });

  // ── Tool: linear_update_issue ───────────────────────────────────────────

  pi.registerTool({
    name: "linear_update_issue",
    label: "Linear: Update Issue",
    description:
      "Update a Linear issue. Primary use: transition an issue from unstarted to completed (PI Agent state) after completing work. Can also update assignee and priority.",
    promptSnippet: "Update a Linear issue (transition to PI Agent completed state, reassign, change priority)",
    promptGuidelines: [
      "After completing work on an issue, call linear_update_issue with just the issueId to mark it as Done via the PI Agent completed state. The agent should do this before posting a summary comment.",
      "If the PI Agent state doesn't exist for the team, provide an explicit stateId from a known completed state.",
    ],
    parameters: Type.Object({
      issueId: Type.String({ description: "Issue ID (UUID format, e.g. from linear_get_issue or linear_list_issues)" }),
      stateId: Type.Optional(Type.String({ description: "Target state ID. If omitted, transitions to the PI Agent completed state." })),
      assigneeId: Type.Optional(Type.String({ description: "New assignee user ID" })),
      priority: Type.Optional(Type.Number({ description: "New priority (0-4, where 0=urgent, 4=low)" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      try {
        // Resolve the target state ID
        let stateId = params.stateId;
        if (!stateId) {
          // Get issue's team first
          const issueData = await graphqlRequest<{
            issue: { id: string; identifier: string; team: { id: string } };
          }>(`
            query($id: String!) {
              issue(id: $id) {
                id identifier
                team { id }
              }
            }
          `, { id: params.issueId });

          const teamId = issueData.issue.team.id;
          stateId = await getCompletedStateId(teamId);

          if (!stateId) {
            return {
              content: [{
                type: "text",
                text: "Could not find or create a 'PI Agent' completed state for this team. " +
                  "Please provide an explicit stateId from a known completed state. " +
                  "Use linear_list_issues with status: ['Done'] or similar to discover completed state IDs.",
              }],
              details: { error: true },
              isError: true,
            };
          }
        }

        const input: Record<string, unknown> = { stateId };
        if (params.assigneeId) input.assigneeId = params.assigneeId;
        if (params.priority !== undefined) input.priority = params.priority;

        const data = await graphqlRequest<{
          issueUpdate: { success: boolean; issue: { id: string; identifier: string; title: string; state: { name: string } } };
        }>(`
          mutation($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success
              issue { id identifier title state { name } }
            }
          }
        `, { id: params.issueId, input });

        if (!data.issueUpdate.success) {
          return {
            content: [{ type: "text", text: "Failed to update issue." }],
            details: { error: true },
            isError: true,
          };
        }

        const updated = data.issueUpdate.issue;
        return {
          content: [
            {
              type: "text",
              text: `Issue ${updated.identifier} updated → **${updated.state.name}**\n` +
                `Title: ${sanitizeText(updated.title)}\n` +
                `URL: https://linear.app/issue/${updated.identifier}`,
            },
          ],
          details: { issue: updated },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          details: { error: true },
          isError: true,
        };
      }
    },
  });

  // ── Command: /linear-issues ──────────────────────────────────────────────

  pi.registerCommand("linear-issues", {
    description: "Browse Linear projects → milestones → issues interactively",
    handler: async (_args, ctx) => {
      // Check API key first
      try {
        // Trigger key validation early
        const { getApiKey } = await import("./linear-client");
        getApiKey();
      } catch (err) {
        ctx.ui.notify(
          err instanceof Error ? err.message : "LINEAR_API_KEY not set",
          "error",
        );
        return;
      }

      // Non-TUI modes
      if (ctx.mode !== "tui") {
        ctx.ui.notify(
          "Interactive browsing unavailable in this mode. Use the linear_* tools directly.",
          "error",
        );
        return;
      }

      // Phase 1: Pick a project
      try {
        const projectsData = await graphqlRequest<{
          projects: { nodes: LinearProject[] };
        }>(`
          query { projects(first: 50) { nodes { id name description } } }
        `);

        const projects = projectsData.projects.nodes;
        if (!projects.length) {
          ctx.ui.notify("No projects accessible. Check your Linear workspace permissions.", "error");
          return;
        }

        const projectChoices = [
          ...projects.map((p) => ({
            label: sanitizeText(p.name),
            value: p.id,
          })),
          { label: "[All projects]", value: "__all__" },
        ];

        const projectChoice = await ctx.ui.select("Select project:", projectChoices);
        if (!projectChoice) {
          ctx.ui.notify("Cancelled.", "info");
          return;
        }

        cachedProjectId = projectChoice === "__all__" ? undefined : projectChoice;

        // Phase 2: Pick a milestone
        const milestonesData = await graphqlRequest<{
          projectMilestones: {
            nodes: Array<{
              id: string;
              name: string;
              description?: string;
              progress: number;
              targetDate?: string;
              issues: { nodes: Array<{ id: string; state: { name: string; type: string } }> };
            }>;
          };
        }>(`
          query($filter: ProjectMilestoneFilter) {
            projectMilestones(
              filter: $filter
              includeArchived: false
              first: 50
            ) {
              nodes {
                id name description progress targetDate
                issues(filter: { state: { type: { nin: ["completed", "canceled"] } } }) {
                  nodes { id state { name type } }
                }
              }
            }
          }
        `, {
          filter: cachedProjectId
            ? { project: { id: { eq: cachedProjectId } } }
            : {},
        });

        const milestones = milestonesData.projectMilestones.nodes.map((m) => {
          const byState: Record<string, number> = {};
          for (const issue of m.issues.nodes) {
            const name = issue.state.name;
            byState[name] = (byState[name] || 0) + 1;
          }
          const counts = Object.entries(byState)
            .map(([state, count]) => `${count} ${state}`)
            .join(", ");

          return {
            id: m.id,
            name: m.name,
            issueCounts: { total: m.issues.nodes.length, byState },
            label: `${sanitizeText(m.name)} — ${m.issues.nodes.length} open${counts ? ` (${counts})` : ""}`,
          };
        });

        if (!milestones.length) {
          ctx.ui.notify("No milestones found for the selected project.", "info");
          return;
        }

        const allMilestones = milestones.reduce((sum, m) => sum + m.issueCounts.total, 0);

        const milestoneChoices = [
          ...milestones.map((m) => ({ label: m.label, value: m.id })),
          { label: `[All milestones] — ${allMilestones} open`, value: "__all__" },
        ];

        const milestoneChoice = await ctx.ui.select("Select milestone:", milestoneChoices);
        if (!milestoneChoice) {
          ctx.ui.notify("Cancelled.", "info");
          return;
        }

        // Phase 3: Fetch and display issues
        const issueFilter: Record<string, unknown> = {
          state: { type: { eq: "unstarted" } },
        };
        if (milestoneChoice !== "__all__") {
          issueFilter.projectMilestone = { id: { eq: milestoneChoice } };
        } else if (cachedProjectId) {
          // When "all milestones" selected but project is scoped, use team filter
          // (issues inherit team from project, but we need to scope somehow)
          // We'll just not add projectMilestone filter — shows all unstarted issues
          // across all milestones in the project (or workspace if no project selected)
        }

        const issuesData = await graphqlRequest<{
          issues: { nodes: LinearIssue[] };
        }>(`
          query($filter: IssueFilter, $first: Int) {
            issues(filter: $filter, first: $first) {
              nodes {
                ${ISSUE_FIELDS}
              }
            }
          }
        `, { filter: issueFilter, first: 50 });

        const issues = issuesData.issues.nodes;

        if (!issues.length) {
          ctx.ui.notify("No unstarted issues found for the selected milestone.", "info");
          return;
        }

        // Display issues count as notification, full list into chat context
        const issueLines = issues.map((issue, i) => formatIssueLine(issue, i));
        const message = `Found ${issues.length} unstarted issues:\n\n${issueLines.join("\n")}`;

        ctx.ui.notify(`Found ${issues.length} unstarted issues. Loading into chat...`, "info");

        pi.sendUserMessage(
          `${message}\n\nYou can now work on these issues. Use linear_get_issue to read full details, then linear_update_issue to mark as Done when finished.`,
          { deliverAs: "followUp" },
        );
      } catch (err) {
        ctx.ui.notify(
          `Linear API error: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    },
  });
}
