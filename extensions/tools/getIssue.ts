import { Type } from "typebox";
import { graphqlRequest } from "../api/linear-client";
import { ToolDefinition } from "@earendil-works/pi-coding-agent/dist/core/extensions/types";
import { ISSUE_FIELDS } from "../const";
import { LinearIssue } from "../types";
import { sanitizeText } from "../helpers/sanitizeText";

const toolDef = {
    name: "linear_get_issue",
    label: "Linear: Get Issue",
    description:
        "Get full details of a Linear issue by ID or identifier (e.g. 'LIN-42'). Includes description, comments, sub-issues, and parent issue.",
    promptSnippet: "Get full details of a Linear issue by ID or identifier like LIN-42",
};

const toolParameters = Type.Object({
    issueId: Type.String({ description: "Issue identifier (e.g. 'LIN-42') or UUID" }),
});

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

export function getIssue(): ToolDefinition<typeof toolParameters> {
    return {
        ...toolDef,
        parameters: toolParameters,
        async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
            try {
                const issueId = params.issueId.trim();

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
                `, { id: issueId }, signal);

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
    };
}
