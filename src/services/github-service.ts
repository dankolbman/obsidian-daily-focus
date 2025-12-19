import { PullRequest } from "../types";
import { execSync } from "child_process";

/**
 * Configuration for the GitHub service.
 */
export interface GitHubConfig {
  /** GitHub repo in org/repo format (e.g., "ZiplineTeam/FlightSystems") */
  repo: string;
  /** Path to the gh CLI (default: "gh") */
  cliPath: string;
}

/**
 * Service for fetching GitHub data via the gh CLI.
 */
export class GitHubService {
  private config: GitHubConfig;

  constructor(config: GitHubConfig) {
    this.config = config;
  }

  /**
   * Update configuration.
   */
  setConfig(config: Partial<GitHubConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Resolve the full path to the gh CLI.
   */
  private resolveCliPath(): string {
    const configPath = this.config.cliPath || "gh";

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
    ];

    for (const path of commonPaths) {
      try {
        execSync(`test -x "${path}"`, { shell: true });
        return path;
      } catch {
        // Path doesn't exist or isn't executable, try next
      }
    }

    console.warn("[DailyFocus] Could not find gh CLI, using configured path:", configPath);
    return configPath;
  }

  /**
   * Execute a gh CLI command and return the output.
   */
  private execGh(args: string[]): string {
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
      console.error("[DailyFocus] gh command failed:", cmd, error);
      throw error;
    }
  }

  /**
   * Extract Jira ID from PR title (e.g., "[FSW-1234]" or "FSW-1234").
   */
  private extractJiraId(title: string): string | null {
    const match = title.match(/\[?(FSW-\d+)\]?/i);
    return match ? match[1].toUpperCase() : null;
  }

  /**
   * Fetch all open PRs authored by the current user in the configured repo.
   */
  async fetchOpenPRs(): Promise<PullRequest[]> {
    console.log("[DailyFocus] Fetching open PRs from", this.config.repo);

    try {
      // Get list of open PRs authored by current user
      const listOutput = this.execGh([
        "pr",
        "list",
        "--repo",
        this.config.repo,
        "--author",
        "@me",
        "--state",
        "open",
        "--json",
        "number,title,url,state",
      ]);

      const prList = JSON.parse(listOutput) as Array<{
        number: number;
        title: string;
        url: string;
        state: string;
      }>;

      console.log("[DailyFocus] Found", prList.length, "open PRs");

      // For each PR, get detailed status
      const pullRequests: PullRequest[] = [];

      for (const pr of prList) {
        try {
          const detailOutput = this.execGh([
            "pr",
            "view",
            pr.number.toString(),
            "--repo",
            this.config.repo,
            "--json",
            "statusCheckRollup,reviews,reviewDecision",
          ]);

          const details = JSON.parse(detailOutput) as {
            statusCheckRollup?: Array<{
              name: string;
              status: string;
              conclusion: string | null;
            }>;
            reviews?: Array<{
              state: string;
              author: { login: string };
            }>;
            reviewDecision?: string;
          };

          // Check HIL checks status
          const hilCheck = details.statusCheckRollup?.find(
            (check) =>
              check.name &&
              (check.name.toLowerCase().includes("required_hil_checks") ||
                check.name.toLowerCase().includes("hil"))
          );

          let hilChecksPassing: boolean | null = null;
          if (hilCheck) {
            if (hilCheck.status === "COMPLETED") {
              hilChecksPassing = hilCheck.conclusion === "SUCCESS";
            } else {
              hilChecksPassing = null; // Still running
            }
          }

          // Check for approvals
          const hasApproval =
            details.reviewDecision === "APPROVED" ||
            (details.reviews?.some((r) => r.state === "APPROVED") ?? false);

          // Determine review state
          let reviewState = "PENDING";
          if (details.reviewDecision) {
            reviewState = details.reviewDecision;
          } else if (details.reviews && details.reviews.length > 0) {
            const lastReview = details.reviews[details.reviews.length - 1];
            reviewState = lastReview.state;
          }

          pullRequests.push({
            number: pr.number,
            title: pr.title,
            url: pr.url,
            jiraId: this.extractJiraId(pr.title),
            hilChecksPassing,
            hasApproval,
            reviewState,
            state: pr.state,
          });
        } catch (detailError) {
          console.warn("[DailyFocus] Failed to get details for PR #" + pr.number, detailError);
          // Add PR with minimal info
          pullRequests.push({
            number: pr.number,
            title: pr.title,
            url: pr.url,
            jiraId: this.extractJiraId(pr.title),
            hilChecksPassing: null,
            hasApproval: false,
            reviewState: "UNKNOWN",
            state: pr.state,
          });
        }
      }

      return pullRequests;
    } catch (error) {
      console.error("[DailyFocus] Failed to fetch PRs:", error);
      throw new Error(`Failed to fetch GitHub PRs: ${error}`);
    }
  }

  /**
   * Check if the gh CLI is authenticated.
   */
  async checkAuth(): Promise<boolean> {
    try {
      this.execGh(["auth", "status"]);
      return true;
    } catch {
      return false;
    }
  }
}
