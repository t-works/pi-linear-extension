import { Type } from "typebox";
import { graphqlRequest } from "../linear-client";
import { ToolDefinition } from "@earendil-works/pi-coding-agent/dist/core/extensions/types";
import { LinearProject } from "../types";
import { sanitizeText } from "../helpers/sanitizeText";

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
                const data = await graphqlRequest<{
                    projects: { nodes: LinearProject[] };
                }>(`
                    query {
                        projects(first: 50) {
                            nodes { id name description }
                        }
                    }
                `, undefined, signal);

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
    };
}
