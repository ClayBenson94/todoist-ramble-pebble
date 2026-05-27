module.exports = [
  {
    "type": "heading",
    "defaultValue": "Ramble List"
  },
  {
    "type": "text",
    "defaultValue": "Speak your tasks — Ramble List adds them to Todoist."
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
    "type": "submit",
    "defaultValue": "Save Settings"
  }
];
