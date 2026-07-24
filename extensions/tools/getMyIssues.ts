import { Type } from "typebox";
import { graphqlRequest } from "../api/linear-client";
import { ToolDefinition } from "@earendil-works/pi-coding-agent/dist/core/extensions/types";
import { LinearViewer } from "../types";
import { formatIssueLine } from "../helpers/formatIssueLine";

const toolDef = {
    name: "linear_get_my_issues",
    label: "Linear: My Issues",
    description:
        "Get issues assigned to the current user. Defaults to unstarted issues (Todo/Backlog). Convenience tool — no need to know your user ID.",
    promptSnippet: "Get current user's assigned Linear issues (defaults to unstarted)",
};

const toolParameters = Type.Object({
    status: Type.Optional(
        Type.Array(Type.String(), { description: 'Override default unstarted filter, e.g. ["In Progress"]' }),
    ),
    limit: Type.Optional(Type.Number({ description: "Max issues to return (default: 20)", default: 20 })),
});

export function getMyIssues(): ToolDefinition<typeof toolParameters> {
    return {
        ...toolDef,
        parameters: toolParameters,
        async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
            try {
                const first = params.limit ?? 20;
                const filter: Record<string, unknown> = {};

                if (params.status && params.status.length > 0) {
                    filter.state = { name: { in: params.status } };
                } else {
                    filter.state = { type: { in: ["unstarted", "backlog"] } };
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
                `, { filter, first }, signal);

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
    };
}
