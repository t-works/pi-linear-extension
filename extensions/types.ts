interface LinearTeam {
    id: string;
    name: string;
    key: string;
    workflowStates?: { nodes: LinearWorkflowState[] };
}

export interface LinearWorkflowState {
    id: string;
    name: string;
    type: string;
}

export interface LinearProject {
    id: string;
    name: string;
    description?: string;
}

interface LinearMilestone {
    id: string;
    name: string;
    description?: string;
    progress: number;
    targetDate?: string;
    issueCounts?: MilestoneIssueCounts;
}

interface MilestoneIssueCounts {
    total: number;
    byState: Record<string, number>;
}

export interface LinearIssue {
    id: string;
    identifier: string;
    title: string;
    description?: string;
    state: { id: string; name: string; type: string };
    priority: number;
    priorityLabel: string;
    assignee?: { id: string; name: string };
    projectMilestone?: { id: string; name: string };
    team: { id: string; name: string; key: string };
    url: string;
    createdAt: string;
    updatedAt: string;
    parent?: { id: string; identifier: string; title: string };
    children?: {
        nodes: Array<{ id: string; identifier: string; title: string; state: { name: string; type: string } }>
    };
    comments?: { nodes: LinearComment[] };
}

interface LinearComment {
    id: string;
    body: string;
    user?: { name: string };
    createdAt: string;
}

export interface LinearViewer {
    id: string;
    name: string;
    assignedIssues: { nodes: LinearIssue[] };
}