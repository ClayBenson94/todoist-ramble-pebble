var Clay = require('@rebble/clay');
var clayConfig = require('./config');
var keywordRules = require('./keyword-rules');
var clay = new Clay(clayConfig, null, {
  autoHandleEvents: false,
  // Lets the keyword rules editor check each rule with the same parser the app uses
  userData: { parseKeywordRules: keywordRules.parseKeywordRules }
});
clay.registerComponent(require('./keyword-rules-editor'));

var settings = {
  apiKey: '',
  projectId: '',
  skipPreview: false,
  keywordRules: []
};

var STORAGE_KEY_API = 'ramble_apiKey';
var STORAGE_KEY_PROJECT = 'ramble_projectId';
var STORAGE_KEY_SKIP_PREVIEW = 'ramble_skipPreview';
var STORAGE_KEY_KEYWORD_RULES = 'ramble_keywordRules';

// Pending task array held between DICTATION_TEXT and CONFIRM_TASKS messages.
// Set when the phone sends a task preview to the watch; cleared after the user confirms or cancels.
var s_pending_tasks = null;

/**
 * Loads saved settings from localStorage into the in-memory settings object.
 * Called once on the 'ready' event before any messages can arrive.
 */
function loadSettings() {
  var apiKey = localStorage.getItem(STORAGE_KEY_API) || '';
  var projectId = localStorage.getItem(STORAGE_KEY_PROJECT) || '';
  var skipPreview = localStorage.getItem(STORAGE_KEY_SKIP_PREVIEW);
  settings.apiKey = apiKey;
  settings.projectId = projectId;
  settings.skipPreview = (skipPreview === 'true');
  settings.keywordRules = loadKeywordRules(localStorage.getItem(STORAGE_KEY_KEYWORD_RULES) || '');
  console.log('Settings loaded. API key set: ' + (settings.apiKey ? 'yes' : 'no') +
              ', project ID: ' + (settings.projectId || 'inbox') +
              ', skipPreview: ' + settings.skipPreview +
              ', keyword rules: ' + settings.keywordRules.length);
}

/**
 * Persists new settings to localStorage and updates the in-memory settings object.
 * @param {string}  apiKey           - Todoist API token
 * @param {string}  projectId        - Todoist project ID, or empty string for Inbox
 * @param {boolean} skipPreview      - Whether to skip the on-watch task preview step
 * @param {string}  keywordRulesText - Keyword rules JSON from the settings page, or empty string
 */
function saveSettings(apiKey, projectId, skipPreview, keywordRulesText) {
  settings.apiKey = apiKey;
  settings.projectId = projectId;
  settings.skipPreview = !!skipPreview;
  settings.keywordRules = loadKeywordRules(keywordRulesText);
  localStorage.setItem(STORAGE_KEY_API, apiKey);
  localStorage.setItem(STORAGE_KEY_PROJECT, projectId);
  localStorage.setItem(STORAGE_KEY_SKIP_PREVIEW, settings.skipPreview ? 'true' : 'false');
  localStorage.setItem(STORAGE_KEY_KEYWORD_RULES, keywordRulesText);
}

/**
 * Parses saved keyword rules, skipping (with a log message) any that are invalid.
 * The settings page flags the same problems under each rule as it's edited.
 * @param  {string}   text - keyword rules JSON saved by the settings page
 * @returns {Object[]}      the valid rules; empty if there are none
 */
function loadKeywordRules(text) {
  var parsed = keywordRules.parseKeywordRules(text);
  if (parsed.error) {
    console.log('Skipping invalid keyword rules: ' + parsed.error);
  }
  return parsed.rules;
}

/**
 * Splits a dictated sentence into individual tasks.
 * Splits on spoken delimiters (and/also/then/next, commas, periods, numbered lists),
 * strips leading stop-words from each part, applies the keyword rules, discards fragments
 * shorter than 3 characters, and capitalizes each resulting task.
 * @param  {string}   text - raw transcription string received from the watch
 * @returns {Object[]}      array of {content, section, labels} tasks (may be empty), where
 *                          section and labels come from matched keyword rules
 */
