'use strict';

const { createBlockedAction } = require('./action-factory');
const { runPaymentStartAdapter } = require('../provider-adapters');

module.exports = createBlockedAction({
  key: 'arc2_payment_start',
  noun: 'ARC Payment Start',
  label: 'ARC V11 Payment Start — BLOCKED',
  description: 'Fail-closed placeholder for the unpublished ARC payment-start worker.',
  perform: runPaymentStartAdapter
});
