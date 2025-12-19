import { App } from "obsidian";
import { VaultReader } from "./vault-reader";
import { TaskParser } from "./task-parser";
import { GitHubService, GitHubConfig } from "./github-service";
import { JiraService, JiraConfig } from "./jira-service";
import { Reconciler } from "./reconciler";
import {
  DailyAgenda,
  MeetingNote,
  MeetingNeedingAttention,
  GatheredContext,
  EnhancedContext,
  PullRequest,
  JiraTicket,
} from "../types";
import { getTodayDate } from "../utils/date-utils";

/**
 * Configuration for external integrations.
 */
export interface IntegrationConfig {
  github: GitHubConfig;
  jira: JiraConfig;
  enableGitHub: boolean;
  enableJira: boolean;
}

/**
 * Service for gathering context from the vault and external sources (Step 2).
 * Combines VaultReader, TaskParser, GitHub, and Jira to produce structured context.
 */
export class ContextGatherer {
  private vaultReader: VaultReader;
  private taskParser: TaskParser;
  private githubService: GitHubService | null = null;
  private jiraService: JiraService | null = null;
  private reconciler: Reconciler;
  private integrationConfig: IntegrationConfig | null = null;

  constructor(app: App) {
    this.vaultReader = new VaultReader(app);
    this.taskParser = new TaskParser();
    this.reconciler = new Reconciler();
  }

  /**
   * Configure external integrations.
   */
  setIntegrationConfig(config: IntegrationConfig): void {
    this.integrationConfig = config;

    if (config.enableGitHub) {
      this.githubService = new GitHubService(config.github);
    } else {
      this.githubService = null;
    }

    if (config.enableJira) {
      this.jiraService = new JiraService(config.jira);
    } else {
      this.jiraService = null;
    }
  }

  /**
   * Gather all context needed for generating a daily agenda.
   * This implements Step 2 of the application flow.
   */
  async gatherContext(
    dailyFolder: string,
    meetingsFolder: string,
    lookbackDays: number
  ): Promise<GatheredContext> {
    // Read raw files from vault
    const [rawDailyFiles, rawMeetingFiles] = await Promise.all([
      this.vaultReader.readDailyFiles(dailyFolder, lookbackDays),
      this.vaultReader.readMeetingFiles(meetingsFolder, lookbackDays),
    ]);

    // Process daily agenda files
    const recentAgendas: DailyAgenda[] = rawDailyFiles.map((file) => ({
      date: file.date,
      content: file.content,
      tasks: this.taskParser.parseAgendaTasks(file.content),
    }));

    // Process meeting note files
    const recentMeetings: MeetingNote[] = rawMeetingFiles.map((file) => {
      const hasActionItems = this.taskParser.hasActionItemsSection(file.content);
      return {
        date: file.date,
        title: file.title,
        filepath: file.filepath,
        modifiedAt: file.modifiedAt,
        hasActionItemsSection: hasActionItems,
        actionItems: hasActionItems ? this.taskParser.parseActionItems(file.content) : [],
      };
    });

    // Identify meetings needing attention
    const meetingsNeedingAttention = this.identifyMeetingsNeedingAttention(
      recentMeetings,
      rawMeetingFiles
    );

    return {
      recentAgendas,
      recentMeetings,
      meetingsNeedingAttention,
    };
  }

