// Keyword rules: swap spoken keywords for Todoist sections, labels, or other text.
//
// Rules are edited on the settings page as a list of rows (see keyword-rules-editor.js) and
// saved as a JSON list, for example:
//   [
//     { "keywords": ["costco", "bulk"], "replace": "/Costco" },
//     { "keywords": ["today", "urgent"], "replace": "@Urgent" }
//   ]
// When a task contains a keyword, the keyword is replaced with the rule's "replace" text.
// A "/Name" part of the replacement files the task under section Name and an "@Name" part
// adds label Name; any other text is put into the task title as-is.

/**
 * Parses and validates the keyword rules JSON saved by the settings page.
 * Forgives trailing commas and curly double quotes, in case the JSON was typed by hand.
 *
 * Clay also serializes this function into the settings page (via userData) so the rules
 * editor can check each rule as it's typed, so it must stay self-contained: ES5 only, and
 * no references to anything defined outside its own body.
 *
 * @param  {string} text - rules JSON from the settings page; empty means no rules
 * @returns {{rules: Object[], error: (string|null)}} the valid rules, plus a message describing
 *          the first problem found (or null). A rule with a problem is skipped without
 *          affecting the others, while text that isn't a JSON list gives no rules at all. Each
 *          rule is {keywords: string[], text: string, section: string, labels: string[]}, where
 *          the keywords are lowercased and the replacement is split into its plain text,
 *          section name and label names.
 */
function parseKeywordRules(text) {
  // Parses one {"keywords": [...], "replace": "..."} entry, returning the rule, or a string
  // describing what's wrong with it
  function parseRule(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return 'expected { "keywords": [...], "replace": "..." }';
    }

    var rule = { keywords: [], text: '', section: '', labels: [] };

    var keywords = typeof entry.keywords === 'string' ? [entry.keywords] : entry.keywords;
    if (!Array.isArray(keywords)) {
      return '"keywords" must be a list, like ["costco", "bulk"]';
    }
    for (var k = 0; k < keywords.length; k++) {
      if (typeof keywords[k] !== 'string') {
        return 'each keyword must be text in quotes';
      }
      var keyword = keywords[k].trim().replace(/\s+/g, ' ').toLowerCase();
      if (keyword) rule.keywords.push(keyword);
    }
    if (rule.keywords.length === 0) {
      return 'needs at least one keyword';
    }

    if (typeof entry.replace !== 'string') {
      return '"replace" must be text, like "/Costco" or "@Urgent"';
    }
    // Split before each "/" or "@" that starts a word, so names can contain spaces:
    // "/Home Depot @Errand" -> section "Home Depot", label "Errand"
    var parts = entry.replace.trim().split(/\s+(?=[\/@])/);
    for (var p = 0; p < parts.length; p++) {
      var marker = parts[p].charAt(0);
      var name = parts[p].slice(1).trim();
      if (marker !== '/' && marker !== '@') {
        rule.text = parts[p];
      } else if (!name) {
        return 'add a name after "' + marker + '"';
      } else if (marker === '@') {
        rule.labels.push(name);
      } else if (rule.section) {
        return 'a task can only go in one section';
      } else {
        rule.section = name;
      }
    }
    return rule;
  }

  var source = String(text || '').trim();
  if (!source) return { rules: [], error: null };

  // Straighten smart quotes and drop trailing commas so near-JSON still parses
  source = source.replace(/[\u201C\u201D\u201E\u201F]/g, '"').replace(/,\s*([\]}])/g, '$1');

  var data;
  try {
    data = JSON.parse(source);
  } catch (e) {
    return { rules: [], error: 'Not valid JSON: ' + e.message };
  }
  if (!Array.isArray(data)) {
    return { rules: [], error: 'Rules must be a list: [ {...}, {...} ]' };
  }

  var rules = [];
  var error = null;
  for (var i = 0; i < data.length; i++) {
    var rule = parseRule(data[i]);
    if (typeof rule === 'string') {
      error = error || 'Rule ' + (i + 1) + ': ' + rule;
    } else {
      rules.push(rule);
    }
  }

  return { rules: rules, error: error };
}

/**
 * Replaces the keywords in one task's text using the parsed rules.
 * Keywords match whole words or phrases, ignoring case. Where keywords overlap, the longest
 * one wins ("home depot" before "home"), and replacement text is never re-scanned for keywords.
 * @param  {string}   text  - a single task, as split from the dictation
 * @param  {Object[]} rules - rules from parseKeywordRules()
 * @returns {{content: string, section: string, labels: string[]}} the task title with keywords
 *          replaced, the section of the first matched keyword that names one (or ''), and the
 *          labels of every matched keyword
 */
function applyKeywordRules(text, rules) {
  var task = { content: text, section: '', labels: [] };
  if (!rules || rules.length === 0) return task;

  // Index rules by keyword; if two rules share a keyword, the first one listed owns it
  var ruleByKeyword = Object.create(null);
  var keywords = [];
  rules.forEach(function(rule) {
    rule.keywords.forEach(function(keyword) {
      var key = normalizeKeyword(keyword);
      if (!(key in ruleByKeyword)) {
        ruleByKeyword[key] = rule;
        keywords.push(key);
      }
    });
  });

  // A single longest-first alternation makes overlapping keywords prefer the longer phrase
  keywords.sort(function(a, b) { return b.length - a.length; });
  var alternatives = keywords.map(function(keyword) {
    return keyword
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/ /g, '\\s+')
      .replace(/'/g, '[\'\u2019]');
  });
  var pattern = new RegExp(
    '(^|[^a-z0-9_])(' + alternatives.join('|') + ')(?![a-z0-9_])', 'gi');

  var matched = false;
  var content = text.replace(pattern, function(match, before, keyword) {
    var rule = ruleByKeyword[normalizeKeyword(keyword)];
    matched = true;
    if (rule.section && !task.section) task.section = rule.section;
    rule.labels.forEach(function(label) {
      if (task.labels.indexOf(label) === -1) task.labels.push(label);
    });
    return before + rule.text;
  });

  if (matched) {
    // Close the gaps and drop stray punctuation left where keywords were removed
    task.content = content.replace(/\s+/g, ' ').replace(/^[\s,;:\-]+|[\s,;:\-]+$/g, '');
  }
  return task;
}

/**
 * Normalizes a keyword, or text matched by one, for lookup.
 * @param  {string} keyword - keyword as configured or as heard
 * @returns {string}          lowercased, single-spaced, with curly apostrophes straightened
 */
function normalizeKeyword(keyword) {
  return keyword.toLowerCase().replace(/\s+/g, ' ').replace(/\u2019/g, '\'');
}

module.exports = {
  parseKeywordRules: parseKeywordRules,
  applyKeywordRules: applyKeywordRules
};
