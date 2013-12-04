'use strict';

var cluster2 = process.cluster2 = process.cluster2 || {};
cluster2.emitter = cluster2.emitter || require('./lib/emitter');

module.exports = cluster2.emitter;