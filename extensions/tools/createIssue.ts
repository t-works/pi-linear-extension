import { Type } from "typebox";
import { graphqlRequest } from "../api/linear-client";
import { ToolDefinition } from "@earendil-works/pi-coding-agent/dist/core/extensions/types";
import { sanitizeText } from "../helpers/sanitizeText";

const toolDef = {
    name: "linear_create_issue",
    label: "Linear: Create Issue",
    description:
        "Create a new Linear issue. If a project is known (from a prior /linear-issues browse), it is pre-filled. " +
        "If a milestone is known, it is used as the default but can be overridden. " +
        "Issues can be created as siblings (no parent) or as children of an existing issue.",
    promptSnippet: "Create a new Linear issue",
    promptGuidelines: [
        "Use this tool to create issues from the command line or as part of a workflow.",
        "If a project is known (e.g. cached from /linear-issues), the new issue will be created in that project by default and the team is auto-detected from the project.",
        "If a milestone is known, it is used as the default milestone but the user can provide a different one.",
        "Issues can be created as standalone (sibling) or as child issues — use parentId to create a child.",
        "Only title is truly required. teamId is auto-detected from the project, or from the viewer's teams if there's only one.",
    ],
};

const toolParameters = Type.Object({
    title: Type.String({ description: "Issue title (required)" }),
    teamId: Type.Optional(Type.String({ description: "Team ID. Auto-detected from project (if projectId is provided or cached), or from the viewer's single team. Only needed if you have multiple teams and no project." })),
    description: Type.Optional(Type.String({ description: "Issue description in markdown format" })),
    projectId: Type.Optional(Type.String({ description: "Project ID. If omitted and a project is cached (from /linear-issues), the cached project is used." })),
    milestoneId: Type.Optional(Type.String({ description: "Milestone ID. If omitted and a milestone is known from context, it may be used as default. Pass explicitly to override." })),
    parentId: Type.Optional(Type.String({ description: "Parent issue ID (UUID) to create this issue as a child. Omit to create a standalone (sibling) issue." })),
    assigneeId: Type.Optional(Type.String({ description: "Assignee user ID" })),
    priority: Type.Optional(Type.Number({ description: "Priority (0-4, where 0=urgent, 4=low)" })),
});

interface CreateIssueParams {
    title: string;
    teamId?: string;
    description?: string;
    projectId?: string;
    milestoneId?: string;
    parentId?: string;
    assigneeId?: string;
    priority?: number;
}

export function createIssue(getCachedProjectId: () => string | undefined): ToolDefinition<typeof toolParameters> {
    return {
        ...toolDef,
        parameters: toolParameters,
        async execute(_toolCallId, params: CreateIssueParams, signal, _onUpdate, ctx) {
            try {
                const projectId = params.projectId ?? getCachedProjectId();

                // Auto-detect teamId if not provided
                let teamId = params.teamId;
                if (!teamId && projectId) {
                    // Priority 1: look up the project's team
                    const projectData = await graphqlRequest<{
                        project: { teams: { nodes: Array<{ id: string; name: string }> } };
                    }>(`query($id: String!) { project(id: $id) { teams { nodes { id name } } } }`, { id: projectId }, signal);
                    const projectTeams = projectData.project?.teams?.nodes;
                    if (projectTeams?.length) {
                        teamId = projectTeams[0].id;
                    }
                }
                if (!teamId) {
                    // Priority 2: fall back to viewer's teams
                    const viewerData = await graphqlRequest<{
                        viewer: { teams: { nodes: Array<{ id: string; name: string }> } };
                    }>(`query { viewer { teams { nodes { id name } } } }`, undefined, signal);
                    const viewerTeams = viewerData.viewer?.teams?.nodes ?? [];

                    if (viewerTeams.length === 0) {
                        return {
                            content: [{ type: "text", text: "No teams found for this API key. Please provide a teamId." }],
                            details: { error: true },
                            isError: true,
                        };
                    }

                    if (viewerTeams.length === 1) {
                        teamId = viewerTeams[0].id;
                    } else if (ctx.hasUI) {
                        // Multiple teams — let the user pick
                        const teamLabels = viewerTeams.map((t) => t.name);
                        const chosen = await ctx.ui.select("Select a team for this issue:", teamLabels);
                        if (!chosen) {
                            return {
                                content: [{ type: "text", text: "Issue creation cancelled — no team selected." }],
                                details: { cancelled: true },
                            };
                        }
                        const idx = teamLabels.indexOf(chosen);
                        teamId = viewerTeams[idx].id;
                    } else {
                        // No UI available — return the list as an error so the agent can re-invoke
                        const teamList = viewerTeams.map((t) => `${t.name} (id: ${t.id})`).join(", ");
                        return {
                            content: [{ type: "text", text: `Multiple teams found. Please provide a teamId. Available: ${teamList}` }],
                            details: { error: true },
                            isError: true,
                        };
                    }
                }

                const input: Record<string, unknown> = {
                    teamId,
                    title: params.title,
                };

                if (params.description) input.description = params.description;
                if (projectId) input.projectId = projectId;
                if (params.milestoneId) input.projectMilestoneId = params.milestoneId;
                if (params.parentId) input.parentId = params.parentId;
                if (params.assigneeId) input.assigneeId = params.assigneeId;
                if (params.priority !== undefined) input.priority = params.priority;

                const data = await graphqlRequest<{
                    issueCreate: {
                        success: boolean;
                        issue: {
                            id: string;
                            identifier: string;
                            title: string;
                            url: string;
                            state: { name: string };
                            project?: { id: string; name: string };
                            projectMilestone?: { id: string; name: string };
                            parent?: { id: string; identifier: string; title: string };
                            team: { id: string; name: string; key: string };
                        };
                    };
                }>(`
                    mutation($input: IssueCreateInput!) {
                        issueCreate(input: $input) {
                            success
                            issue {
                                id identifier title url
                                state { name }
                                project { id name }
                                projectMilestone { id name }
                                parent { id identifier title }
                                team { id name key }
                            }
                        }
                    }
                `, { input }, signal);

                if (!data.issueCreate.success) {
                    return {
                        content: [{ type: "text", text: "Failed to create issue. Check that the teamId, projectId, and other fields are valid." }],
                        details: { error: true },
                        isError: true,
                    };
                }

                const issue = data.issueCreate.issue;
                const lines: string[] = [
                    `**Issue created:** ${issue.identifier}`,
                    `Title: ${sanitizeText(issue.title)}`,
                    `State: ${issue.state.name}`,
                    `Team: ${issue.team.name} (${issue.team.key})`,
                    `URL: ${issue.url}`,
                ];

                if (issue.project) {
                    lines.push(`Project: ${sanitizeText(issue.project.name)}`);
                }
                if (issue.projectMilestone) {
                    lines.push(`Milestone: ${sanitizeText(issue.projectMilestone.name)}`);
                }
                if (issue.parent) {
                    lines.push(`Parent: ${issue.parent.identifier} — ${sanitizeText(issue.parent.title)}`);
                }
                if (params.description) {
                    lines.push(`Description: ${params.description.length > 200 ? params.description.slice(0, 200) + "…" : params.description}`);
                }

                return {
                    content: [{ type: "text", text: lines.join("\n") }],
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
    };
}
