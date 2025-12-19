# Daily Focus Assistant

An Obsidian plugin that helps you plan your workday by analyzing recent agendas and meeting notes using AI.

## Features

- **Smart Context Gathering**: Automatically reads your daily agendas and meeting notes from the past week
- **AI-Powered Triage**: Uses Claude to categorize tasks and identify items needing attention
- **Meeting Note Prompts**: Reminds you to add action items to recent meeting notes
- **Status Updates**: Helps you resolve stale or unclear tasks
- **Draft Review**: Preview and edit the generated agenda before saving

## Installation

### Manual Installation

1. Download the latest release
2. Extract to your vault's `.obsidian/plugins/daily-focus/` folder
3. Enable the plugin in Obsidian settings

### Development

```bash
# Install dependencies
npm install

# Build for development (with watch mode)
npm run dev

# Build for production
npm run build
```

## Configuration

Open Settings → Daily Focus Assistant to configure:

### Vault Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Daily folder | Folder containing daily agenda files | `daily` |
| Meetings folder | Folder containing meeting notes | `meetings` |
| Lookback days | Days of history to analyze | `7` |

### Scheduling

| Setting | Description | Default |
|---------|-------------|---------|
| Morning notification time | Time to remind you to plan your day (HH:MM) | `08:30` |
| Mid-day check-in time | Time for a mid-day progress check (HH:MM) | `13:00` |
| End-of-day wrap-up time | Time for end-of-day reflection (HH:MM) | `16:00` |
| Reminder interval | Minutes between follow-up reminders | `10` |

### LLM Configuration

The plugin supports two ways to connect to Claude:

#### Option 1: Claude CLI (Recommended)

The simplest approach - uses your existing Claude CLI authentication.

1. Install the Claude CLI:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. Authenticate:
   ```bash
   claude auth login
   ```

3. In plugin settings, select "Claude CLI" as the LLM Provider

**Benefits:**
- No API key management in Obsidian
- Uses your existing CLI authentication
- Automatic session management

#### Option 2: Anthropic API

Direct API access using your API key.

| Setting | Description | Default |
|---------|-------------|---------|
| Anthropic API Key | Your Claude API key | (required) |
| Model | Claude model to use | `claude-sonnet-4-20250514` |

Get an API key at [console.anthropic.com](https://console.anthropic.com)

### GitHub & Jira Integration

The plugin can optionally pull context from GitHub and Jira using their respective CLIs.

#### GitHub
- **Enable GitHub**: Toggle to fetch open PRs
- **Repository**: Your project repo (e.g., `org/repo`)
- **gh CLI path**: Path to the `gh` executable (default: `gh`)

#### Jira
- **Enable Jira**: Toggle to fetch active tickets
- **Project key**: Your Jira project key (e.g., `FSW`)
- **Base URL**: Your Jira instance URL
- **jira CLI path**: Path to the `jira` (go-jira) executable (default: `jira`)

## File Formats

### Daily Agenda (`daily/YYYY-MM-DD.md`)

```markdown
# Daily Focus — 2024-12-17

## Focus today
_1-3 things that would make today successful_
- [ ] Important task [PROJ-123]

## Delegate
_Who can take this? Be specific._
- [ ] Task → Person Name

## Quick wins
_Small tasks you can knock out between focused work_
- [ ] Quick task

## Blocked / Waiting
_Things you can't move forward right now_
- [ ] Blocked task — waiting on X

## Do later
_Intentionally deferred—revisit weekly_
- [ ] Deferred task — reason

## Notes
_Anything that came up during the day_
```

### Meeting Note (`meetings/YYYY-MM-DD - Title.md`)

```markdown
# Meeting — 2024-12-17 — Team Sync

## Attendees
- Person 1
- Person 2

## Notes
Discussion points...

## Action items
- [ ] Follow up on X
- [ ] Review Y [PROJ-456]
```

## Usage

1. **Trigger**: Click the target icon in the ribbon or use the command palette (`Generate Daily Focus`)
2. **Meeting Prompts**: If recent meetings are missing action items, you'll be prompted to update them
3. **AI Analysis**: The plugin sends your context to Claude for analysis
4. **Status Updates**: Review and resolve any unclear/stale tasks
5. **Draft Review**: Edit the generated agenda and save

## Task Detection

The plugin automatically detects:

- **Incomplete tasks**: Lines starting with `- [ ]`
- **Completed tasks**: Lines starting with `- [x]`
- **Jira IDs**: Patterns like `[PROJ-123]`
- **Delegations**: Format `task → Person Name`

## Unclear Item Detection

Tasks are flagged as "unclear" when:
- Carried over for 3+ consecutive days without completion
- In "Focus today" section but not completed for 2+ days

## Privacy

- When using CLI mode: Data is processed through your local Claude CLI session
- When using API mode: Your data is sent to Anthropic's API
- No data is stored outside your vault and the LLM provider's standard handling
- API keys (if used) are stored in Obsidian's plugin data

## Troubleshooting

### CLI Mode Issues

**"command not found: claude"**
- Ensure the Claude CLI is installed: `npm install -g @anthropic-ai/claude-code`
- Make sure your PATH includes npm global binaries
- Try specifying the full path in settings (e.g., `/usr/local/bin/claude`)

**"Authentication required"**
- Run `claude auth login` in your terminal to authenticate

### API Mode Issues

**"API key not configured"**
- Add your Anthropic API key in the plugin settings

**"API error: 401"**
- Check that your API key is correct and has sufficient credits

## License

MIT
