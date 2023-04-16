'use strict';

const request = require('postman-request');
const config = require('./config/config');
const async = require('async');
const fs = require('fs');

let Logger;
let requestWithDefaults;

const MAX_PARALLEL_LOOKUPS = 10;

function startup(logger) {
  Logger = logger;

  let requestOptions = {};

  if (typeof config.request.cert === 'string' && config.request.cert.length > 0) {
    requestOptions.cert = fs.readFileSync(config.request.cert);
  }

  if (typeof config.request.key === 'string' && config.request.key.length > 0) {
    requestOptions.key = fs.readFileSync(config.request.key);
  }

  if (typeof config.request.passphrase === 'string' && config.request.passphrase.length > 0) {
    requestOptions.passphrase = config.request.passphrase;
  }

  if (typeof config.request.ca === 'string' && config.request.ca.length > 0) {
    requestOptions.ca = fs.readFileSync(config.request.ca);
  }

  if (typeof config.request.proxy === 'string' && config.request.proxy.length > 0) {
    requestOptions.proxy = config.request.proxy;
  }

  if (typeof config.request.rejectUnauthorized === 'boolean') {
    requestOptions.rejectUnauthorized = config.request.rejectUnauthorized;
  }

  requestWithDefaults = request.defaults(requestOptions);
}

/**
 *
 * @param entities
 * @param options
 * @param cb
 */
function doLookup(entities, options, cb) {
  const lookupResults = [];
  const tasks = [];

  Logger.trace({ entities }, 'doLookup');

  entities.forEach((entity) => {
    const requestOptions = {
      uri: `https://api11.scamalytics.com/${options.orgName}`,
      method: 'GET',
      qs: {
        key: options.apiKey,
        ip: entity.value
      },
      json: true
    };

    tasks.push(function (done) {
      Logger.debug({ requestOptions: requestOptions }, 'Sending Request');
      requestWithDefaults(requestOptions, function (error, res, body) {
        if (error) {
          Logger.error(
            {
              error: error,
              status: response.statusCode ? response.statusCode : 'N/A'
            },
            'HTTP Request Error'
          );
          done({
            detail: 'HTTP Request Error',
            error
          });
          return;
        }

        if (res.statusCode === 200 && body.status === 'ok') {
          done(null, {
            entity: entity,
            body: body
          });
        } else {
          done(body);
        }
      });
    });
  });

  async.parallelLimit(tasks, MAX_PARALLEL_LOOKUPS, (err, results) => {
    if (err) {
      cb({
        detail: err.error,
        ...err
      });
      return;
    }

    results.forEach((result) => {
      if (result.body && result.body.score >= options.minScore) {
        lookupResults.push({
          entity: result.entity,
          data: {
            summary: getSummaryTags(result.body, options),
            details: result.body
          }
        });
      } else {
        lookupResults.push({
          entity: result.entity,
          data: null
        });
      }
    });

    Logger.debug({ lookupResults }, 'Results');

    cb(null, lookupResults);
  });
}

function getSummaryTags(body, options) {
  const tags = [];

  if (typeof body.score !== 'undefined') {
    if (
      body.score >= options.baselineInvestigationThreshold &&
      options.baselineInvestigationThreshold !== -1
    ) {
      tags.push({
        type: 'danger',
        text: `Risk: ${body.risk} (${body.score} / 100)`
      });
    } else {
      tags.push(`Risk: ${body.risk} (${body.score} / 100)`);
    }
  }

  return tags;
}

function validateOptions(userOptions, cb) {
  let errors = [];

  if (
    typeof userOptions.apiKey.value !== 'string' ||
    (typeof userOptions.apiKey.value === 'string' && userOptions.apiKey.value.length === 0)
  ) {
    errors.push({
      key: 'apiKey',
      message: 'You must provide a Scamalytics API key'
    });
  }

  cb(null, errors);
}

module.exports = {
  doLookup: doLookup,
  startup: startup,
  validateOptions: validateOptions
};
