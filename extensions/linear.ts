/**
 * Linear Integration extension for pi.
 *
 * Registers tools for Linear issue management and an interactive
 * `/linear-issues` command for browsing projects → milestones → issues.
 *
 * Tools:
 *   linear_list_projects    — List accessible projects
 *   linear_list_milestones  — List milestones with issue counts
 *   linear_list_issues      — List issues (defaults to unstarted)
 *   linear_get_issue        — Full issue details with comments
 *   linear_get_my_issues    — Current user's assigned unstarted issues
 *   linear_search_issues    — Search issues by text
 *   linear_add_comment      — Post a markdown comment
 *   linear_update_issue     — Update issue (primary use: → PI Agent completed state)
 *   linear_create_issue     — Create a new issue
 *
 * Command:
 *   /linear-issues          — Interactive project → milestone → issue browser
 *
 * Default filter: state.type in ["unstarted", "backlog"] (the stable categories for Todo/New and Backlog).
 * Completed/canceled issues are excluded from the work queue by default.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sanitizeText } from "./helpers/sanitizeText";
import { fetchProjects } from "./api/fetchProjects";
import { fetchMilestones } from "./api/fetchMilestones";
import { fetchIssues } from "./api/fetchIssues";
import { graphqlRequest } from "./api/linear-client";
import { ISSUE_FIELDS } from "./const";
import { listIssues } from "./tools/listIssues";
import { listProjects } from "./tools/listProjects";
import { listMilestones } from "./tools/listMilestones";
import { getIssue } from "./tools/getIssue";
import { getMyIssues } from "./tools/getMyIssues";
import { searchIssues } from "./tools/searchIssues";
import { addComment } from "./tools/addComment";
import { updateIssue, ensurePiAgentStates, clearPiAgentStateCache } from "./tools/updateIssue";
import { createIssue } from "./tools/createIssue";

import {formatIssueDetail} from "./helpers/formatIssueDetail";

export default function linearExtension(pi: ExtensionAPI) {
    let cachedProjectId: string | undefined;

    pi.on("session_start", async () => {
        cachedProjectId = undefined;
        clearPiAgentStateCache();
        ensurePiAgentStates().catch(() => {
            // Non-fatal — states will be created on first update_issue call
        });
    });

    pi.on("session_shutdown", () => {
        cachedProjectId = undefined;
        clearPiAgentStateCache();
    });

    // ── Tool registrations ──────────────────────────────────────────────────

    pi.registerTool(listProjects());
    pi.registerTool(listMilestones(() => cachedProjectId));
    pi.registerTool(listIssues());
    pi.registerTool(getIssue());
    pi.registerTool(getMyIssues());
    pi.registerTool(searchIssues());
    pi.registerTool(addComment());
    pi.registerTool(updateIssue());
    pi.registerTool(createIssue(() => cachedProjectId));

    // ── Command: /linear-issues ──────────────────────────────────────────────

    pi.registerCommand("linear-issues", {
        description: "Browse Linear projects → milestones → issues interactively",
        handler: async (_args, ctx) => {
            // Check API key first
            try {
                const { getApiKey } = await import("./api/linear-client");
                getApiKey();
            } catch (err) {
                ctx.ui.notify(
                    err instanceof Error ? err.message : "LINEAR_API_KEY not set",
                    "error",
                );
                return;
            }

            // Non-TUI modes
            if (ctx.mode !== "tui") {
                ctx.ui.notify(
                    "Interactive browsing unavailable in this mode. Use the linear_* tools directly.",
                    "error",
                );
                return;
            }

            // Phase 1: Pick a project
            try {
                const projects = await fetchProjects();
                if (!projects.length) {
                    ctx.ui.notify("No projects accessible. Check your Linear workspace permissions.", "error");
                    return;
                }

                const projectLabels = [
                    ...projects.map((p) => sanitizeText(p.name)),
                    "[All projects]",
                ];

                const projectChoice = await ctx.ui.select("Select project:", projectLabels);
                if (!projectChoice) {
                    ctx.ui.notify("Cancelled.", "info");
                    return;
                }

                const projectIdx = projectLabels.indexOf(projectChoice);
                cachedProjectId = projectIdx === projects.length ? undefined : projects[projectIdx].id;

                // Phase 2: Pick a milestone
                const milestonesRaw = await fetchMilestones(cachedProjectId);
                const milestones = milestonesRaw.map((m) => {
                    const counts = Object.entries(m.issueCounts.byState)
                        .map(([state, count]) => `${count} ${state}`)
                        .join(", ");
                    return {
                        ...m,
                        label: `${sanitizeText(m.name)} — ${m.issueCounts.total} open${counts ? ` (${counts})` : ""}`,
                    };
                });

                let selectedMilestoneId: string | undefined;

                if (!milestones.length) {
                    // No milestones — load all unstarted issues for this project directly
                    if (!cachedProjectId) {
                        ctx.ui.notify("No milestones found across all projects.", "info");
                        return;
                    }
                    ctx.ui.notify("No milestones found. Loading all unstarted issues for this project…", "info");
                } else {
                    const allMilestones = milestones.reduce((sum, m) => sum + m.issueCounts.total, 0);

                    const milestoneLabels = [
                        ...milestones.map((m) => m.label),
                        `[All milestones] — ${allMilestones} open`,
                    ];

                    const milestoneChoice = await ctx.ui.select("Select milestone:", milestoneLabels);
                    if (!milestoneChoice) {
                        ctx.ui.notify("Cancelled.", "info");
                        return;
                    }

                    const milestoneIdx = milestoneLabels.indexOf(milestoneChoice);
                    selectedMilestoneId = milestoneIdx === milestones.length ? "__all__" : milestones[milestoneIdx].id;
                }

                // Phase 3: Pick an issue and load details
                const issueFilter: Record<string, unknown> = {
                    state: { type: { in: ["unstarted", "backlog"] } },
                };
                if (selectedMilestoneId && selectedMilestoneId !== "__all__") {
                    issueFilter.projectMilestone = { id: { eq: selectedMilestoneId } };
                } else if (!selectedMilestoneId && cachedProjectId) {
                    // No milestone selected, filter by project instead
                    issueFilter.project = { id: { eq: cachedProjectId } };
                }

                const issues = await fetchIssues(issueFilter, 50);

                if (!issues.length) {
                    if (!milestones.length && cachedProjectId) {
                        ctx.ui.notify("No unstarted issues found for this project.", "info");
                    } else {
                        ctx.ui.notify("No unstarted issues found for the selected milestone.", "info");
                    }
                    return;
                }

                const issueLabels = issues.map((issue) => {
                    const title = sanitizeText(issue.title);
                    const state = issue.state?.name ?? "Unknown";
                    const priority = issue.priorityLabel;
                    const assignee = issue.assignee?.name;
                    const parts = [`${issue.identifier} — ${title} [${state}]`];
                    if (priority && priority !== "No priority") parts.push(`(${priority})`);
                    if (assignee) parts.push(`(${assignee})`);
                    return parts.join(" ");
                });

                const issueChoice = await ctx.ui.select(
                    `Select issue (${issues.length} unstarted):`,
                    issueLabels,
                );
                if (!issueChoice) {
                    ctx.ui.notify("Cancelled.", "info");
                    return;
                }

                const issueIdx = issueLabels.indexOf(issueChoice);
                const selectedIssue = issues[issueIdx];

                ctx.ui.notify(`Loading ${selectedIssue.identifier}…`, "info");

                // Fetch full issue details (with children and comments)
                const detailData = await graphqlRequest<{
                    issue: import("./types").LinearIssue;
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
                `, { id: selectedIssue.id });

                const fullIssue = detailData.issue;
                if (!fullIssue) {
                    ctx.ui.notify("Failed to load issue details.", "error");
                    return;
                }

                const detailText = formatIssueDetail(fullIssue);

                pi.sendMessage(
                    {
                        customType: "linear-issue-detail",
                        content: detailText,
                        display: true,
                    },
                    { triggerTurn: false },
                );
            } catch (err) {
                ctx.ui.notify(
                    `Linear API error: ${err instanceof Error ? err.message : String(err)}`,
                    "error",
                );
            }
        },
    });
}
