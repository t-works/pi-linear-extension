import { Type } from "typebox";
import { ToolDefinition } from "@earendil-works/pi-coding-agent/dist/core/extensions/types";
import { sanitizeText } from "../helpers/sanitizeText";
import { fetchProjects } from "../api/fetchProjects";

const toolDef = {
    name: "linear_list_projects",
    label: "Linear: List Projects",
    description:
        "List all accessible Linear projects. Use this to discover project IDs for filtering milestones and issues.",
    promptSnippet: "List accessible Linear projects",
};

const toolParameters = Type.Object({});

export function listProjects(): ToolDefinition<typeof toolParameters> {
    return {
        ...toolDef,
        parameters: toolParameters,
        async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
            try {
                const projects = await fetchProjects(signal);

                if (!projects.length) {
                    return {
                        content: [{ type: "text", text: "No projects found." }],
                        details: { projects: [], count: 0 },
                    };
                }

                const lines = projects.map(
                    (p, i) => `${i + 1}. ${sanitizeText(p.name)} (id: ${p.id})${p.description ? ` — ${sanitizeText(p.description).slice(0, 100)}` : ""}`,
                );

                return {
                    content: [
                        {
                            type: "text",
                            text: `Found ${projects.length} projects:\n\n${lines.join("\n")}`,
                        },
                    ],
                    details: { projects, count: projects.length },
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
