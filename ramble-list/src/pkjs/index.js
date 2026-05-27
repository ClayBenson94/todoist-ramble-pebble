var Clay = require('@rebble/clay');
var clayConfig = require('./config');
var clay = new Clay(clayConfig, null, { autoHandleEvents: false });

var settings = {
  apiKey: '',
  projectId: ''
};

var STORAGE_KEY_API = 'ramble_apiKey';
var STORAGE_KEY_PROJECT = 'ramble_projectId';

function loadSettings() {
  var apiKey = localStorage.getItem(STORAGE_KEY_API) || '';
  var projectId = localStorage.getItem(STORAGE_KEY_PROJECT) || '';
  settings.apiKey = apiKey;
  settings.projectId = projectId;
  console.log('[DEBUG_LOG] loadSettings: localStorage apiKey=' + (apiKey ? '"' + apiKey.substring(0, 4) + '..."' : 'EMPTY') + ' projectId=' + (projectId || 'EMPTY')); // DEBUG_LOG
  console.log('Settings loaded. API key set: ' + (settings.apiKey ? 'yes' : 'no') +
              ', project ID: ' + (settings.projectId || 'inbox'));
}

function saveSettings(apiKey, projectId) {
  settings.apiKey = apiKey;
  settings.projectId = projectId;
  localStorage.setItem(STORAGE_KEY_API, apiKey);
  localStorage.setItem(STORAGE_KEY_PROJECT, projectId);
  console.log('[DEBUG_LOG] saveSettings: stored apiKey=' + (apiKey ? '"' + apiKey.substring(0, 4) + '..."' : 'EMPTY') + ' projectId=' + (projectId || 'EMPTY')); // DEBUG_LOG
}

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
    var task = parts[i].trim();
    if (!task) continue;
    if (task.length < 3) continue;
    if (stopWords.indexOf(task.toLowerCase()) !== -1) continue;
    // Capitalize first letter
    tasks.push(task.charAt(0).toUpperCase() + task.slice(1));
  }

  return tasks;
}

function createTask(content, callback) {
  var xhr = new XMLHttpRequest();
  var body = { content: content };
  if (settings.projectId) {
    body.project_id = settings.projectId;
    console.log('[DEBUG_LOG] createTask: using projectId ' + settings.projectId); // DEBUG_LOG
  } else {
    console.log('[DEBUG_LOG] createTask: no projectId, using Inbox'); // DEBUG_LOG
  }
  console.log('[DEBUG_LOG] createTask: apiKey present=' + (settings.apiKey ? 'yes, starts with "' + settings.apiKey.substring(0, 4) + '"' : 'NO - EMPTY')); // DEBUG_LOG

  xhr.onload = function() {
    console.log('[DEBUG_LOG] createTask: response status=' + this.status + ' body=' + this.responseText.substring(0, 200)); // DEBUG_LOG
    callback(this.status, this.responseText);
  };
  xhr.onerror = function() {
    console.log('[DEBUG_LOG] createTask: xhr.onerror fired'); // DEBUG_LOG
    callback(0, 'Network error');
  };

  xhr.open('POST', 'https://api.todoist.com/api/v1/tasks');
  xhr.setRequestHeader('Authorization', 'Bearer ' + settings.apiKey);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.send(JSON.stringify(body));
}

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

function sendToWatch(payload, label) {
  Pebble.sendAppMessage(payload,
    function() { console.log('Sent to watch: ' + label); },
    function() { console.log('Failed to send to watch: ' + label); }
  );
}

Pebble.addEventListener('showConfiguration', function() {
  console.log('[DEBUG_LOG] showConfiguration fired, opening Clay URL'); // DEBUG_LOG
  Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener('webviewclosed', function(e) {
  console.log('[DEBUG_LOG] webviewclosed fired, e.response=' + (e && e.response ? 'present (length=' + e.response.length + ')' : 'missing/empty')); // DEBUG_LOG
  if (!e || !e.response) {
    console.log('[DEBUG_LOG] webviewclosed: no response — user cancelled'); // DEBUG_LOG
    return;
  }
  try {
    // Pass false to get string-named keys with {value: ...} wrappers
    var claySettings = clay.getSettings(e.response, false);
    console.log('[DEBUG_LOG] webviewclosed: parsed claySettings keys=' + Object.keys(claySettings).join(',')); // DEBUG_LOG
    console.log('[DEBUG_LOG] webviewclosed: TodoistApiKey entry=' + JSON.stringify(claySettings.TodoistApiKey)); // DEBUG_LOG
    console.log('[DEBUG_LOG] webviewclosed: TodoistProjectId entry=' + JSON.stringify(claySettings.TodoistProjectId)); // DEBUG_LOG
    var apiKey = (claySettings.TodoistApiKey && claySettings.TodoistApiKey.value) ? String(claySettings.TodoistApiKey.value) : '';
    var projectId = (claySettings.TodoistProjectId && claySettings.TodoistProjectId.value) ? String(claySettings.TodoistProjectId.value) : '';
    saveSettings(apiKey, projectId);
  } catch (err) {
    console.log('[DEBUG_LOG] webviewclosed: error parsing settings: ' + err.message + ' stack=' + err.stack); // DEBUG_LOG
  }
});

Pebble.addEventListener('ready', function() {
  console.log('[DEBUG_LOG] Pebble ready event fired'); // DEBUG_LOG
  loadSettings();
  console.log('[DEBUG_LOG] After loadSettings: apiKey=' + (settings.apiKey ? 'set' : 'EMPTY') + ' projectId=' + (settings.projectId || 'EMPTY')); // DEBUG_LOG
  console.log('Ramble List JS ready');
});

Pebble.addEventListener('appmessage', function(e) {
  var payload = e.payload;

  // Dictation text from watch
  if (payload['DICTATION_TEXT'] !== undefined) {
    var text = payload['DICTATION_TEXT'];
    console.log('Received dictation text: ' + text);
    console.log('[DEBUG_LOG] appmessage: settings.apiKey=' + (settings.apiKey ? '"' + settings.apiKey.substring(0, 4) + '..."' : 'EMPTY') + ' projectId=' + (settings.projectId || 'EMPTY')); // DEBUG_LOG

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

    createTasksSequentially(tasks, 0, 0, function(count, err) {
      if (err && count === 0) {
        sendToWatch({'RESULT_ERROR': err}, 'todoist error');
      } else {
        // Report success even if some failed — count is how many succeeded
        sendToWatch({'RESULT_SUCCESS': count}, 'success: ' + count + ' tasks');
      }
    });
  }
});
