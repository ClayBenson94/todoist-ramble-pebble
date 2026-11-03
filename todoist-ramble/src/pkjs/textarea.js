// Clay component for multi-line text input, which Clay doesn't provide out of the box.
// Mirrors Clay's built-in input component (and reuses its component-input styles) so it
// looks like the other text fields; config items use it with "type": "textarea".
module.exports = {
  name: 'textarea',
  template:
    '<div class="component component-input component-textarea">' +
      '<label class="tap-highlight">' +
        '<span class="label">{{{label}}}</span>' +
        '<span class="input">' +
          '<textarea data-manipulator-target ' +
            '{{each key: attributes}}{{key}}="{{this}}"{{/each}}></textarea>' +
        '</span>' +
      '</label>' +
      '{{if description}}<div class="description">{{{description}}}</div>{{/if}}' +
    '</div>',
  style:
    '.component-textarea textarea {' +
      'display: block; width: 100%; min-height: 8rem; resize: vertical;' +
      'padding: 0.35rem 0.375rem; border: none; border-radius: 0.25rem;' +
      'background: #333333; color: #ffffff;' +
      'font-family: Menlo, Consolas, monospace; font-size: inherit; line-height: 1.4;' +
      '-webkit-appearance: none; appearance: none;' +
    '}' +
    '.component-textarea textarea::placeholder { color: #858585; }' +
    '.component-textarea textarea:focus { outline: none; box-shadow: none; }',
  manipulator: 'val',
  defaults: {
    label: '',
    description: '',
    attributes: {}
  }
};
