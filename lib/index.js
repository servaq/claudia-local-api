'use strict';

const program = require('commander');
const path = require('path');

const packageJson = require('../package');

// Added to handle path parameters.
var Path = require('path-parser');

function getDefaultConfig() {
    return {
        port: 3000
    };
}

function initServer() {
    const express = require('express');
    const bodyParser = require('body-parser');

    const server = express();
    server.use(bodyParser.urlencoded({
        extended: true
    }));
    server.use(bodyParser.json());

    return server;
}

function initLogger() {
    const bunyan = require('bunyan');
    return bunyan.createLogger({
        name: packageJson.name
    });
}

function logJson(logger, body) {
    logger.info(JSON.stringify(body, null, 4));
}

function logError(logger, error) {
    logger.error(error.stack);
}

function getPathParameters(allPaths, endpoint) {
    var i;
    var _path;
    var pathParameters;

    if (!allPaths) {
        return {
            pathPattern: endpoint,
            pathParameters: {}
        };
    }

    for (i = 0; i < allPaths.length; i++) {
        _path = allPaths[i];
        pathParameters = _path.path.test(endpoint);
        if (pathParameters !== null) {
            return {pathPattern: _path.pattern, pathParameters};
        }
    }
}

function getParams(req, app) {
    var pathParams = getPathParameters(app.allPaths, req._parsedUrl.pathname);

    return {
        requestContext: {
            resourcePath: pathParams.pathPattern,
            httpMethod: req.method
        },
        headers: req.headers,
        queryStringParameters: req.query,
        body: JSON.stringify(req.body),
        stageVariables: {environment: 'dev'},
        pathParameters: pathParams.pathParameters
    };
}

function makeHandleResponse(logger, res) {
    return function (err, response) {
        if (err) {
            logError(logger, err);
            const body = {
                message: err.message
            };
            return res
                .status(500)
                .send(body);
        }
        logJson(logger, response);
        return res
            .set(response.headers || {})
            .status(response.statusCode || 200)
            .send(response.body || {});
    };
}

function makeHandleRequest(logger, app) {
    return function (req, res) {
        const params = getParams(req, app);
        logJson(logger, params);
        app.proxyRouter(params, {
            done: makeHandleResponse(logger, res)
        });
    };
}

function bootstrap(server, logger, claudiaApp, options) {
    const handleRequest = makeHandleRequest(logger, claudiaApp);

    server.all('*', handleRequest);
    const instance = server.listen(options.port);
    logger.info(`Server listening on ${options.port}`);
    return instance;
}

function convertRoute(route) {
    var _route = route.replace(/{(.+?)}/g, ':$1');
    return new Path(_route);
}

function getRoutes(obj) {
    var toReturn = [];
    var r;
    var k;

    for (k in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) {
            continue;
        }

        k = `/${k}`;
        r = {
            path: convertRoute(k),
            pattern: k
        };

        toReturn.push(r);
    }

    return toReturn;
}

function runCmd(bootstrapFn) {
    const config = getDefaultConfig();
    program
        .version(packageJson.version)
        .option('-a --api-module <apiModule>', 'Specify claudia api path from project root')
        .option('-p --port [port]', `Specify port to use [${config.port}]`, config.port)
        .parse(process.argv);

    const apiPath = path.join(process.cwd(), program.apiModule);
    const claudiaApp = require(apiPath);

    // Extract all routes from App and save it in app instance.
    claudiaApp.allPaths = getRoutes(claudiaApp.apiConfig().routes);

    const server = initServer();
    const logger = initLogger();
    bootstrapFn(server, logger, claudiaApp, program);
}

module.exports = {
    run: runCmd.bind(null, bootstrap)
};
