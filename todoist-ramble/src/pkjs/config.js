module.exports = [
  {
    "type": "heading",
    "defaultValue": "Todoist Ramble"
  },
  {
    "type": "text",
    "defaultValue": "Speak your tasks — Todoist Ramble adds them to Todoist."
  },
  {
    "type": "section",
    "items": [
      {
        "type": "heading",
        "defaultValue": "Todoist Connection"
      },
      {
        "type": "input",
        "messageKey": "TodoistApiKey",
        "label": "API Token",
        "description": "Find your API token in Todoist: Settings > Integrations > Developer",
        "defaultValue": "",
        "attributes": {
          "placeholder": "Paste your API token here",
          "type": "text"
        }
      },
      {
        "type": "input",
        "messageKey": "TodoistProjectId",
        "label": "Project ID (optional)",
        "description": "Leave blank to add tasks to your Inbox. Find the ID in the project URL.",
        "defaultValue": "",
        "attributes": {
          "placeholder": "e.g. 2345678901",
          "type": "text"
        }
      }
    ]
  },
  {
    "type": "section",
    "items": [
      {
        "type": "toggle",
        "messageKey": "AutoLaunch",
        "label": "Quick Launch",
        "description": "Skip the start screen and begin dictation immediately when the app opens.",
        "defaultValue": false
      },
      {
        "type": "toggle",
        "messageKey": "SkipPreview",
        "label": "Skip task preview",
        "description": "When enabled, tasks are added immediately after dictation without a preview step.",
        "defaultValue": false
      }
    ]
  },
  {
    "type": "submit",
    "defaultValue": "Save Settings"
  }
];