  /**
   * Gather enhanced context including GitHub and Jira data.
   * Falls back to basic context if integrations fail.
   */
  async gatherEnhancedContext(
    dailyFolder: string,
    meetingsFolder: string,
    lookbackDays: number
  ): Promise<EnhancedContext> {
    // First, gather basic vault context
    const baseContext = await this.gatherContext(dailyFolder, meetingsFolder, lookbackDays);

    // Fetch GitHub and Jira data in parallel
    let pullRequests: PullRequest[] = [];
    let jiraTickets: JiraTicket[] = [];

    const fetchPromises: Promise<void>[] = [];

    console.log("[DailyFocus] Integration status:", {
      githubEnabled: !!this.githubService,
      jiraEnabled: !!this.jiraService,
      config: this.integrationConfig,
    });

    if (this.githubService) {
      console.log("[DailyFocus] Fetching GitHub PRs...");
      fetchPromises.push(
        this.githubService
          .fetchOpenPRs()
          .then((prs) => {
            pullRequests = prs;
            console.log("[DailyFocus] Fetched", prs.length, "PRs from GitHub");
          })
          .catch((error) => {
            console.error("[DailyFocus] Failed to fetch GitHub PRs:", error);
            console.error("[DailyFocus] GitHub error details:", error.message, error.stack);
          })
      );
    } else {
      console.log("[DailyFocus] GitHub service not initialized - check settings");
    }

    if (this.jiraService) {
      console.log("[DailyFocus] Fetching Jira tickets...");
      fetchPromises.push(
        this.jiraService
          .fetchActiveTickets()
          .then((tickets) => {
            jiraTickets = tickets;
            console.log("[DailyFocus] Fetched", tickets.length, "tickets from Jira");
          })
          .catch((error) => {
            console.error("[DailyFocus] Failed to fetch Jira tickets:", error);
            console.error("[DailyFocus] Jira error details:", error.message, error.stack);
          })
      );
    } else {
      console.log("[DailyFocus] Jira service not initialized - check settings");
    }

    // Wait for all fetches to complete
    await Promise.all(fetchPromises);

    // Reconcile PRs with tickets
    const reconciliation = this.reconciler.reconcile(pullRequests, jiraTickets);

    // Update jiraTickets with linked PR info from reconciliation
    const updatedTickets = jiraTickets.map((ticket) => {
      const matched = reconciliation.matchedTickets.find((t) => t.key === ticket.key);
      return matched || ticket;
    });

    return {
      ...baseContext,
      pullRequests,
      jiraTickets: updatedTickets,
      reconciliation,
    };
  }

  /**
   * Identify meetings that may need user attention before generating agenda.
   * Criteria:
   * - No action items section
   * - Created today and not yet modified (empty/template only)
   */
  private identifyMeetingsNeedingAttention(
    meetings: MeetingNote[],
    rawFiles: { date: string; modifiedAt: Date; filepath: string }[]
  ): MeetingNeedingAttention[] {
    const needingAttention: MeetingNeedingAttention[] = [];
    const today = getTodayDate();

    for (let i = 0; i < meetings.length; i++) {
      const meeting = meetings[i];
      const rawFile = rawFiles[i];

      // Check for missing action items section
      if (!meeting.hasActionItemsSection) {
        needingAttention.push({
          filepath: meeting.filepath,
          reason: "No action items section found",
        });
        continue;
      }

      // Check for today's meeting that hasn't been modified
      // (likely just created from template)
      if (meeting.date === today) {
        const createdAt = rawFile.modifiedAt;
        const now = new Date();
        const timeSinceCreation = now.getTime() - createdAt.getTime();
        const fiveMinutes = 5 * 60 * 1000;

        // If the file is very new and has no action items, flag it
        if (timeSinceCreation < fiveMinutes && meeting.actionItems.length === 0) {
          needingAttention.push({
            filepath: meeting.filepath,
            reason: "Created today, not yet updated with action items",
          });
        }
      }
    }

    return needingAttention;
  }

  /**
   * Get the VaultReader instance for direct file operations.
   */
  getVaultReader(): VaultReader {
    return this.vaultReader;
  }

  /**
   * Get the TaskParser instance for direct parsing operations.
   */
  getTaskParser(): TaskParser {
    return this.taskParser;
  }

  /**
   * Check if GitHub integration is enabled and working.
   */
  async checkGitHubAuth(): Promise<boolean> {
    if (!this.githubService) return false;
    return this.githubService.checkAuth();
  }

  /**
   * Check if Jira integration is enabled and working.
   */
  async checkJiraAuth(): Promise<boolean> {
    if (!this.jiraService) return false;
    return this.jiraService.checkAuth();
  }
}
