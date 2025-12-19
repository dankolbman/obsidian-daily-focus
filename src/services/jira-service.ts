import { JiraTicket } from "../types";
import { execSync } from "child_process";

/**
 * Configuration for the Jira service.
 */
export interface JiraConfig {
  /** Jira project key (e.g., "FSW") */
  projectKey: string;
  /** Jira instance URL (e.g., "https://yourcompany.atlassian.net") */
  baseUrl: string;
  /** Path to the jira CLI (default: "jira") */
  cliPath: string;
}

/**
 * Service for fetching Jira data via the jira CLI.
 */
export class JiraService {
  private config: JiraConfig;

  constructor(config: JiraConfig) {
    this.config = config;
  }

  /**
   * Update configuration.
   */
  setConfig(config: Partial<JiraConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Resolve the full path to the jira CLI.
   */
  private resolveCliPath(): string {
    const configPath = this.config.cliPath || "jira";

    // If it's already an absolute path, use it directly
    if (configPath.startsWith("/")) {
      return configPath;
    }

    // Try to resolve using 'which' command
    try {
      const resolvedPath = execSync(`which ${configPath}`, {
        encoding: "utf-8",
        shell: true,
      }).trim();

      if (resolvedPath) {
        return resolvedPath;
      }
    } catch {
      // 'which' failed, try common locations
    }

    // Try common installation locations
    const commonPaths = [
      `/opt/homebrew/bin/${configPath}`,
      `/usr/local/bin/${configPath}`,
      `${process.env.HOME}/.local/bin/${configPath}`,
      `${process.env.HOME}/go/bin/${configPath}`, // go-jira installs here
    ];

    for (const path of commonPaths) {
      try {
        execSync(`test -x "${path}"`, { shell: true });
        return path;
      } catch {
        // Path doesn't exist or isn't executable, try next
      }
    }

    console.warn("[DailyFocus] Could not find jira CLI, using configured path:", configPath);
    return configPath;
  }

  /**
   * Execute a jira CLI command and return the output.
   */
  private execJira(args: string[]): string {
    const cliPath = this.resolveCliPath();
    const cmd = `${cliPath} ${args.join(" ")}`;

    try {
      const output = execSync(cmd, {
        encoding: "utf-8",
        shell: true,
        timeout: 30000, // 30 second timeout
      });
      return output;
    } catch (error) {
      console.error("[DailyFocus] jira command failed:", cmd, error);
      throw error;
    }
  }

  /**
   * Build the ticket URL from the key.
   */
  private buildTicketUrl(key: string): string {
    const baseUrl = this.config.baseUrl.replace(/\/$/, "");
    return `${baseUrl}/browse/${key}`;
  }

  /**
   * Fetch all in-progress and in-review tickets assigned to the current user.
   */
  async fetchActiveTickets(): Promise<JiraTicket[]> {
    console.log("[DailyFocus] Fetching active Jira tickets for project", this.config.projectKey);

    try {
      // Build JQL query for in-progress and in-review tickets
      const jql = `project = ${this.config.projectKey} AND assignee = currentUser() AND status IN ("In Progress", "In Review") ORDER BY updated DESC`;

      // Execute jira CLI to list issues
      // The jira-cli (go-jira) uses this format:
      const output = this.execJira([
        "issue",
        "list",
        "--jql",
        `"${jql}"`,
        "--plain",
        "--columns",
        "key,summary,status",
        "--no-headers",
      ]);

      const tickets: JiraTicket[] = [];
      const lines = output.trim().split("\n").filter(Boolean);

      for (const line of lines) {
        // Parse tab-separated output: key, summary, status
        const parts = line.split("\t");
        if (parts.length >= 3) {
          const [key, summary, status] = parts;
          tickets.push({
            key: key.trim(),
            summary: summary.trim(),
            status: status.trim(),
            url: this.buildTicketUrl(key.trim()),
            hasLinkedPR: false, // Will be set by reconciler
            linkedPRNumber: null,
          });
        }
      }

      console.log("[DailyFocus] Found", tickets.length, "active tickets");
      return tickets;
    } catch {
      // Try alternative jira CLI format (Atlassian CLI)
      console.log("[DailyFocus] Trying alternative jira CLI format...");
      return this.fetchActiveTicketsAlternative();
    }
  }

  /**
   * Alternative method using Atlassian's jira CLI or other formats.
   */
  private async fetchActiveTicketsAlternative(): Promise<JiraTicket[]> {
    try {
      const jql = `project = ${this.config.projectKey} AND assignee = currentUser() AND status IN ("In Progress", "In Review")`;

      // Try JSON output format
      const output = this.execJira(["issue", "list", "-q", `"${jql}"`, "--json"]);

      const issues = JSON.parse(output) as Array<{
        key: string;
        fields: {
          summary: string;
          status: {
            name: string;
          };
        };
      }>;

      return issues.map((issue) => ({
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        url: this.buildTicketUrl(issue.key),
        hasLinkedPR: false,
        linkedPRNumber: null,
      }));
    } catch (error) {
      console.error("[DailyFocus] All jira CLI formats failed:", error);
      // Return empty array if Jira CLI fails (don't block the workflow)
      console.log("[DailyFocus] Continuing without Jira data");
      return [];
    }
  }

  /**
   * Check if the jira CLI is configured.
   */
  async checkAuth(): Promise<boolean> {
    try {
      // Try a simple command to verify authentication
      this.execJira(["me"]);
      return true;
    } catch {
      // Try alternative
      try {
        this.execJira(["myself"]);
        return true;
      } catch {
        return false;
      }
    }
  }
}
