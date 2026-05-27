var Clay = require('@rebble/clay');
var clayConfig = require('./config');
var clay = new Clay(clayConfig, null, { autoHandleEvents: false });

var settings = {
  apiKey: '',
  projectId: '',
  skipPreview: false
};

var STORAGE_KEY_API = 'ramble_apiKey';
var STORAGE_KEY_PROJECT = 'ramble_projectId';
var STORAGE_KEY_SKIP_PREVIEW = 'ramble_skipPreview';

var s_pending_tasks = null;

function loadSettings() {
  var apiKey = localStorage.getItem(STORAGE_KEY_API) || '';
  var projectId = localStorage.getItem(STORAGE_KEY_PROJECT) || '';
  var skipPreview = localStorage.getItem(STORAGE_KEY_SKIP_PREVIEW);
  settings.apiKey = apiKey;
  settings.projectId = projectId;
  settings.skipPreview = (skipPreview === 'true');
  console.log('Settings loaded. API key set: ' + (settings.apiKey ? 'yes' : 'no') +
              ', project ID: ' + (settings.projectId || 'inbox') +
              ', skipPreview: ' + settings.skipPreview);
}

function saveSettings(apiKey, projectId, skipPreview) {
  settings.apiKey = apiKey;
  settings.projectId = projectId;
  settings.skipPreview = !!skipPreview;
  localStorage.setItem(STORAGE_KEY_API, apiKey);
  localStorage.setItem(STORAGE_KEY_PROJECT, projectId);
  localStorage.setItem(STORAGE_KEY_SKIP_PREVIEW, settings.skipPreview ? 'true' : 'false');
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
    var task = parts[i].trim().replace(/^(and|also|then|next|but|or|so)\s+/i, '');
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
  Pebble.openURL(clay.generateUrl());
});

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
    saveSettings(apiKey, projectId, skipPreview);
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

Pebble.addEventListener('ready', function() {
  loadSettings();
  console.log('Todoist Ramble JS ready');
});

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
      createTasksSequentially(tasks, 0, 0, function(count, err) {
        if (err && count === 0) {
          sendToWatch({'RESULT_ERROR': err}, 'todoist error');
        } else {
          sendToWatch({'RESULT_SUCCESS': count}, 'success: ' + count + ' tasks');
        }
      });
    } else {
      // Send task list to watch for preview/confirmation
      s_pending_tasks = tasks;
      sendToWatch({'TASK_PREVIEW': tasks.join('|')}, 'task preview');
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
    createTasksSequentially(tasks, 0, 0, function(count, err) {
      if (err && count === 0) {
        sendToWatch({'RESULT_ERROR': err}, 'todoist error');
      } else {
        sendToWatch({'RESULT_SUCCESS': count}, 'success: ' + count + ' tasks');
      }
    });
  }
});
