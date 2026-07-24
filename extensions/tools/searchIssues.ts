import { Type } from "typebox";
import { graphqlRequest } from "../api/linear-client";
import { ToolDefinition } from "@earendil-works/pi-coding-agent/dist/core/extensions/types";
import { LinearIssue } from "../types";
import { formatIssueLine } from "../helpers/formatIssueLine";

const toolDef = {
    name: "linear_search_issues",
    label: "Linear: Search Issues",
    description: "Search Linear issues by term across all states. Returns matching issues with their URL and state.",
    promptSnippet: "Search Linear issues by term",
};

const toolParameters = Type.Object({
    term: Type.String({ description: "Search term to find issues" }),
    limit: Type.Optional(Type.Number({ description: "Max results (default: 20)", default: 20 })),
});

export function searchIssues(): ToolDefinition<typeof toolParameters> {
    return {
        ...toolDef,
        parameters: toolParameters,
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
                `, { term: params.term, first }, signal);

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
    };
}
