import { DraftAgenda, ResolvedItem, PullRequest, JiraTicket, ReconciliationResult } from "../types";
import { getTodayDate } from "./date-utils";

/**
 * Merge resolved items into the draft agenda.
 * Items with "done" or "drop" resolution are removed.
 * Other items are placed in their appropriate section with context appended.
 */
export function mergeDraftWithResolutions(
  draft: DraftAgenda,
  resolvedItems: ResolvedItem[]
): DraftAgenda {
  // Create a mutable copy
  const merged: DraftAgenda = {
    focusToday: [...draft.focusToday],
    quickWins: [...draft.quickWins],
    later: [...draft.later],
  };

  for (const resolved of resolvedItems) {
    // First, remove the task from all sections (it may have been in the draft)
    const taskLower = resolved.task.toLowerCase();
    for (const key of Object.keys(merged) as (keyof DraftAgenda)[]) {
      merged[key] = merged[key].filter((t) => !t.toLowerCase().includes(taskLower));
    }

    // If done or dropped, don't add back
    if (resolved.resolution === "done" || resolved.resolution === "drop") {
      continue;
    }

    // Format task with context
    let formattedTask = resolved.task;
    if (resolved.context) {
      formattedTask = `${resolved.task} — ${resolved.context}`;
    }

    // Add to appropriate section
    switch (resolved.resolution) {
      case "focus_today":
        merged.focusToday.push(formattedTask);
        break;
      case "quick_win":
        merged.quickWins.push(formattedTask);
        break;
      case "later":
        merged.later.push(formattedTask);
        break;
    }
  }

  return merged;
}

/**
 * Render a draft agenda as markdown (simplified 3-section format).
 */
export function renderAgendaToMarkdown(draft: DraftAgenda, date?: string): string {
  const dateStr = date || getTodayDate();
  let markdown = `# Daily Focus — ${dateStr}\n\n`;

  // Focus today (max 3 items)
  markdown += `## Focus today\n`;
  for (const task of draft.focusToday) {
    markdown += `- [ ] ${task}\n`;
  }
  if (draft.focusToday.length === 0) {
    markdown += `\n`;
  }
  markdown += "\n";

  // Quick wins
  markdown += `## Quick wins\n`;
  for (const task of draft.quickWins) {
    markdown += `- [ ] ${task}\n`;
  }
  if (draft.quickWins.length === 0) {
    markdown += `\n`;
  }
  markdown += "\n";

  // Later
  markdown += `## Later\n`;
  for (const task of draft.later) {
    markdown += `- [ ] ${task}\n`;
  }
  if (draft.later.length === 0) {
    markdown += `\n`;
  }
  markdown += "\n";

  return markdown;
}

/**
 * Render PR and ticket status tables to append to the agenda.
 */
export function renderStatusTables(
  pullRequests: PullRequest[],
  tickets: JiraTicket[],
  reconciliation: ReconciliationResult
): string {
  let markdown = "---\n\n";

  // Open Pull Requests table
  markdown += "## Open Pull Requests\n\n";
  if (pullRequests.length === 0) {
    markdown += "_No open PRs_\n\n";
  } else {
    markdown += "| PR | Title | HIL Checks | Approved |\n";
    markdown += "|:---|:------|:-----------|:---------|\n";
    for (const pr of pullRequests) {
      const hilStatus =
        pr.hilChecksPassing === null ? "—" : pr.hilChecksPassing ? "✓ Passing" : "✗ Failing";
      const approvalStatus = pr.hasApproval ? "✓ Yes" : "✗ No";
      const jiraTag = pr.jiraId ? `[${pr.jiraId}]` : "";
      markdown += `| [#${pr.number}](${pr.url}) | ${jiraTag} ${pr.title.replace(pr.jiraId || "", "").trim()} | ${hilStatus} | ${approvalStatus} |\n`;
    }
    markdown += "\n";
  }

  // In-Progress Tickets table
  markdown += "## In-Progress Tickets\n\n";
  if (tickets.length === 0) {
    markdown += "_No in-progress tickets_\n\n";
  } else {
    markdown += "| Ticket | Summary | Status | PR |\n";
    markdown += "|:-------|:--------|:-------|:---|\n";
    for (const ticket of tickets) {
      const prLink = ticket.linkedPRNumber ? `#${ticket.linkedPRNumber}` : "—";
      markdown += `| [${ticket.key}](${ticket.url}) | ${ticket.summary} | ${ticket.status} | ${prLink} |\n`;
    }
    markdown += "\n";
  }

  // Reconciliation warnings
  if (reconciliation.warnings.length > 0) {
    markdown += "## Reconciliation Notes\n\n";
    for (const warning of reconciliation.warnings) {
      markdown += `- ⚠️ ${warning.message}\n`;
    }
    markdown += "\n";
  }

  return markdown;
}

/**
 * Parse a markdown agenda back into a DraftAgenda structure.
 * This is useful for editing and re-rendering.
 */
export function parseMarkdownToAgenda(markdown: string): DraftAgenda {
  const lines = markdown.split("\n");
  const agenda: DraftAgenda = {
    focusToday: [],
    quickWins: [],
    later: [],
  };

  let currentSection: keyof DraftAgenda | null = null;

  for (const line of lines) {
    // Check for section headers
    if (line.startsWith("## ")) {
      const sectionName = line.substring(3).trim();
      switch (sectionName) {
        case "Focus today":
          currentSection = "focusToday";
          break;
        case "Quick wins":
          currentSection = "quickWins";
          break;
        case "Later":
          currentSection = "later";
          break;
        default:
          // Stop parsing at other sections (like PR tables)
          currentSection = null;
      }
      continue;
    }

    // Stop at horizontal rule (status tables section)
    if (line.trim() === "---") {
      break;
    }

    // Check for tasks
    if (currentSection) {
      const taskMatch = line.match(/^-\s*\[([ xX])\]\s*(.+)$/);
      if (taskMatch) {
        const [, , text] = taskMatch;
        agenda[currentSection].push(text.trim());
      }
    }
  }

  return agenda;
}

/**
 * Generate an empty agenda template.
 */
export function generateEmptyAgenda(date?: string): string {
  const emptyDraft: DraftAgenda = {
    focusToday: [],
    quickWins: [],
    later: [],
  };
  return renderAgendaToMarkdown(emptyDraft, date);
}
