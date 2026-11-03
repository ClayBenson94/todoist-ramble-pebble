// Clay configuration schema for the Pebble settings page.
// Each item describes a UI element (heading, text, input, toggle, submit) that Clay renders
// in the Pebble mobile app. The messageKey fields map directly to AppMessage keys used in
// inbox_received_callback on the watch and in the 'webviewclosed' handler in index.js.
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
    "type": "section",
    "items": [
      {
        "type": "heading",
        "defaultValue": "Keyword Shortcuts"
      },
      {
        "type": "text",
        "defaultValue": "Say a keyword with a task to swap it for its replacement: <b>/Name</b> files the task in that section, <b>@Name</b> adds that label. Keywords match whole words, in any case."
      },
      {
        // Stays on the phone: index.js reads it on save and never sends it to the watch
        "type": "textarea",
        "messageKey": "KeywordRules",
        "label": "Keyword rules (JSON)",
        "defaultValue": "",
        "attributes": {
          "placeholder": "[\n  {\"keywords\": [\"costco\", \"bulk\"], \"replace\": \"/Costco\"},\n  {\"keywords\": [\"urgent\"], \"replace\": \"@Urgent\"}\n]",
          "rows": "8",
          "autocapitalize": "off",
          "autocorrect": "off",
          "autocomplete": "off",
          "spellcheck": "false"
        }
      },
      {
        // Filled in by the settings page script in index.js as the rules are edited
        "type": "text",
        "id": "KeywordRulesStatus",
        "defaultValue": ""
      }
    ]
  },
  {
    "type": "submit",
    "defaultValue": "Save Settings"
  }
];
