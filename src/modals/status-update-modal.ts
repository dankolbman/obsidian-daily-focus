import { App, Modal } from "obsidian";
import { UnclearItem, ResolvedItem, ResolutionType } from "../types";

/**
 * Modal for resolving unclear items identified by the LLM.
 * Uses a conversational approach - shows the question and lets user answer freely.
 */
export class StatusUpdateModal extends Modal {
  private unclearItems: UnclearItem[];
  private currentIndex: number = 0;
  private resolvedItems: ResolvedItem[] = [];
  private resolvePromise: ((result: ResolvedItem[]) => void) | null = null;

  // Form state
  private answerInput: string = "";
  private selectedResolution: ResolutionType = "focus_today";

  constructor(app: App, unclearItems: UnclearItem[]) {
    super(app);
    this.unclearItems = unclearItems;
  }

  /**
   * Show the modal and collect resolutions for all unclear items.
   * Returns array of resolved items.
   */
  async prompt(): Promise<ResolvedItem[]> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  onOpen() {
    this.renderCurrentItem();
  }

  private renderCurrentItem() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("daily-focus-modal");
    contentEl.addClass("daily-focus-status-modal");

    const item = this.unclearItems[this.currentIndex];

    // Progress indicator
    contentEl.createEl("div", {
      text: `Question ${this.currentIndex + 1} of ${this.unclearItems.length}`,
      cls: "daily-focus-progress",
    });

    // Task display (smaller, context)
    const taskContainer = contentEl.createDiv({ cls: "daily-focus-task-container" });
    taskContainer.createEl("div", {
      text: item.task,
      cls: "daily-focus-task-text",
    });
    taskContainer.createEl("div", {
      text: `${item.reason} • from ${item.source}`,
      cls: "daily-focus-task-meta",
    });

    // Question (prominent)
    contentEl.createEl("h3", {
      text: item.question,
      cls: "daily-focus-question-heading",
    });

    // Free-text answer input
    const answerContainer = contentEl.createDiv({ cls: "daily-focus-answer-container" });
    const answerTextarea = answerContainer.createEl("textarea", {
      cls: "daily-focus-answer-input",
      attr: {
        rows: "3",
        placeholder:
          "Type your answer... (e.g., 'Done, shipped last week' or 'Still working on it, high priority' or 'Delegate to Alice')",
      },
    });
    answerTextarea.value = this.answerInput;
    answerTextarea.addEventListener("input", (e) => {
      this.answerInput = (e.target as HTMLTextAreaElement).value;
    });

    // Quick action buttons
    const quickActionsContainer = contentEl.createDiv({ cls: "daily-focus-quick-actions" });
    quickActionsContainer.createEl("span", { text: "Quick: ", cls: "daily-focus-quick-label" });

    const quickActions = [
      { label: "✓ Done", answer: "Done, completed", resolution: "done" as ResolutionType },
      {
        label: "→ Focus",
        answer: "High priority, doing today",
        resolution: "focus_today" as ResolutionType,
      },
      {
        label: "⚡ Quick",
        answer: "Small task, quick win",
        resolution: "quick_win" as ResolutionType,
      },
      { label: "⏳ Later", answer: "Defer for now", resolution: "later" as ResolutionType },
      { label: "✗ Drop", answer: "No longer needed", resolution: "drop" as ResolutionType },
    ];

    for (const action of quickActions) {
      const btn = quickActionsContainer.createEl("button", {
        text: action.label,
        cls: "daily-focus-quick-button",
      });
      btn.addEventListener("click", () => {
        answerTextarea.value = action.answer;
        this.answerInput = action.answer;
        this.selectedResolution = action.resolution;
      });
    }

    // Button container
    const buttonContainer = contentEl.createDiv({ cls: "daily-focus-button-container" });

    // Skip all button (only show if more than one item remaining)
    if (this.unclearItems.length - this.currentIndex > 1) {
      const skipAllButton = buttonContainer.createEl("button", {
        text: "Skip remaining",
        cls: "daily-focus-button-secondary",
      });
      skipAllButton.addEventListener("click", () => {
        // Save current item first
        this.saveCurrentItem(item);
        // Resolve remaining items as focus_today by default
        for (let i = this.currentIndex + 1; i < this.unclearItems.length; i++) {
          this.resolvedItems.push({
            task: this.unclearItems[i].task,
            resolution: "focus_today",
            context: "",
          });
        }
        this.close();
        this.resolvePromise?.(this.resolvedItems);
      });
    }

    // Next/Done button
    const isLastItem = this.currentIndex === this.unclearItems.length - 1;
    const nextButton = buttonContainer.createEl("button", {
      text: isLastItem ? "Done" : "Next",
      cls: "daily-focus-button-primary",
    });
    nextButton.addEventListener("click", () => {
      this.saveCurrentItem(item);

      if (isLastItem) {
        this.close();
        this.resolvePromise?.(this.resolvedItems);
      } else {
        this.currentIndex++;
        this.answerInput = "";
        this.selectedResolution = "focus_today";
        this.renderCurrentItem();
      }
    });

    // Handle Cmd/Ctrl+Enter to submit
    answerTextarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        nextButton.click();
      }
    });

    // Focus the textarea
    setTimeout(() => {
      answerTextarea.focus();
    }, 50);
  }

  private saveCurrentItem(item: UnclearItem): void {
    // Infer resolution from answer if possible
    const answer = this.answerInput.toLowerCase();
    let resolution = this.selectedResolution;

    // Simple inference from common phrases
    if (
      answer.includes("done") ||
      answer.includes("completed") ||
      answer.includes("shipped") ||
      answer.includes("finished")
    ) {
      resolution = "done";
    } else if (
      answer.includes("drop") ||
      answer.includes("not needed") ||
      answer.includes("cancel") ||
      answer.includes("won't do")
    ) {
      resolution = "drop";
    } else if (
      answer.includes("later") ||
      answer.includes("defer") ||
      answer.includes("next week") ||
      answer.includes("backlog")
    ) {
      resolution = "later";
    } else if (
      answer.includes("delegate") ||
      answer.includes("quick") ||
      answer.includes("small") ||
      answer.includes("→")
    ) {
      resolution = "quick_win";
    } else if (
      answer.includes("priority") ||
      answer.includes("focus") ||
      answer.includes("today") ||
      answer.includes("important")
    ) {
      resolution = "focus_today";
    }

    this.resolvedItems.push({
      task: item.task,
      resolution: resolution,
      context: this.answerInput,
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
