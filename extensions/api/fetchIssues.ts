import { graphqlRequest } from "./linear-client";
import { ISSUE_FIELDS } from "../const";
import { LinearIssue } from "../types";

export async function fetchIssues(
    filter: Record<string, unknown>,
    first: number,
    signal?: AbortSignal,
): Promise<LinearIssue[]> {
    const data = await graphqlRequest<{
        issues: { nodes: LinearIssue[] };
    }>(`
        query($filter: IssueFilter, $first: Int) {
            issues(filter: $filter, first: $first) {
                nodes {
                    ${ISSUE_FIELDS}
                }
            }
        }
    `, { filter, first }, signal);

    return data.issues.nodes;
}
