import { requestUrl, RequestUrlResponse } from "obsidian";
import {
  GatheredContext,
  EnhancedContext,
  LLMTriageResponse,
  DraftAgenda,
  UnclearItem,
  ResolvedItem,
} from "../types";
import { getTodayDate } from "../utils/date-utils";
import { spawn, execSync } from "child_process";

/**
 * System prompt for the LLM triage scan.
 * Simplified 3-section format with bias towards delegation and quick wins.
 */
const SYSTEM_PROMPT = `You are a daily planning assistant. Create a focused, low-friction daily agenda.

SECTIONS (only 3):
1. Focus today: MAXIMUM 3 important tasks. Be ruthless—only truly critical items.
2. Quick wins: Small tasks (<15 min), delegations, quick actions. BIAS TOWARDS THIS SECTION.
   - If a task can be delegated, put it here with "→ Person Name" format
   - If a task is small or can be made small, put it here
3. Later: Everything else. Blocked items, deferred tasks, low priority.

PHILOSOPHY:
- Less is more. A short list gets done; a long list causes paralysis.
- When in doubt, make it a quick win or delegate it.
- Delegating IS completing—move things off your plate.
- Preserve Jira IDs like [FSW-1234] in task text.

INPUT CONTEXT:
- User's focus: What the user says they're working on today (prioritize this!)
- Recent agendas: Look for incomplete tasks (- [ ])
- Meeting notes: Extract action items not yet in agendas
- GitHub PRs: Consider PR reviews and merges as potential tasks
- Jira tickets: In-progress work that needs attention

RULES:
- Do not include completed tasks (- [x])
- Do not duplicate tasks
- Flag tasks that have been incomplete for 3+ days as "unclear"

OUTPUT FORMAT (JSON only, no other text):
{
  "draft_agenda": {
    "focus_today": ["task 1", "task 2"],
    "quick_wins": ["small task", "delegate this → Alice", "quick review"],
    "later": ["deferred item — reason"]
  },
  "unclear_items": [
    {
      "task": "stale task text",
      "source": "daily/2024-12-15.md",
      "reason": "Incomplete for 4 days",
      "question": "Is this still needed?"
    }
  ],
  "suggestions": ["Consider delegating X to Y"]
}`;

/**
 * System prompt for refining the agenda based on user clarifications.
 */
const REFINEMENT_SYSTEM_PROMPT = `You are a daily planning assistant. The user has clarified some unclear items from their initial draft agenda. 
Synthesize their responses into a refined, final agenda.

INPUT:
- Initial draft agenda (categorized tasks)
- User clarifications for unclear items (their response and resolution)

YOUR JOB:
1. Process each user clarification:
   - "done" or "drop" → Remove from all sections
   - "focus_today" → Add to Focus today (max 3 total, bump others to Quick wins if needed)
   - "quick_win" → Add to Quick wins
   - "later" → Add to Later section
2. Incorporate any context the user provided (e.g., delegation targets, updated task wording)
3. If the user's response suggests a task should be reworded, update it
4. Keep the agenda minimal and actionable

RULES:
- Maximum 3 items in Focus today
- If Focus today would exceed 3, move lowest priority to Quick wins
- Preserve Jira IDs like [FSW-1234]
- Use "→ Person" format for delegations

OUTPUT FORMAT (JSON only):
{
  "draft_agenda": {
    "focus_today": ["task 1", "task 2"],
    "quick_wins": ["task → Alice", "small task"],
    "later": ["deferred — reason"]
  },
  "suggestions": ["Optional: any observations about the refined plan"]
}`;

export type LLMProvider = "api" | "cli";

export interface LLMConfig {
  provider: LLMProvider;
  apiKey?: string;
  model?: string;
  cliPath?: string;
}

/**
 * Service for interacting with Claude via API or CLI.
 */
