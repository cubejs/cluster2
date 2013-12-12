'use strict';

var cluster2 = process.cluster2 = process.cluster2 || {};
cluster2.status = cluster2.status || require('./lib/status');

module.exports = cluster2.status;