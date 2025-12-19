import { App, TFile, TFolder } from "obsidian";
import {
  extractDateFromDailyFilename,
  extractDateAndTitleFromMeetingFilename,
  isWithinLookback,
  getTodayDate,
} from "../utils/date-utils";

/**
 * Raw file data read from the vault.
 */
export interface RawDailyFile {
  date: string;
  content: string;
  file: TFile;
}

export interface RawMeetingFile {
  date: string;
  title: string;
  content: string;
  filepath: string;
  createdAt: Date;
  modifiedAt: Date;
  file: TFile;
}

/**
 * Service for reading markdown files from the Obsidian vault.
 */
export class VaultReader {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Normalize a user-provided folder path (relative to vault root).
   * - trims whitespace
   * - removes leading/trailing slashes
   * - collapses multiple slashes
   */
  private normalizeFolderPath(folderPath: string): string {
    return folderPath
      .trim()
      .replace(/^\/+/, "")
      .replace(/\/+$/, "")
      .replace(/\/{2,}/g, "/");
  }

  /**
   * Get or create a folder in the vault.
   */
  async ensureFolder(folderPath: string): Promise<TFolder> {
    const normalized = this.normalizeFolderPath(folderPath);
    if (!normalized) {
      // Empty path means vault root; nothing to ensure/create.
      // (Also avoids creating a folder with an empty name.)
      const root = this.app.vault.getRoot();
      if (!(root instanceof TFolder)) {
        throw new Error("Failed to resolve vault root folder");
      }
      return root;
    }

    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFolder) {
      return existing;
    }
    await this.app.vault.createFolder(normalized);
    const created = this.app.vault.getAbstractFileByPath(normalized);
    if (!(created instanceof TFolder)) {
      throw new Error(`Failed to create folder: ${normalized}`);
    }
    return created;
  }

  /**
   * Read all daily agenda files within the lookback period.
   * Files are sorted by date, most recent first.
   */
  async readDailyFiles(dailyFolder: string, lookbackDays: number): Promise<RawDailyFile[]> {
    const normalizedDailyFolder = this.normalizeFolderPath(dailyFolder);
    await this.ensureFolder(normalizedDailyFolder);

    const files = this.app.vault.getMarkdownFiles();
    const dailyFiles: RawDailyFile[] = [];

    for (const file of files) {
      // Check if file is in the daily folder
      if (normalizedDailyFolder && !file.path.startsWith(normalizedDailyFolder + "/")) {
        continue;
      }

      // Extract date from filename
      const date = extractDateFromDailyFilename(file.name);
      if (!date) {
        continue;
      }

      // Check if within lookback period
      if (!isWithinLookback(date, lookbackDays)) {
        continue;
      }

      const content = await this.app.vault.read(file);
      dailyFiles.push({ date, content, file });
    }

    // Sort by date, most recent first
    dailyFiles.sort((a, b) => b.date.localeCompare(a.date));
    return dailyFiles;
  }

  /**
   * Read all meeting note files within the lookback period.
   * Files are sorted by date, most recent first.
   */
  async readMeetingFiles(meetingsFolder: string, lookbackDays: number): Promise<RawMeetingFile[]> {
    const normalizedMeetingsFolder = this.normalizeFolderPath(meetingsFolder);
    await this.ensureFolder(normalizedMeetingsFolder);

    const files = this.app.vault.getMarkdownFiles();
    const meetingFiles: RawMeetingFile[] = [];

    for (const file of files) {
      // Check if file is in the meetings folder
      if (normalizedMeetingsFolder && !file.path.startsWith(normalizedMeetingsFolder + "/")) {
        continue;
      }

      // Extract date and title from filename
      const parsed = extractDateAndTitleFromMeetingFilename(file.name);
      if (!parsed) {
        continue;
      }

      // Check if within lookback period
      if (!isWithinLookback(parsed.date, lookbackDays)) {
        continue;
      }

      const content = await this.app.vault.read(file);
      meetingFiles.push({
        date: parsed.date,
        title: parsed.title,
        content,
        filepath: file.path,
        createdAt: new Date(file.stat.ctime),
        modifiedAt: new Date(file.stat.mtime),
        file,
      });
    }

    // Sort by date, most recent first
    meetingFiles.sort((a, b) => b.date.localeCompare(a.date));
    return meetingFiles;
  }

  /**
   * Check if a daily agenda file exists for today.
   */
  async todayAgendaExists(dailyFolder: string): Promise<boolean> {
    const todayPath = `${dailyFolder}/${getTodayDate()}.md`;
    return this.app.vault.getAbstractFileByPath(todayPath) instanceof TFile;
  }

  /**
   * Get the TFile for today's agenda (if it exists).
   */
  getTodayAgendaFile(dailyFolder: string): TFile | null {
    const todayPath = `${dailyFolder}/${getTodayDate()}.md`;
    const file = this.app.vault.getAbstractFileByPath(todayPath);
    return file instanceof TFile ? file : null;
  }

  /**
   * Write content to a file, creating it if it doesn't exist.
   */
  async writeFile(path: string, content: string): Promise<TFile> {
    const existingFile = this.app.vault.getAbstractFileByPath(path);
    if (existingFile instanceof TFile) {
      await this.app.vault.modify(existingFile, content);
      return existingFile;
    } else {
      return await this.app.vault.create(path, content);
    }
  }

  /**
   * Open a file in Obsidian.
   */
  async openFile(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf();
    await leaf.openFile(file);
  }
}
