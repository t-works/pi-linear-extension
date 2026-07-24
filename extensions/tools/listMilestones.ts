import { Type } from "typebox";
import { graphqlRequest } from "../linear-client";
import { ToolDefinition } from "@earendil-works/pi-coding-agent/dist/core/extensions/types";
import { sanitizeText } from "../helpers/sanitizeText";

const toolDef = {
    name: "linear_list_milestones",
    label: "Linear: List Milestones",
    description:
        "List milestones with issue counts for a project. Shows only started/planned milestones. Used by the /linear-issues command and callable directly by the agent.",
    promptSnippet: "List Linear milestones with issue counts, optionally filtered by projectId",
};

const toolParameters = Type.Object({
    projectId: Type.Optional(
        Type.String({ description: "Project ID to filter milestones. If omitted, uses cached project from /linear-issues or returns all." }),
    ),
});

export function listMilestones(getCachedProjectId: () => string | undefined): ToolDefinition<typeof toolParameters> {
    return {
        ...toolDef,
        parameters: toolParameters,
        async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
            try {
                const projectId = params.projectId || getCachedProjectId();

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
                }, signal);

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
    };
}