function splitIntoTasks(text) {
  if (!text || typeof text !== 'string') return [];

  var normalized = text.trim().replace(/\s+/g, ' ');

  // Split on natural spoken delimiters
  var parts = normalized.split(
    /\s+and\s+|\s+also\s+|\s+then\s+|\s+next\s+|,\s*|\.\s+|\.\s*$|\d+[.)]\s+/i
  );

  var stopWords = ['and', 'also', 'then', 'next', 'but', 'or', 'so'];
  var tasks = [];

  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim().replace(/^(and|also|then|next|but|or|so)\s+/i, '');
    // Apply keyword rules before filtering, since removing a keyword shortens the task
    var task = keywordRules.applyKeywordRules(part, settings.keywordRules);
    var content = task.content;
    if (!content) continue;
    if (content.length < 3) continue;
    if (stopWords.indexOf(content.toLowerCase()) !== -1) continue;
    // Capitalize first letter
    task.content = content.charAt(0).toUpperCase() + content.slice(1);
    tasks.push(task);
  }

  return tasks;
}

/**
 * Formats a task for the watch preview, showing its section and labels in Todoist's syntax.
 * @param  {Object} task - task from splitIntoTasks
 * @returns {string}       e.g. "Coffee creamer /Costco @Urgent"
 */
function formatTask(task) {
  var text = task.content;
  if (task.section) {
    text += ' /' + task.section;
  }
  task.labels.forEach(function(label) {
    text += ' @' + label;
  });
  return text;
}

/**
 * Fetches the sections tasks can be filed into: the configured project's sections, or every
 * project's sections when tasks go to the Inbox. Follows pagination cursors until done.
 * @param {Function} callback - called with an array of section objects ({id, name, project_id, ...});
 *                              if a request fails, called with whatever loaded before the failure
 */
function fetchSections(callback) {
  var sections = [];

  function fetchPage(cursor) {
    var params = [];
    if (settings.projectId) {
      params.push('project_id=' + encodeURIComponent(settings.projectId));
    }
    if (cursor) {
      params.push('cursor=' + encodeURIComponent(cursor));
    }

    var xhr = new XMLHttpRequest();
    xhr.onload = function() {
      var page = null;
      if (this.status === 200) {
        try {
          page = JSON.parse(this.responseText);
        } catch (e) {
          page = null;
        }
      }
      if (!page || !Array.isArray(page.results)) {
        console.log('Could not load sections: HTTP ' + this.status);
        callback(sections);
        return;
      }
      sections = sections.concat(page.results);
      if (page.next_cursor) {
        fetchPage(page.next_cursor);
      } else {
        callback(sections);
      }
    };
    xhr.onerror = function() {
      console.log('Could not load sections: network error');
      callback(sections);
    };

    xhr.open('GET', 'https://api.todoist.com/api/v1/sections' +
                    (params.length ? '?' + params.join('&') : ''));
    xhr.setRequestHeader('Authorization', 'Bearer ' + settings.apiKey);
    xhr.send();
  }

  fetchPage(null);
}

/**
 * Normalizes a section name for matching: case, spacing and apostrophe style don't matter.
 * @param  {string} name - section name from a keyword rule or from Todoist
 * @returns {string}       normalized name
 */
function sectionKey(name) {
  return String(name).trim().replace(/\s+/g, ' ').replace(/\u2019/g, '\'').toLowerCase();
}

/**
 * Turns each task's section name into a section ID, plus the project that section is in.
 * A section that can't be found is left in the task title ("Coffee creamer /Costco") so the
 * task still gets added and the missing section is easy to spot in Todoist.
 * @param {Object[]} tasks    - tasks from splitIntoTasks; updated in place
 * @param {Object[]} sections - sections from fetchSections
 */
