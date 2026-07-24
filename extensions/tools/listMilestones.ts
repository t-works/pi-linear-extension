import { Type } from "typebox";
import { ToolDefinition } from "@earendil-works/pi-coding-agent/dist/core/extensions/types";
import { sanitizeText } from "../helpers/sanitizeText";
import { fetchMilestones } from "../api/fetchMilestones";

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
                const milestones = await fetchMilestones(projectId, signal);

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