export class LLMService {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  /**
   * Update configuration.
   */
  setConfig(config: Partial<LLMConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if context has enhanced data (GitHub/Jira).
   */
  private isEnhancedContext(context: GatheredContext): context is EnhancedContext {
    return "pullRequests" in context && "jiraTickets" in context;
  }

  /**
   * Build the user prompt from gathered context.
   */
  buildUserPrompt(context: GatheredContext | EnhancedContext): string {
    const today = getTodayDate();
    let prompt = `Today's date: ${today}\n\n`;

    // Debug logging for context
    console.log("[DailyFocus] Building prompt with context:");
    console.log("[DailyFocus] - Recent agendas:", context.recentAgendas.length);
    console.log("[DailyFocus] - Recent meetings:", context.recentMeetings.length);

    if (context.recentMeetings.length > 0) {
      console.log("[DailyFocus] Meeting details:");
      for (const meeting of context.recentMeetings) {
        console.log(
          `[DailyFocus]   - ${meeting.title} (${meeting.date}): ${meeting.actionItems.length} action items, hasActionItemsSection=${meeting.hasActionItemsSection}`
        );
      }
    }

    // Add recent daily agendas
    prompt += "## Recent daily agendas (most recent first):\n\n";
    if (context.recentAgendas.length === 0) {
      prompt += "_No recent agendas found._\n\n";
    } else {
      for (const agenda of context.recentAgendas) {
        prompt += `### ${agenda.date}\n${agenda.content}\n\n`;
      }
    }

    // Add recent meeting notes
    prompt += "## Recent meeting notes:\n\n";
    if (context.recentMeetings.length === 0) {
      prompt += "_No recent meeting notes found._\n\n";
    } else {
      for (const meeting of context.recentMeetings) {
        prompt += `### ${meeting.title} — ${meeting.date}\n`;
        if (meeting.actionItems.length > 0) {
          prompt += "Action items:\n";
          for (const item of meeting.actionItems) {
            prompt += `- [ ] ${item.text}\n`;
          }
        } else if (!meeting.hasActionItemsSection) {
          prompt += "_No action items section._\n";
        } else {
          prompt += "_No action items._\n";
        }
        prompt += "\n";
      }
    }

    // Add GitHub and Jira context if available
    if (this.isEnhancedContext(context)) {
      // Add user's focus input if provided
      if (context.userFocusInput && context.userFocusInput.trim()) {
        prompt += "## User's focus for today:\n\n";
        prompt += context.userFocusInput.trim() + "\n\n";
        console.log("[DailyFocus] - User focus input provided");
      }

      console.log("[DailyFocus] - Pull requests:", context.pullRequests.length);
      console.log("[DailyFocus] - Jira tickets:", context.jiraTickets.length);

      // Add open PRs
      prompt += "## Open Pull Requests:\n\n";
      if (context.pullRequests.length === 0) {
        prompt += "_No open PRs._\n\n";
      } else {
        for (const pr of context.pullRequests) {
          const hilStatus =
            pr.hilChecksPassing === null ? "pending" : pr.hilChecksPassing ? "passing" : "failing";
          const approval = pr.hasApproval ? "approved" : "needs review";
          prompt += `- PR #${pr.number}: ${pr.title} (HIL: ${hilStatus}, ${approval})\n`;
        }
        prompt += "\n";
      }

      // Add Jira tickets
      prompt += "## In-Progress Jira Tickets:\n\n";
      if (context.jiraTickets.length === 0) {
        prompt += "_No in-progress tickets._\n\n";
      } else {
        for (const ticket of context.jiraTickets) {
          const prLink = ticket.linkedPRNumber ? `PR #${ticket.linkedPRNumber}` : "no PR";
          prompt += `- [${ticket.key}] ${ticket.summary} (${ticket.status}, ${prLink})\n`;
        }
        prompt += "\n";
      }

      // Add reconciliation warnings
      if (context.reconciliation.warnings.length > 0) {
        prompt += "## Reconciliation Warnings:\n\n";
        for (const warning of context.reconciliation.warnings) {
          prompt += `- ⚠️ ${warning.message}\n`;
        }
        prompt += "\n";
      }
    }

    prompt += "Generate today's draft agenda and identify any items needing clarification.";

    // Log the full prompt for debugging
    console.log("[DailyFocus] Full prompt being sent:\n", prompt);

    return prompt;
  }

  /**
   * Send a triage request and get the draft agenda.
   * Uses either the API or CLI based on configuration.
   */
  async triageScan(context: GatheredContext): Promise<LLMTriageResponse> {
    console.log("[DailyFocus] Starting triage scan with provider:", this.config.provider);
    console.log("[DailyFocus] Config:", {
      provider: this.config.provider,
      model: this.config.model,
      cliPath: this.config.cliPath,
      hasApiKey: !!this.config.apiKey,
    });

    if (this.config.provider === "cli") {
      return this.triageScanViaCLI(context);
    } else {
      return this.triageScanViaAPI(context);
    }
  }

  /**
   * Resolve the full path to the claude CLI.
   */
  private resolveCliPath(configPath: string): string {
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
      `/usr/local/bin/${configPath}`,
      `/opt/homebrew/bin/${configPath}`,
      `${process.env.HOME}/.local/bin/${configPath}`,
      `${process.env.HOME}/.npm-global/bin/${configPath}`,
    ];

    // Also scan nvm directories dynamically
    const nvmDir = `${process.env.HOME}/.nvm/versions/node`;
    try {
      const nvmVersions = execSync(`ls "${nvmDir}" 2>/dev/null || true`, {
        encoding: "utf-8",
        shell: true,
      })
        .trim()
        .split("\n")
        .filter(Boolean);

      for (const version of nvmVersions) {
        commonPaths.push(`${nvmDir}/${version}/bin/${configPath}`);
      }
    } catch {
      // nvm not installed, skip
    }

    for (const path of commonPaths) {
      try {
        execSync(`test -x "${path}"`, { shell: true });
        return path;
      } catch {
        // Path doesn't exist or isn't executable, try next
      }
    }

    // Fall back to the original path
    console.warn("[DailyFocus] Could not find CLI, using configured path:", configPath);
    return configPath;
  }