function resolveSections(tasks, sections) {
  var byName = Object.create(null);
  sections.forEach(function(section) {
    var key = sectionKey(section.name);
    if (!section.is_archived && !section.is_deleted && !(key in byName)) {
      byName[key] = section;
    }
  });

  tasks.forEach(function(task) {
    if (!task.section) return;
    var section = byName[sectionKey(task.section)];
    if (section) {
      task.sectionId = section.id;
      task.projectId = section.project_id;
    } else {
      console.log('No section named "' + task.section + '"; leaving it in the task title');
      task.content += ' /' + task.section;
    }
  });
}

/**
 * Adds tasks to Todoist, first looking up section IDs if any task names a section.
 * @param {Object[]} tasks    - tasks from splitIntoTasks
 * @param {Function} callback - called with (successCount, errorString|null) when done
 */
function submitTasks(tasks, callback) {
  var needsSections = tasks.some(function(task) { return !!task.section; });
  if (!needsSections) {
    createTasksSequentially(tasks, 0, 0, callback);
    return;
  }
  fetchSections(function(sections) {
    resolveSections(tasks, sections);
    createTasksSequentially(tasks, 0, 0, callback);
  });
}

/**
 * Creates a single task in Todoist via the REST API.
 * Uses the configured API key; adds to the task's section if it has one, otherwise to the
 * configured project if set, otherwise Inbox.
 * @param {Object}   task     - task from splitIntoTasks, with any section resolved by resolveSections
 * @param {Function} callback - called with (httpStatus, responseText) when the request settles
 */
function createTask(task, callback) {
  var xhr = new XMLHttpRequest();
  var body = { content: task.content };
  var projectId = task.projectId || settings.projectId;
  if (projectId) {
    body.project_id = projectId;
  }
  if (task.sectionId) {
    body.section_id = task.sectionId;
  }
  if (task.labels.length > 0) {
    body.labels = task.labels;
  }

  xhr.onload = function() {
    callback(this.status, this.responseText);
  };
  xhr.onerror = function() {
    callback(0, 'Network error');
  };

  xhr.open('POST', 'https://api.todoist.com/api/v1/tasks');
  xhr.setRequestHeader('Authorization', 'Bearer ' + settings.apiKey);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.send(JSON.stringify(body));
}

/**
 * Recursively creates tasks one at a time to avoid hitting API rate limits.
 * Stops immediately on 401/403 auth errors rather than continuing with remaining tasks.
 * On completion (all tasks attempted or early stop), calls callback with final counts.
 * @param {Object[]} tasks        - full list of tasks to create (see createTask)
 * @param {number}   index        - current position in the tasks array (start at 0)
 * @param {number}   successCount - running count of successfully created tasks
 * @param {Function} callback     - called with (successCount, errorString|null) when done
 */
function createTasksSequentially(tasks, index, successCount, callback) {
  if (index >= tasks.length) {
    callback(successCount, null);
    return;
  }

  createTask(tasks[index], function(status, response) {
    if (status === 200 || status === 204) {
      createTasksSequentially(tasks, index + 1, successCount + 1, callback);
    } else if (status === 401) {
      callback(successCount, 'Invalid API key');
    } else if (status === 403) {
      callback(successCount, 'Access denied');
    } else if (status === 0) {
      callback(successCount, 'Check Bluetooth');
    } else {
      callback(successCount, 'HTTP ' + status);
    }
  });
}

/**
 * Sends an AppMessage payload to the watch with success/failure logging.
 * @param {Object} payload - key/value pairs to deliver via Pebble.sendAppMessage
 * @param {string} label   - human-readable label used only in console log output
 */
function sendToWatch(payload, label) {
  Pebble.sendAppMessage(payload,
    function() { console.log('Sent to watch: ' + label); },
    function() { console.log('Failed to send to watch: ' + label); }
  );
}

// Opens the Clay configuration page in the Pebble mobile app when the user taps Settings.
Pebble.addEventListener('showConfiguration', function() {
  Pebble.openURL(clay.generateUrl());
});

