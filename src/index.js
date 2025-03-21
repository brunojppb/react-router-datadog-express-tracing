// ##      ##    ###    ########  ##    ## #### ##    ##  ######
// ##  ##  ##   ## ##   ##     ## ###   ##  ##  ###   ## ##    ##
// ##  ##  ##  ##   ##  ##     ## ####  ##  ##  ####  ## ##
// ##  ##  ## ##     ## ########  ## ## ##  ##  ## ## ## ##   ####
// ##  ##  ## ######### ##   ##   ##  ####  ##  ##  #### ##    ##
// ##  ##  ## ##     ## ##    ##  ##   ###  ##  ##   ### ##    ##
//  ###  ###  ##     ## ##     ## ##    ## #### ##    ##  ######
//
// This file must be imported via the Node CLI when starting up the application
// so it can inject the Datadog tracer plugins in the right order.
// This should be imported like this (the order of these imports matter):
//
// node --import dd-trace/register.js --import remix-dd-route-matcher  my_app.js
//
// The hooks on this file add a router matching algorithm based in React Router
// so the Remix URL patterns show up in Datadog correctly.
// See the following Github issue where I managed to share this workaround
// See: https://github.com/DataDog/dd-trace-js/issues/3283#issuecomment-1853959632
/* eslint-disable no-console */
import fs from 'node:fs';
import tracer from 'dd-trace';
import { matchPath } from 'react-router';

/**
 * Given a request path, tries to find a React Router route path pattern
 * that matches with an existing route in our React app.
 * @param {string} requestPath
 */
function matchReactRouterRoutePattern(requestPath) {
  const routes = loadRoutesFile();

  for (const routePattern of routes) {
    if (matchPath(routePattern, requestPath) !== null) {
      return routePattern;
    }
  }

  return null;
}

/** @type {Array<string> | null} */
let routesCache = null;

/**
 * The React Router routes file is loaded only once during startup.
 * Then it's cached in-memory for the entire app lifecycle.
 */
function loadRoutesFile() {
  if (routesCache) {
    return routesCache;
  }

  if (typeof process.env.REACT_ROUTER_DD_ROUTE_FILE === 'undefined') {
    throw new Error(
      'No React Router routes file passed in the REACT_ROUTER_DD_ROUTE_FILE environment variable. ' +
        'Please generate a React Router routes file with the React Router CLI during build time ' +
        'with the following command: `react-router routes --json >> ./build/react_router_routes.json `' +
        'and assign the JSON file path to the REACT_ROUTER_DD_ROUTE_FILE environment variable.',
    );
  }

  const routesFile = fs.readFileSync(process.env.REACT_ROUTER_DD_ROUTE_FILE, 'utf8');

  const routesJson = JSON.parse(routesFile);
  const routes = flattenRoutes(routesJson);

  routesCache = routes;

  return routes;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
/**
 *
 * @param {any} json Remix routes output encoded as JSON
 * @returns
 */
function flattenRoutes(json) {
  /** @type {Array<string>} */
  let paths = [];

  for (const entry of json) {
    if (entry.children) {
      const mappedPaths = flattenRoutes(entry.children)
        .filter((path) => typeof path !== 'undefined')
        .map((path) => `${entry.path}/${path}`);
      paths = [...paths, entry.path, ...mappedPaths];
    } else {
      paths.push(entry.path);
    }
  }

  return paths;
}

/**
 * Enrich Dadadog tracing span with the current request path
 * matching React Router route patterns.
 *
 * While dd-trace doesn't have support for React Router, we must do
 * this manually for now.
 * See: https://github.com/DataDog/dd-trace-js/issues/3283
 */
function enrichTracer() {
  tracer.use('express', {
    hooks: {
      request: (span, request, _response) => {
        const host = request?.headers.host;
        const path = request?.url;

        if (host && path && span) {
          try {
            const url = new URL(`https://${host}${path}`);
            const matchPattern = matchReactRouterRoutePattern(url.pathname);

            if (matchPattern) {
              span.setTag('http.route', matchPattern);
            }
          } catch (error) {
            console.debug(`Invalid request host=${host} path=${path}`, error);
          }
        }
      },
    },
  });
}

enrichTracer();