  /**
   * Execute triage scan via the claude CLI.
   */
  private async triageScanViaCLI(context: GatheredContext): Promise<LLMTriageResponse> {
    const userPrompt = this.buildUserPrompt(context);
    const configPath = this.config.cliPath || "claude";
    const cliPath = this.resolveCliPath(configPath);

    console.log("[DailyFocus] CLI mode - using path:", cliPath);
    console.log("[DailyFocus] User prompt length:", userPrompt.length, "chars");

    return new Promise((resolve, reject) => {
      const args = [
        "--print", // Print response without interactive mode
        "--output-format",
        "text",
      ];

      // Add system prompt
      args.push("--system-prompt", SYSTEM_PROMPT);

      console.debug("[DailyFocus] Spawning CLI with args:", args.join(" "));

      // Build PATH that includes the directory containing the CLI (for nvm setups)
      const cliDir = cliPath.substring(0, cliPath.lastIndexOf("/"));
      const enhancedPath = `${cliDir}:${process.env.PATH || ""}`;
      console.log("[DailyFocus] Enhanced PATH includes:", cliDir);

      const proc = spawn(cliPath, args, {
        env: {
          ...process.env,
          PATH: enhancedPath,
        },
        shell: false,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
        console.log("[DailyFocus] CLI stderr:", data.toString());
      });

      // Send the user prompt via stdin
      proc.stdin.write(userPrompt);
      proc.stdin.end();

      proc.on("close", (code: number) => {
        console.log("[DailyFocus] CLI exited with code:", code);
        console.log("[DailyFocus] CLI stdout length:", stdout.length, "chars");
        if (stderr) {
          console.log("[DailyFocus] CLI stderr:", stderr);
        }

        if (code !== 0) {
          const error = new Error(`claude CLI exited with code ${code}: ${stderr}`);
          console.error("[DailyFocus] CLI error:", error);
          reject(error);
          return;
        }

        try {
          console.log(
            "[DailyFocus] CLI raw response:",
            stdout.substring(0, 500) + (stdout.length > 500 ? "..." : "")
          );
          const response = this.parseResponse(stdout);
          console.log("[DailyFocus] CLI parsed response successfully");
          resolve(response);
        } catch (error) {
          console.error("[DailyFocus] Failed to parse CLI response:", error);
          console.error("[DailyFocus] Full stdout was:", stdout);
          reject(new Error(`Failed to parse CLI response: ${error}`));
        }
      });

      proc.on("error", (error: Error) => {
        console.error("[DailyFocus] CLI spawn error:", error);
        reject(
          new Error(
            `Failed to execute claude CLI: ${error.message}. Make sure 'claude' is installed and in your PATH.`
          )
        );
      });
    });
  }