// Handles the Clay settings form being submitted (webview closed with a response).
// Parses Clay's response, persists the updated settings, and pushes them to the watch.
Pebble.addEventListener('webviewclosed', function(e) {
  if (!e || !e.response) {
    return;
  }
  try {
    // Pass false to get string-named keys with {value: ...} wrappers
    var claySettings = clay.getSettings(e.response, false);
    var apiKey = (claySettings.TodoistApiKey && claySettings.TodoistApiKey.value) ? String(claySettings.TodoistApiKey.value) : '';
    var projectId = (claySettings.TodoistProjectId && claySettings.TodoistProjectId.value) ? String(claySettings.TodoistProjectId.value) : '';
    var autoLaunch = (claySettings.AutoLaunch && claySettings.AutoLaunch.value) ? 1 : 0;
    var skipPreview = !!(claySettings.SkipPreview && claySettings.SkipPreview.value);
    var keywordRulesText = (claySettings.KeywordRules && claySettings.KeywordRules.value) ? String(claySettings.KeywordRules.value) : '';
    saveSettings(apiKey, projectId, skipPreview, keywordRulesText);
    // autoHandleEvents:false means Clay never sends to the watch — do it manually
    Pebble.sendAppMessage({
      'TodoistApiKey': apiKey,
      'TodoistProjectId': projectId,
      'AutoLaunch': autoLaunch,
      'SkipPreview': skipPreview ? 1 : 0
    });
  } catch (err) {
    console.log('Error parsing settings: ' + err.message);
  }
});

// Loads settings when the PebbleKit JS environment is ready to receive messages.
Pebble.addEventListener('ready', function() {
  loadSettings();
  console.log('Todoist Ramble JS ready');
});

// Handles AppMessages arriving from the watch.
//
// DICTATION_TEXT: receives the raw transcription, parses it into tasks, then either
//   sends a pipe-delimited TASK_PREVIEW to the watch (normal flow) or creates tasks
//   immediately if skipPreview is enabled.
//
// CONFIRM_TASKS: receives user confirmation from the preview screen, then submits
//   the pending task list (s_pending_tasks) to the Todoist API.
Pebble.addEventListener('appmessage', function(e) {
  var payload = e.payload;

  // Dictation text from watch
  if (payload['DICTATION_TEXT'] !== undefined) {
    var text = payload['DICTATION_TEXT'];
    console.log('Received dictation text: ' + text);

    if (!settings.apiKey) {
      sendToWatch({'RESULT_ERROR': 'No API key set'}, 'no api key error');
      return;
    }

    var tasks = splitIntoTasks(text);
    console.log('Parsed ' + tasks.length + ' tasks: ' + JSON.stringify(tasks));

    if (tasks.length === 0) {
      sendToWatch({'RESULT_ERROR': 'No tasks found'}, 'no tasks error');
      return;
    }

    if (settings.skipPreview) {
      // Skip preview — add tasks immediately
      submitTasks(tasks, function(count, err) {
        if (err && count === 0) {
          sendToWatch({'RESULT_ERROR': err}, 'todoist error');
        } else {
          sendToWatch({'RESULT_SUCCESS': count}, 'success: ' + count + ' tasks');
        }
      });
    } else {
      // Send task list to watch for preview/confirmation before creating
      s_pending_tasks = tasks;
      sendToWatch({'TASK_PREVIEW': tasks.map(formatTask).join('|')}, 'task preview');
    }
  }

  // User confirmed tasks on watch — now call the API
  if (payload['CONFIRM_TASKS'] !== undefined) {
    console.log('User confirmed tasks on watch');
    var tasks = s_pending_tasks;
    s_pending_tasks = null;
    if (!tasks || tasks.length === 0) {
      sendToWatch({'RESULT_ERROR': 'No pending tasks'}, 'confirm with no tasks');
      return;
    }
    submitTasks(tasks, function(count, err) {
      if (err && count === 0) {
        sendToWatch({'RESULT_ERROR': err}, 'todoist error');
      } else {
        sendToWatch({'RESULT_SUCCESS': count}, 'success: ' + count + ' tasks');
      }
    });
  }
});
