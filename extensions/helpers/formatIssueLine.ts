import {LinearIssue} from "../types";
import {sanitizeText} from "./sanitizeText";

export function formatIssueLine(issue: LinearIssue, index: number): string {
    const title = sanitizeText(issue.title);
    const state = issue.state?.name ?? "Unknown";
    const priority = issue.priorityLabel;
    const assignee = issue.assignee?.name;
    const parts = [`${index + 1}. ${issue.identifier} — ${title}`];
    parts.push(`[${state}]`);
    if (priority && priority !== "No priority") parts.push(`(priority: ${priority})`);
    if (assignee) parts.push(`(assignee: ${assignee})`);
    return parts.join(" ");
}