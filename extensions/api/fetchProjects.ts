import { graphqlRequest } from "./linear-client";
import { LinearProject } from "../types";

export async function fetchProjects(signal?: AbortSignal): Promise<LinearProject[]> {
    const data = await graphqlRequest<{
        projects: { nodes: LinearProject[] };
    }>(`
        query {
            projects(first: 50) {
                nodes { id name description }
            }
        }
    `, undefined, signal);

    return data.projects.nodes;
}
