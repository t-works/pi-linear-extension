import { Type } from "typebox";
import { graphqlRequest } from "../linear-client";
import { ToolDefinition } from "@earendil-works/pi-coding-agent/dist/core/extensions/types";

const toolDef = {
    name: "linear_add_comment",
    label: "Linear: Add Comment",
    description:
        "Post a markdown comment on a Linear issue. Use this after completing work to post a session summary or progress update.",
    promptSnippet: "Post a markdown comment on a Linear issue",
    promptGuidelines: [
        "After completing work on an issue, call linear_add_comment to post a summary of what was done, including key changes and decisions.",
    ],
};

const toolParameters = Type.Object({
    issueId: Type.String({ description: "Issue ID (UUID format, e.g. from linear_get_issue)" }),
    body: Type.String({ description: "Comment body in markdown format" }),
});

export function addComment(): ToolDefinition<typeof toolParameters> {
    return {
        ...toolDef,
        parameters: toolParameters,
        async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
            try {
                const data = await graphqlRequest<{
                    commentCreate: { success: boolean; comment: { id: string; url: string; body: string } };
                }>(`
                    mutation($input: CommentCreateInput!) {
                        commentCreate(input: $input) {
                            success
                            comment { id url body }
                        }
                    }
                `, { input: { issueId: params.issueId, body: params.body } }, signal);

                if (!data.commentCreate.success) {
                    return {
                        content: [{ type: "text", text: "Failed to post comment." }],
                        details: { error: true },
                        isError: true,
                    };
                }

                return {
                    content: [
                        {
                            type: "text",
                            text: `Comment posted: ${data.commentCreate.comment.url}`,
                        },
                    ],
                    details: { comment: data.commentCreate.comment },
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
