import {Type} from "typebox";
import {graphqlRequest} from "../api/linear-client";
import {ToolDefinition} from "@earendil-works/pi-coding-agent/dist/core/extensions/types";
import {ISSUE_FIELDS} from "../const";
import {LinearIssue} from "../types";
import {formatIssueDetail} from "../helpers/formatIssueDetail";

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
