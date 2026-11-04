// Clay component that edits keyword rules as a list of rows instead of raw JSON.
// Each row pairs comma-separated keywords with the text that replaces them ("/Costco",
// "@Urgent", ...), and a hint under the row says how the rule will apply, or what's wrong
// with it, as the user types. The value it saves is the JSON list keyword-rules.js parses:
//   [{"keywords": ["costco", "bulk"], "replace": "/Costco"}, ...]
//
// Clay serializes this object into the settings page, so every function in it must be
// self-contained: ES5 only, and no references to anything outside its own body. index.js
// passes the rules parser to the page through Clay's userData.
module.exports = {
  name: 'keyword-rules',
  template:
    '<div class="component component-keyword-rules">' +
      '<div class="kr-fields kr-columns">' +
        '<span class="kr-keywords">Keywords</span>' +
        '<span class="kr-arrow">&rarr;</span>' +
        '<span class="kr-replace">Replace with</span>' +
        '<span class="kr-remove"></span>' +
      '</div>' +
      '<div class="kr-rows"></div>' +
      '<button type="button" class="kr-add">+ Add rule</button>' +
    '</div>',
  style:
    '.component-keyword-rules .kr-fields { display: flex; align-items: flex-start; }' +
    '.component-keyword-rules .kr-keywords { flex: 4; min-width: 0; }' +
    '.component-keyword-rules .kr-replace { flex: 3; min-width: 0; }' +
    '.component-keyword-rules .kr-arrow { padding: 0 0.3rem; color: #858585; line-height: 2.1rem; }' +
    '.component-keyword-rules .kr-columns { padding-bottom: 0.35rem; font-size: 0.9em; color: #a4a4a4; }' +
    '.component-keyword-rules .kr-columns .kr-arrow { visibility: hidden; line-height: inherit; }' +
    '.component-keyword-rules .kr-row { margin-bottom: 0.6rem; }' +
    '.component-keyword-rules input, .component-keyword-rules textarea {' +
      'display: block; padding: 0.35rem 0.375rem; border: none; border-radius: 0.25rem;' +
      'background: #333333; color: #ffffff; font: inherit; line-height: 1.4; min-height: 2.1rem;' +
      '-webkit-appearance: none; appearance: none;' +
    '}' +
    '.component-keyword-rules textarea { height: 2.1rem; resize: none; overflow: hidden; }' +
    '.component-keyword-rules ::placeholder { color: #666666; }' +
    '.component-keyword-rules input:focus, .component-keyword-rules textarea:focus { outline: none; box-shadow: none; }' +
    '.component-keyword-rules .kr-remove {' +
      'flex: none; width: 2rem; min-width: 0; margin: 0 0 0 0.2rem; padding: 0;' +
      'background: none; color: #a4a4a4; font-size: 1.5rem; line-height: 2.1rem;' +
    '}' +
    '.component-keyword-rules .kr-hint { padding-top: 0.2rem; font-size: 0.85em; color: #a4a4a4; }' +
    '.component-keyword-rules .kr-hint:empty { display: none; }' +
    '.component-keyword-rules .kr-hint.kr-error { color: #ff4700; }' +
    '.component-keyword-rules .kr-add { display: block; margin: 0.9rem auto 0.2rem; }',
  manipulator: {
    get: function() {
      return this.keywordRulesEditor.getValue();
    },
    set: function(value) {
      this.keywordRulesEditor.setValue(value);
      return this.trigger('change');
    }
  },
  initialize: function(minified, clayConfig) {
    var root = this.$element[0];
    var rowsEl = root.querySelector('.kr-rows');
    var userData = (clayConfig.meta && clayConfig.meta.userData) || {};
    var parseKeywordRules = userData.parseKeywordRules;

    function escapeHtml(text) {
      return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // "costco, Bulk, " -> ["costco", "Bulk"]
    function splitKeywords(text) {
      return text.split(',').map(function(keyword) {
        return keyword.trim();
      }).filter(function(keyword) {
        return keyword !== '';
      });
    }

    function readRow(row) {
      return {
        keywords: splitKeywords(row.querySelector('.kr-keywords').value),
        replace: row.querySelector('.kr-replace').value.trim()
      };
    }

    // Grows a keywords box to fit its text, so long keyword lists wrap instead of being cut off
    function fitHeight(textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    }

    function describeRule(rule) {
      var effects = [];
      if (rule.text) effects.push('text "' + escapeHtml(rule.text) + '"');
      if (rule.section) effects.push('section <b>' + escapeHtml(rule.section) + '</b>');
      rule.labels.forEach(function(label) {
        effects.push('label <b>' + escapeHtml(label) + '</b>');
      });
      return '&rarr; ' + (effects.length ? effects.join(', ') : 'removed from the task');
    }

    // Shows under a row what its rule will do, or why the app will skip it
    function updateHint(row) {
      var rule = readRow(row);
      var hint = row.querySelector('.kr-hint');
      var message = '';
      var isError = false;
      if (rule.keywords.length === 0) {
        isError = rule.replace !== '';
        message = isError ? 'Add a keyword to listen for' : '';
      } else if (typeof parseKeywordRules === 'function') {
        var result = parseKeywordRules(JSON.stringify([rule]));
        isError = !!result.error;
        message = isError ?
          escapeHtml(result.error.replace(/^Rule \d+: (.)/, function(match, first) {
            return first.toUpperCase();
          })) :
          describeRule(result.rules[0]);
      }
      hint.innerHTML = message;
      hint.className = 'kr-hint' + (isError ? ' kr-error' : '');
    }

    function addRow(keywords, replace) {
      var row = document.createElement('div');
      row.className = 'kr-row';
      row.innerHTML =
        '<div class="kr-fields">' +
          '<textarea class="kr-keywords" rows="1" placeholder="costco, bulk" enterkeyhint="next"></textarea>' +
          '<span class="kr-arrow">&rarr;</span>' +
          '<input type="text" class="kr-replace" placeholder="/Costco" enterkeyhint="done">' +
          '<button type="button" class="kr-remove" aria-label="Remove rule">&times;</button>' +
        '</div>' +
        '<div class="kr-hint"></div>';
      Array.prototype.forEach.call(row.querySelectorAll('textarea, input'), function(field) {
        field.setAttribute('autocapitalize', 'off');
        field.setAttribute('autocorrect', 'off');
        field.setAttribute('autocomplete', 'off');
        field.setAttribute('spellcheck', 'false');
      });
      row.querySelector('.kr-keywords').value = keywords;
      row.querySelector('.kr-replace').value = replace;
      rowsEl.appendChild(row);
      updateHint(row);
      return row;
    }

    rowsEl.addEventListener('input', function(event) {
      if (event.target.classList.contains('kr-keywords')) fitHeight(event.target);
      updateHint(event.target.closest('.kr-row'));
    });

    rowsEl.addEventListener('click', function(event) {
      if (!event.target.classList.contains('kr-remove')) return;
      rowsEl.removeChild(event.target.closest('.kr-row'));
      // Keep one blank row so the placeholders still show what to type
      if (!rowsEl.firstChild) addRow('', '');
    });

    // Enter moves to the next field instead of submitting (and closing) the settings page
    rowsEl.addEventListener('keydown', function(event) {
      if (event.keyCode !== 13) return;
      event.preventDefault();
      if (event.target.classList.contains('kr-keywords')) {
        event.target.closest('.kr-row').querySelector('.kr-replace').focus();
      } else {
        event.target.blur();
      }
    });

    root.querySelector('.kr-add').addEventListener('click', function() {
      addRow('', '').querySelector('.kr-keywords').focus();
    });

    this.keywordRulesEditor = {
      // Saves every row that isn't blank, including ones with problems so they aren't lost;
      // the app skips those until they're fixed
      getValue: function() {
        var rules = [];
        Array.prototype.forEach.call(rowsEl.children, function(row) {
          var rule = readRow(row);
          if (rule.keywords.length || rule.replace) rules.push(rule);
        });
        return rules.length ? JSON.stringify(rules) : '';
      },
      setValue: function(value) {
        var rules;
        try {
          // Rules typed as JSON in the old textarea may have smart quotes or trailing commas
          rules = JSON.parse(String(value || '')
            .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
            .replace(/,\s*([\]}])/g, '$1') || '[]');
        } catch (e) {
          rules = [];
        }
        rowsEl.innerHTML = '';
        (Array.isArray(rules) ? rules : []).forEach(function(rule) {
          if (!rule || typeof rule !== 'object') return;
          var keywords = Array.isArray(rule.keywords) ? rule.keywords.join(', ') : String(rule.keywords || '');
          addRow(keywords, typeof rule.replace === 'string' ? rule.replace : '');
        });
        if (!rowsEl.firstChild) addRow('', '');
        // Clay adds the component to the page right after setting its value, and text can only
        // be measured once it's on the page
        setTimeout(function() {
          Array.prototype.forEach.call(rowsEl.querySelectorAll('.kr-keywords'), fitHeight);
        }, 0);
      }
    };
  }
};