  /**
   * Execute triage scan via the Anthropic API.
   */
  private async triageScanViaAPI(context: GatheredContext): Promise<LLMTriageResponse> {
    if (!this.config.apiKey) {
      throw new Error(
        "Anthropic API key not configured. Please set it in the plugin settings or switch to CLI mode."
      );
    }

    const userPrompt = this.buildUserPrompt(context);
    const model = this.config.model || "claude-sonnet-4-20250514";

    console.log("[DailyFocus] API mode - using model:", model);
    console.log("[DailyFocus] User prompt length:", userPrompt.length, "chars");

    const requestBody = {
      model: model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    };

    let response: RequestUrlResponse;
    try {
      console.log("[DailyFocus] Sending API request to Anthropic...");
      response = await requestUrl({
        url: "https://api.anthropic.com/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(requestBody),
      });
      console.log("[DailyFocus] API response status:", response.status);
    } catch (error) {
      console.error("[DailyFocus] API connection error:", error);
      throw new Error(`Failed to connect to Anthropic API: ${error}`);
    }

    if (response.status !== 200) {
      const errorBody = response.json;
      console.error("[DailyFocus] API error response:", errorBody);
      const errorMessage = errorBody?.error?.message || `HTTP ${response.status}`;
      throw new Error(`Anthropic API error: ${errorMessage}`);
    }

    const responseBody = response.json;
    console.log("[DailyFocus] API response body:", JSON.stringify(responseBody).substring(0, 500));
    const content = responseBody?.content?.[0]?.text;

    if (!content) {
      console.error("[DailyFocus] Empty API response. Full body:", responseBody);
      throw new Error("Empty response from Anthropic API");
    }

    try {
      console.log(
        "[DailyFocus] API raw content:",
        content.substring(0, 500) + (content.length > 500 ? "..." : "")
      );
      const parsed = this.parseResponse(content);
      console.log("[DailyFocus] API parsed response successfully");
      return parsed;
    } catch (error) {
      console.error("[DailyFocus] Failed to parse API response:", error);
      console.error("[DailyFocus] Full content was:", content);
      throw error;
    }
  }

  /**
   * Parse the LLM response JSON into structured data.
   */
  private parseResponse(content: string): LLMTriageResponse {
    // Extract JSON from the response (in case there's extra text)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Could not find JSON in LLM response");
    }

    let parsed: {
      draft_agenda?: {
        focus_today?: string[];
        quick_wins?: string[];
        later?: string[];
      };
      unclear_items?: Array<{
        task?: string;
        source?: string;
        reason?: string;
        question?: string;
      }>;
      suggestions?: string[];
    };

    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (error) {
      throw new Error(`Failed to parse LLM response as JSON: ${error}`);
    }

    // Validate and transform the response (simplified 3-section format)
    const draftAgenda: DraftAgenda = {
      focusToday: (parsed.draft_agenda?.focus_today || []).slice(0, 3), // Max 3 items
      quickWins: parsed.draft_agenda?.quick_wins || [],
      later: parsed.draft_agenda?.later || [],
    };

    const unclearItems: UnclearItem[] = (parsed.unclear_items || []).map((item) => ({
      task: item.task || "",
      source: item.source || "",
      reason: item.reason || "",
      question: item.question || "What's the current status?",
    }));

    const suggestions: string[] = parsed.suggestions || [];

