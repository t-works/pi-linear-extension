import { Type } from "typebox";
import { graphqlRequest } from "../linear-client";
import { ToolDefinition } from "@earendil-works/pi-coding-agent/dist/core/extensions/types";
import { ISSUE_FIELDS } from "../const";
import { LinearIssue } from "../types";
import { formatIssueLine } from "../helpers/formatIssueLine";

const toolDef = {
    name: "linear_list_issues",
    label: "Linear: List Issues",
    description:
        "List Linear issues. Defaults to unstarted issues (Todo/Backlog). Filter by milestone, team, assignee, or status. Use this to find issues to work on.",
    promptSnippet: "List Linear issues (defaults to unstarted), optionally filtered by milestoneId, teamId, assigneeId, status, search, limit",
    promptGuidelines: [
        "Use linear_list_issues to find unstarted issues to work on. Default filter returns only Todo/Backlog items.",
    ],
};

const toolParameters = Type.Object({
    milestoneId: Type.Optional(Type.String({ description: "Filter by milestone ID" })),
    teamId: Type.Optional(Type.String({ description: "Filter by team ID" })),
    assigneeId: Type.Optional(Type.String({ description: "Filter by assignee ID" })),
    status: Type.Optional(
        Type.Array(Type.String(), { description: 'Override the default "unstarted" filter with specific state names, e.g. ["In Progress", "Todo"]' }),
    ),
    limit: Type.Optional(Type.Number({ description: "Max issues to return (default: 50)", default: 50 })),
    search: Type.Optional(Type.String({ description: "Search term to filter issues by title/description" })),
});

export function listIssues(): ToolDefinition<typeof toolParameters> {
    return {
        ...toolDef,
        parameters: toolParameters,
        async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
            try {
                const first = params.limit ?? 50;
                const filter: Record<string, unknown> = {};

                if (params.status && params.status.length > 0) {
                    filter.state = { name: { in: params.status } };
                } else {
                    filter.state = { type: { eq: "unstarted" } };
                }

                if (params.milestoneId) filter.projectMilestone = { id: { eq: params.milestoneId } };
                if (params.teamId) filter.team = { id: { eq: params.teamId } };
                if (params.assigneeId) filter.assignee = { id: { eq: params.assigneeId } };

                let queryFilter: Record<string, unknown>;
                if (params.search) {
                    queryFilter = {
                        and: [
                            filter,
                            {
                                or: [
                                    { title: { contains: params.search } },
                                    { description: { contains: params.search } },
                                ],
                            },
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
                `, { filter: queryFilter, first }, signal);

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
    };
}
