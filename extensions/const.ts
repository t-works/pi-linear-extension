export const ISSUE_FIELDS = `
  id identifier title description
  state { id name type }
  priority priorityLabel
  assignee { id name }
  projectMilestone { id name }
  team { id name key }
  url createdAt updatedAt
  parent { id identifier title }
`;