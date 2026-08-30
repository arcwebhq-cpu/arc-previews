'use strict';

const { BLOCKED_SAMPLE, OUTPUT_FIELDS } = require('../policy');

function createDispatchAction({ description, key, label, noun, perform }) {
  return Object.freeze({
    key,
    noun,
    display: Object.freeze({
      label,
      description
    }),
    operation: Object.freeze({
      inputFields: Object.freeze([]),
      outputFields: OUTPUT_FIELDS,
      cleanInputData: false,
      perform,
      sample: BLOCKED_SAMPLE
    })
  });
}

module.exports = Object.freeze({ createDispatchAction });
