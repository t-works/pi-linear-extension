import {LinearIssue} from "../types";
import {sanitizeText} from "./sanitizeText";

export function formatIssueDetail(issue: LinearIssue): string {
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