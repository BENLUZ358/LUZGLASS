'use strict';
const assert=require('node:assert/strict');
const {estimateCostUsd}=require('../api/_sketch-reader');
assert.equal(estimateCostUsd('gpt-5.4',{input_tokens:5000,output_tokens:1000}),0.0275);
assert.equal(estimateCostUsd('gpt-5.4',{input_tokens:5000,output_tokens:1000,input_tokens_details:{cached_tokens:1000}}),0.02525);
assert.equal(estimateCostUsd('other',{input_tokens:1,output_tokens:1}),null);
assert.equal(estimateCostUsd('gpt-5.4',null),null);
assert.equal(estimateCostUsd('gpt-5.4',{input_tokens:300000,output_tokens:1}),null);
console.log('sketch-reader cost calculation: PASS');
