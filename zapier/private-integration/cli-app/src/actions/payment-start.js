'use strict';

const { createDispatchAction } = require('./action-factory');
const { runPaymentStartAdapter } = require('../provider-adapters');

module.exports = createDispatchAction({
  key: 'arc2_payment_start',
  noun: 'ARC Payment Start',
  label: 'ARC V11 Payment Start — OFF',
  description: 'Default-OFF dispatch to the pinned first-party payment run-one worker.',
  perform: runPaymentStartAdapter
});
