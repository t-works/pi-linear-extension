import { graphqlRequest } from "./linear-client";

export interface MilestoneData {
    id: string;
    name: string;
    description?: string;
    progress: number;
    targetDate?: string;
    issueCounts: {
        total: number;
        byState: Record<string, number>;
    };
}

export async function fetchMilestones(projectId?: string, signal?: AbortSignal): Promise<MilestoneData[]> {
    const data = await graphqlRequest<{
        projectMilestones: {
            nodes: Array<{
                id: string;
                name: string;
                description?: string;
                progress: number;
                targetDate?: string;
                issues: { nodes: Array<{ id: string; state: { name: string; type: string } }> };
            }>;
        };
    }>(`
        query($filter: ProjectMilestoneFilter) {
            projectMilestones(
                filter: $filter
                includeArchived: false
                first: 50
            ) {
                nodes {
                    id name description progress targetDate
                    issues(filter: { state: { type: { nin: ["completed", "canceled"] } } }) {
                        nodes { id state { name type } }
                    }
                }
            }
        }
    `, {
        filter: projectId
            ? { project: { id: { eq: projectId } } }
            : {},
    }, signal);

    return data.projectMilestones.nodes.map((m) => {
        const byState: Record<string, number> = {};
        for (const issue of m.issues.nodes) {
            const name = issue.state.name;
            byState[name] = (byState[name] || 0) + 1;
        }
        return {
            id: m.id,
            name: m.name,
            description: m.description,
            progress: m.progress,
            targetDate: m.targetDate,
            issueCounts: {
                total: m.issues.nodes.length,
                byState,
            },
        };
    });
}
