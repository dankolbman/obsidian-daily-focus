import { App, Modal } from "obsidian";
import { DraftAgenda } from "../types";

export interface CheckinResult {
  /** Tasks marked as completed */
  completedTasks: string[];
  /** Updates to in-progress tasks */
  taskUpdates: Map<string, string>;
  /** New work that came up */
  newWork: string;
  /** Any blockers or issues */
  blockers: string;
  /** Whether the user cancelled */
  cancelled: boolean;
}

/**
 * Modal for mid-day check-in.
 * Allows user to report progress, new work, and update task statuses.
 */
export class CheckinModal extends Modal {
  private currentAgenda: DraftAgenda;
  private resolvePromise: ((result: CheckinResult) => void) | null = null;

  // Form state
  private completedTasks: Set<string> = new Set();
  private taskUpdates: Map<string, string> = new Map();
  private newWorkInput: string = "";
  private blockersInput: string = "";

  constructor(app: App, currentAgenda: DraftAgenda) {
    super(app);
    this.currentAgenda = currentAgenda;
  }

  async prompt(): Promise<CheckinResult> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass("daily-focus-modal");
    contentEl.addClass("daily-focus-checkin-modal");
    modalEl.addClass("daily-focus-checkin-container");

    // Header
    contentEl.createEl("h2", { text: "☀️ Mid-day Check-in" });
    contentEl.createEl("p", {
      text: "How's your day going? Let's update your focus.",
      cls: "daily-focus-checkin-subtitle",
    });

    // Section 1: What's done?
    const doneSection = contentEl.createDiv({ cls: "daily-focus-checkin-section" });
    doneSection.createEl("h3", { text: "✅ What's done?" });
    doneSection.createEl("p", {
      text: "Check off tasks you've completed:",
      cls: "daily-focus-section-hint",
    });

    const allTasks = [
      ...this.currentAgenda.focusToday.map((t) => ({ task: t, section: "Focus" })),
      ...this.currentAgenda.quickWins.map((t) => ({ task: t, section: "Quick wins" })),
    ];

    if (allTasks.length > 0) {
      const taskList = doneSection.createDiv({ cls: "daily-focus-checkin-tasks" });
      for (const [idx, { task, section }] of allTasks.entries()) {
        const taskItem = taskList.createDiv({ cls: "daily-focus-checkin-task" });

        const inputId = `daily-focus-checkin-task-${idx}`;
        const checkbox = taskItem.createEl("input", {
          type: "checkbox",
          attr: { id: inputId },
        });
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            this.completedTasks.add(task);
          } else {
            this.completedTasks.delete(task);
          }
        });

        const label = taskItem.createEl("label", {
          attr: { for: inputId },
        });
        label.createEl("span", { text: task, cls: "daily-focus-checkin-task-text" });
        label.createEl("span", { text: section, cls: "daily-focus-checkin-task-section" });
      }
    } else {
      doneSection.createEl("p", {
        text: "No tasks in today's agenda yet.",
        cls: "daily-focus-empty-state",
      });
    }

    // Section 2: New work
    const newSection = contentEl.createDiv({ cls: "daily-focus-checkin-section" });
    newSection.createEl("h3", { text: "🆕 Anything new come up?" });
    newSection.createEl("p", {
      text: "Describe any new tasks, meetings, or priorities that emerged:",
      cls: "daily-focus-section-hint",
    });

    const newWorkTextarea = newSection.createEl("textarea", {
      cls: "daily-focus-checkin-textarea",
      attr: {
        rows: "3",
        placeholder:
          "e.g., Got pulled into urgent bug fix for FSW-1234, need to review Alice's PR...",
      },
    });
    newWorkTextarea.addEventListener("input", (e) => {
      this.newWorkInput = (e.target as HTMLTextAreaElement).value;
    });

    // Section 3: Blockers
    const blockerSection = contentEl.createDiv({ cls: "daily-focus-checkin-section" });
    blockerSection.createEl("h3", { text: "🚧 Any blockers?" });
    blockerSection.createEl("p", {
      text: "Note anything that's blocking progress or needs attention:",
      cls: "daily-focus-section-hint",
    });

    const blockersTextarea = blockerSection.createEl("textarea", {
      cls: "daily-focus-checkin-textarea",
      attr: {
        rows: "2",
        placeholder: "e.g., Waiting on review from Bob, CI is flaky...",
      },
    });
    blockersTextarea.addEventListener("input", (e) => {
      this.blockersInput = (e.target as HTMLTextAreaElement).value;
    });

    // Buttons
    const buttonContainer = contentEl.createDiv({ cls: "daily-focus-button-container" });

    const skipButton = buttonContainer.createEl("button", {
      text: "Skip",
      cls: "daily-focus-button-secondary",
    });
    skipButton.addEventListener("click", () => {
      this.close();
      this.resolvePromise?.({
        completedTasks: [],
        taskUpdates: new Map(),
        newWork: "",
        blockers: "",
        cancelled: true,
      });
    });

    const submitButton = buttonContainer.createEl("button", {
      text: "Update Agenda",
      cls: "daily-focus-button-primary",
    });
    submitButton.addEventListener("click", () => {
      this.close();
      this.resolvePromise?.({
        completedTasks: Array.from(this.completedTasks),
        taskUpdates: this.taskUpdates,
        newWork: this.newWorkInput,
        blockers: this.blockersInput,
        cancelled: false,
      });
    });

    // Handle Cmd/Ctrl+Enter to submit
    contentEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submitButton.click();
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
