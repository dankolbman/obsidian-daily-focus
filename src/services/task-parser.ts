import { Task, ActionItem, AgendaSection, AGENDA_SECTIONS } from "../types";

/**
 * Regex patterns for parsing markdown content.
 */
const PATTERNS = {
  /** Matches a task line: - [ ] or - [x] followed by text */
  task: /^-\s*\[([ xX])\]\s*(.+)$/,
  /** Matches a bullet list line (no checkbox): - item, * item, + item */
  bullet: /^[-*+]\s+(.+)$/,
  /** Matches a Jira ID: [ABC-123] */
  jiraId: /\[([A-Z]+-\d+)\]/,
  /** Matches a markdown heading (levels 1-6): # Title, ## Title, ... */
  heading: /^#{1,6}\s+(.+)$/,
  /** Matches a line that is only bold text: **Title** */
  boldLine: /^\*\*(.+)\*\*\s*$/,
};

/**
 * Section headings that contain action items (case-insensitive).
 */
const ACTION_ITEM_SECTIONS = [
  "action items",
  "suggested next steps",
  "next steps",
  "action points",
  "todos",
  "to-dos",
  "tasks",
];

/**
 * Service for parsing tasks and action items from markdown content.
 */
export class TaskParser {
  /**
   * Extract all tasks from a daily agenda file content.
   * Associates each task with its section.
   */
  parseAgendaTasks(content: string): Task[] {
    const lines = content.split("\n");
    const tasks: Task[] = [];
    let currentSection: string = "";

    for (const line of lines) {
      // Check for section heading
      const headingMatch = line.match(PATTERNS.heading);
      if (headingMatch) {
        currentSection = headingMatch[1].trim();
        continue;
      }

      // Check for task
      const taskMatch = line.match(PATTERNS.task);
      if (taskMatch) {
        const [, checkbox, text] = taskMatch;
        const complete = checkbox.toLowerCase() === "x";
        const jiraMatch = text.match(PATTERNS.jiraId);

        tasks.push({
          text: text.trim(),
          section: currentSection,
          complete,
          jiraId: jiraMatch ? jiraMatch[1] : null,
        });
      }
    }

    return tasks;
  }

  /**
   * Normalize a section title so we can compare it robustly.
   */
  private normalizeSectionTitle(sectionTitle: string): string {
    return (
      sectionTitle
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        // strip common trailing punctuation / delimiters
        .replace(/[\s:：\-–—]+$/g, "")
        .trim()
    );
  }

  /**
   * Check if a section title is an action items section.
   */
  private isActionItemSection(sectionTitle: string): boolean {
    // Be forgiving of minor formatting differences:
    // - case differences ("Suggested Next Steps")
    // - trailing punctuation ("Suggested next steps:")
    // - extra whitespace ("Suggested   next   steps")
    const normalized = this.normalizeSectionTitle(sectionTitle);

    return ACTION_ITEM_SECTIONS.some((section) => {
      // Accept exact match or "section: ..." style headings.
      return normalized === section || normalized.startsWith(section + " ");
    });
  }

  /**
   * Extract a "section title" from a line, supporting headings and common non-heading patterns.
   *
   * Important: For plain (non-heading) markers, we ONLY treat the line as a section marker
   * if it looks like an action-items heading. This avoids accidentally exiting the section
   * when we encounter normal prose lines.
   */
  private extractSectionTitleFromLine(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // Standard markdown heading (#..######)
    const headingMatch = trimmed.match(PATTERNS.heading);
    if (headingMatch) return headingMatch[1].trim();

    // Bold-only line: **Suggested next steps**
    const boldMatch = trimmed.match(PATTERNS.boldLine);
    if (boldMatch) return boldMatch[1].trim();

    // Plain standalone marker like "Suggested next steps:" (no markdown heading)
    // Only accept if it matches our action-item section names.
    if (this.isActionItemSection(trimmed)) return trimmed;

    return null;
  }

  /**
   * Extract action items from a meeting note's action items section.
   * Recognizes multiple section names: "Action items", "Suggested next steps", etc.
   */
  parseActionItems(content: string): ActionItem[] {
    const lines = content.split("\n");
    const actionItems: ActionItem[] = [];
    let inActionItemsSection = false;

    for (const line of lines) {
      // Check for section marker (heading, bold-only line, or plain standalone marker)
      const sectionTitle = this.extractSectionTitleFromLine(line);
      if (sectionTitle) {
        inActionItemsSection = this.isActionItemSection(sectionTitle);
        continue;
      }

      // If we're in the action items section, look for tasks
      if (inActionItemsSection) {
        const taskMatch = line.match(PATTERNS.task);
        if (taskMatch) {
          const [, , text] = taskMatch;
          const jiraMatch = text.match(PATTERNS.jiraId);

          actionItems.push({
            text: text.trim(),
            jiraId: jiraMatch ? jiraMatch[1] : null,
          });
          continue;
        }

        // Also accept plain bullets inside an action-items section (common in notes)
        const bulletMatch = line.match(PATTERNS.bullet);
        if (bulletMatch) {
          const [, text] = bulletMatch;
          const jiraMatch = text.match(PATTERNS.jiraId);

          actionItems.push({
            text: text.trim(),
            jiraId: jiraMatch ? jiraMatch[1] : null,
          });
        }
      }
    }

    return actionItems;
  }

  /**
   * Check if a meeting note has an action items section.
   * Recognizes multiple section names: "Action items", "Suggested next steps", etc.
   */
  hasActionItemsSection(content: string): boolean {
    const lines = content.split("\n");
    for (const line of lines) {
      const sectionTitle = this.extractSectionTitleFromLine(line);
      if (sectionTitle && this.isActionItemSection(sectionTitle)) return true;
    }
    return false;
  }

  /**
   * Extract a Jira ID from task text.
   */
  extractJiraId(text: string): string | null {
    const match = text.match(PATTERNS.jiraId);
    return match ? match[1] : null;
  }

  /**
   * Count incomplete tasks in content.
   */
  countIncompleteTasks(content: string): number {
    const tasks = this.parseAgendaTasks(content);
    return tasks.filter((t) => !t.complete).length;
  }

  /**
   * Get incomplete tasks from a specific section.
   */
  getIncompleteTasksFromSection(content: string, section: AgendaSection): Task[] {
    const tasks = this.parseAgendaTasks(content);
    return tasks.filter((t) => !t.complete && t.section === section);
  }

  /**
   * Check if a section name is a valid agenda section.
   */
  isValidAgendaSection(section: string): section is AgendaSection {
    return AGENDA_SECTIONS.includes(section as AgendaSection);
  }

  /**
   * Parse the content of all sections in an agenda file.
   * Returns a map of section name to raw content (lines between headings).
   */
  parseSectionContents(content: string): Map<string, string[]> {
    const lines = content.split("\n");
    const sections = new Map<string, string[]>();
    let currentSection: string | null = null;
    let currentLines: string[] = [];

    for (const line of lines) {
      const headingMatch = line.match(PATTERNS.heading);
      if (headingMatch) {
        // Save previous section if it exists
        if (currentSection !== null) {
          sections.set(currentSection, currentLines);
        }
        currentSection = headingMatch[1].trim();
        currentLines = [];
      } else if (currentSection !== null) {
        currentLines.push(line);
      }
    }

    // Save the last section
    if (currentSection !== null) {
      sections.set(currentSection, currentLines);
    }

    return sections;
  }
}
