import { DraftAgenda, ResolvedItem, PullRequest, JiraTicket, ReconciliationResult } from "../types";
import { getTodayDate } from "./date-utils";
import { generateCursorPromptDeeplink } from "./cursor-deeplink";

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

function cursorLinkOrLabel(prompt: string): { link: string | null; tooLong: boolean } {
  const link = generateCursorPromptDeeplink(prompt);
  if (link.length > 8000) return { link: null, tooLong: true };
  return { link, tooLong: false };
}

function promptForPRAction(args: {
  prNumber: number;
  prTitle: string;
  prUrl: string;
  prBranch: string | null;
  action: "review" | "respond" | "ci" | "merge";
}): string {
  const base = `You are a senior engineer working in Cursor.

PR:
- #${args.prNumber}: ${args.prTitle}
- URL: ${args.prUrl}
${args.prBranch ? `- Branch: ${args.prBranch}\n- Checkout: git checkout ${args.prBranch}\n` : ""}

`;

  switch (args.action) {
    case "review":
      return (
        base +
        `Task:
- Do a thorough PR review. Focus on correctness, safety, tests, edge cases, and maintainability.

Output:
- A short summary
- Required changes (blockers)
- Optional suggestions (nits)
`
      );
    case "respond":
      return (
        base +
        `Task:
- Read existing review comments on this PR and draft clear responses and follow-ups.

Output:
- A bullet list of responses (by topic) and any follow-up actions to take
`
      );
    case "ci":
      return (
        base +
        `Task:
- Investigate the failing CI checks for this PR and propose a fix.

Output:
- What failed and why
- Proposed fix steps (and code changes if needed)
`
      );
    case "merge":
      return (
        base +
        `Task:
- Prepare this PR for merge: verify it’s ready, confirm checks/approvals, and identify any last risks.

Output:
- Merge readiness checklist + any remaining blockers
`
      );
  }
}

function recommendedPRAction(pr: PullRequest): {
  action: "review" | "respond" | "ci" | "merge";
  label: string;
} {
  // Highest urgency: failing CI
  if (pr.hilChecksPassing === false) {
    return { action: "ci", label: "Investigate CI failure" };
  }

  // If changes requested, respond/follow up
  if (String(pr.reviewState).toUpperCase() === "CHANGES_REQUESTED") {
    return { action: "respond", label: "Respond to requested changes" };
  }

  // If not approved yet, focus on getting it reviewed / addressing feedback
  if (!pr.hasApproval) {
    return { action: "respond", label: "Respond / request review" };
  }

  // Otherwise, it's likely ready to merge / double-check readiness
  return { action: "merge", label: "Merge readiness check" };
}

/**
 * Render PR and ticket status tables to append to the agenda.
 */
export function renderStatusTables(
  pullRequests: PullRequest[],
  tickets: JiraTicket[],
  reconciliation: ReconciliationResult,
  opts?: { includeDelegationSuggestions?: boolean }
): string {
  let markdown = "---\n\n";

  // Open Pull Requests table
  markdown += "## Open Pull Requests\n\n";
  if (pullRequests.length === 0) {
    markdown += "_No open PRs_\n\n";
  } else {
    const includeDelegate = !!opts?.includeDelegationSuggestions;
    if (includeDelegate) {
      markdown += "| PR | Title | HIL Checks | Approved | Next |\n";
      markdown += "|:---|:------|:-----------|:---------|:-----|\n";
    } else {
      markdown += "| PR | Title | HIL Checks | Approved |\n";
      markdown += "|:---|:------|:-----------|:---------|\n";
    }
    for (const pr of pullRequests) {
      const hilStatus =
        pr.hilChecksPassing === null ? "—" : pr.hilChecksPassing ? "✓ Passing" : "✗ Failing";
      const approvalStatus = pr.hasApproval ? "✓ Yes" : "✗ No";
      const jiraTag = pr.jiraId ? `[${pr.jiraId}]` : "";

      const title = `${jiraTag} ${pr.title.replace(pr.jiraId || "", "").trim()}`.trim();

      if (includeDelegate) {
        const rec = recommendedPRAction(pr);
        const prompt = promptForPRAction({
          prNumber: pr.number,
          prTitle: pr.title,
          prUrl: pr.url,
          prBranch: pr.branch,
          action: rec.action,
        });
        const link = cursorLinkOrLabel(prompt);
        const nextCell = link.link
          ? `[Delegate](${link.link}) ${rec.label}`
          : `**[Delegate]** ${rec.label}`;

        markdown += `| [#${pr.number}](${pr.url}) | ${title} | ${hilStatus} | ${approvalStatus} | ${nextCell} |\n`;
      } else {
        markdown += `| [#${pr.number}](${pr.url}) | ${title} | ${hilStatus} | ${approvalStatus} |\n`;
      }
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
        const [, checkbox, text] = taskMatch;
        const complete = checkbox.toLowerCase() === "x";
        // For check-in flows, we only want *incomplete* tasks as active items.
        if (!complete) {
          agenda[currentSection].push(text.trim());
        }
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
