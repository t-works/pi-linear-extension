import { Type } from "typebox";
import { graphqlRequest } from "../linear-client";
import { ToolDefinition } from "@earendil-works/pi-coding-agent/dist/core/extensions/types";
import { LinearWorkflowState } from "../types";
import { sanitizeText } from "../helpers/sanitizeText";

const toolDef = {
    name: "linear_update_issue",
    label: "Linear: Update Issue",
    description:
        "Update a Linear issue. Primary use: transition an issue from unstarted to completed (PI Agent state) after completing work. Can also update assignee and priority.",
    promptSnippet: "Update a Linear issue (transition to PI Agent completed state, reassign, change priority)",
    promptGuidelines: [
        "After completing work on an issue, call linear_update_issue with just the issueId to mark it as Done via the PI Agent completed state. The agent should do this before posting a summary comment.",
        "If the PI Agent state doesn't exist for the team, provide an explicit stateId from a known completed state.",
    ],
};

const toolParameters = Type.Object({
    issueId: Type.String({ description: "Issue ID (UUID format, e.g. from linear_get_issue or linear_list_issues)" }),
    stateId: Type.Optional(Type.String({ description: "Target state ID. If omitted, transitions to the PI Agent completed state." })),
    assigneeId: Type.Optional(Type.String({ description: "New assignee user ID" })),
    priority: Type.Optional(Type.Number({ description: "New priority (0-4, where 0=urgent, 4=low)" })),
});

/** teamId → completed state ID */
const piAgentStateCache = new Map<string, string>();

export async function ensurePiAgentStates(signal?: AbortSignal): Promise<void> {
    if (piAgentStateCache.size > 0) return;

    const teamsData = await graphqlRequest<{
        teams: { nodes: Array<{ id: string; name: string; key: string }> };
    }>(`
        query {
            teams(first: 50) {
                nodes { id name key }
            }
        }
    `, undefined, signal);

    for (const team of teamsData.teams.nodes) {
        const statesData = await graphqlRequest<{
            workflowStates: { nodes: LinearWorkflowState[] };
        }>(`
            query($teamId: ID!) {
                workflowStates(filter: { team: { id: { eq: $teamId } } }) {
                    nodes { id name type }
                }
            }
        `, { teamId: team.id }, signal);

        const states = statesData.workflowStates.nodes;
        const existing = states.find(
            (s) => s.name === "PI Agent" && s.type === "completed",
        );
        if (existing) {
            piAgentStateCache.set(team.id, existing.id);
        } else {
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
                }, signal);
                if (result.workflowStateCreate.success) {
                    piAgentStateCache.set(team.id, result.workflowStateCreate.workflowState.id);
                }
            } catch {
                // State creation failed — update_issue will need explicit stateId
            }
        }
    }
}

export function clearPiAgentStateCache(): void {
    piAgentStateCache.clear();
}

async function getCompletedStateId(teamId: string, signal?: AbortSignal): Promise<string | undefined> {
    await ensurePiAgentStates(signal);
    return piAgentStateCache.get(teamId);
}

export function updateIssue(): ToolDefinition<typeof toolParameters> {
    return {
        ...toolDef,
        parameters: toolParameters,
        async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
            try {
                let stateId = params.stateId;
                if (!stateId) {
                    const issueData = await graphqlRequest<{
                        issue: { id: string; identifier: string; team: { id: string } };
                    }>(`
                        query($id: String!) {
                            issue(id: $id) {
                                id identifier
                                team { id }
                            }
                        }
                    `, { id: params.issueId }, signal);

                    const teamId = issueData.issue.team.id;
                    stateId = await getCompletedStateId(teamId, signal);

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
                `, { id: params.issueId, input }, signal);

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
    };
}