    return {
      draftAgenda,
      unclearItems,
      suggestions,
    };
  }

  /**
   * Retry a triage scan with exponential backoff.
   */
  async triageScanWithRetry(
    context: GatheredContext,
    maxRetries: number = 2
  ): Promise<LLMTriageResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.triageScan(context);
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries) {
          // Wait before retrying (exponential backoff)
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Build a prompt for the refinement step.
   */
  private buildRefinementPrompt(
    initialDraft: DraftAgenda,
    unclearItems: UnclearItem[],
    resolvedItems: ResolvedItem[]
  ): string {
    let prompt = "## Initial Draft Agenda\n\n";

    prompt += "### Focus today\n";
    for (const task of initialDraft.focusToday) {
      prompt += `- ${task}\n`;
    }

    prompt += "\n### Quick wins\n";
    for (const task of initialDraft.quickWins) {
      prompt += `- ${task}\n`;
    }

    prompt += "\n### Later\n";
    for (const task of initialDraft.later) {
      prompt += `- ${task}\n`;
    }

    prompt += "\n## User Clarifications\n\n";

    for (const resolved of resolvedItems) {
      // Find the original unclear item to get the question
      const original = unclearItems.find((u) => u.task === resolved.task);

      prompt += `### Task: ${resolved.task}\n`;
      if (original) {
        prompt += `Question asked: ${original.question}\n`;
      }
      prompt += `User's answer: "${resolved.context || resolved.resolution}"\n`;
      prompt += `Resolution: ${resolved.resolution}\n\n`;
    }

    return prompt;
  }

  /**
   * Refine the agenda based on user clarifications.
   * Calls the LLM to synthesize user inputs into a final agenda.
   */
  async refineAgenda(
    initialDraft: DraftAgenda,
    unclearItems: UnclearItem[],
    resolvedItems: ResolvedItem[]
  ): Promise<{ draftAgenda: DraftAgenda; suggestions: string[] }> {
    console.log("[DailyFocus] Refining agenda with", resolvedItems.length, "user clarifications");

    const userPrompt = this.buildRefinementPrompt(initialDraft, unclearItems, resolvedItems);

    if (this.config.provider === "cli") {
      return this.refineViaCLI(userPrompt);
    } else {
      return this.refineViaAPI(userPrompt);
    }
  }

  /**
   * Call CLI for refinement.
   */
  private async refineViaCLI(
    userPrompt: string
  ): Promise<{ draftAgenda: DraftAgenda; suggestions: string[] }> {
    console.log("[DailyFocus] Refining via CLI");

    const configPath = this.config.cliPath || "claude";
    const cliPath = this.resolveCliPath(configPath);
    const pathDir = cliPath.substring(0, cliPath.lastIndexOf("/"));

    const args = [
      "--print",
      "--output-format",
      "text",
      "--system-prompt",
      REFINEMENT_SYSTEM_PROMPT,
    ];

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      // Build PATH that includes the directory containing the CLI
      const enhancedPath = `${pathDir}:${process.env.PATH || ""}`;

      const proc = spawn(cliPath, args, {
        env: {
          ...process.env,
          PATH: enhancedPath,
        },
        shell: false,
      });

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
        console.log("[DailyFocus] Refinement CLI stderr:", data.toString());
      });

      // Send the user prompt via stdin (like the original CLI call)
      proc.stdin.write(userPrompt);
      proc.stdin.end();

      proc.on("error", (error: Error) => {
        console.error("[DailyFocus] Refinement CLI spawn error:", error);
        reject(new Error(`Failed to spawn CLI: ${error.message}`));
      });

      proc.on("close", (code: number) => {
        console.log("[DailyFocus] Refinement CLI exited with code:", code);

        if (code !== 0) {
          console.error("[DailyFocus] Refinement CLI error:", stderr);
          reject(new Error(`CLI exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          console.log("[DailyFocus] Refinement CLI response:", stdout.substring(0, 300) + "...");
          const result = this.parseRefinementResponse(stdout);
          resolve(result);
        } catch (error) {
          console.error("[DailyFocus] Failed to parse refinement response:", error);
          console.error("[DailyFocus] Full stdout was:", stdout);
          reject(error);
        }
      });
    });
  }

  /**
   * Call API for refinement.
   */
  private async refineViaAPI(
    userPrompt: string
  ): Promise<{ draftAgenda: DraftAgenda; suggestions: string[] }> {
    console.log("[DailyFocus] Refining via API");

    if (!this.config.apiKey) {
      throw new Error("API key not configured");
    }

    const requestBody = {
      model: this.config.model || "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: REFINEMENT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    };

    const response: RequestUrlResponse = await requestUrl({
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
    });

    if (response.status !== 200) {
      throw new Error(`API error: HTTP ${response.status}`);
    }

    const content = response.json?.content?.[0]?.text;
    if (!content) {
      throw new Error("Empty response from API");
    }

    return this.parseRefinementResponse(content);
  }

  /**
   * Parse the refinement response.
   */
  private parseRefinementResponse(content: string): {
    draftAgenda: DraftAgenda;
    suggestions: string[];
  } {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Could not find JSON in refinement response");
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      draft_agenda?: {
        focus_today?: string[];
        quick_wins?: string[];
        later?: string[];
      };
      suggestions?: string[];
    };

    const draftAgenda: DraftAgenda = {
      focusToday: (parsed.draft_agenda?.focus_today || []).slice(0, 3),
      quickWins: parsed.draft_agenda?.quick_wins || [],
      later: parsed.draft_agenda?.later || [],
    };

    return {
      draftAgenda,
      suggestions: parsed.suggestions || [],
    };
  }
}
