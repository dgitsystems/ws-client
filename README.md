# Inomial Websocket Client

This is a node based client for accessing the [Inomial](http://www.inomial.com/)
GraphQL API via WebSockets.

The API provides the following capabilities:

* Low latency: uses a single persistent WebSocket connection for all operations.
* Real time delivery of GraphQL Subscription events.
* Asynchronous, promise-based queries and mutations.
* Automatic re-connection after connection failure.
* Automatic re-transmission of queries and mutations after connection failure.
* Maintains subscriptions between connection failures.

The client is written in (and requires) ECMAScript 6.

# Installing

Run "npm install" to install the dependencies.

# Using the Client

The included `InomialCommand.js` script provides examples of using the client,
but here's the cheat sheet. Utility functions provided by the client are
documented below. 

## Include the library

    const InomialClient = require("./InomialClient.js");

## Connect to the server

    const client = InomialClient.connect(hostname, stage, origin, apikey);

* `hostname`: the hostname of the inomial service; for example: `example.inomial.com`
* `stage`: the Inomial production stage; for example: `live`, `test`, `dev` etc.
* `origin`: The HTTP origin header. Helps with debugging but can be `null`.
*  `apikey`: The API Key provided by Inomial.

## Subscribing to events

Subscribe to events using the `client.subscribe` call. This executes the given
query (which must start with `subscription`) with the specified variables, and
executes the callback each time an event arrives. The subscription is persistent
for the life of the client, and will reconnect if the server disconnects. 

    client.subscribe(query, variables, callback);

> TODO: we don't track the subscription offset when reconnecting, which is a bug.
> We might need to rethink this API slightly.

The callback function has the signature:

    function myCallback(event) {
        console.log("RECEIVED EVENT:" + JSON.stringify(event));
    }

The `event` is the exact JSON received from the server.

## Executing Queries (and Mutations)

> Note: Queries are handled identically to mutations; in the remaining document, you
> can read "query" as either "query" or "mutation".

Queries work by sending a query over the WebSocket connection, and returning
a `Promise`. The query will be executed asynchronously on the server side;
there is no guarantee that queries will be processed in the order they are
sent.

Asynchronous processing of queries is a feature which enables fast, progressive page
builds for interactive clients, and greater performance through parallel
execution in headless clients.

**WARNING** Like queries, mutations are executed in parallel. If you want to execute
mutations sequentially, simply use a promise chain (see below).

To perform a query and then print the results, we use a
[Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises):

    client.query(query, variables)
      .then((response) => { console.log("RECEIVED RESULT: " + JSON.stringify(response)); });

in this call:
* `query` is the GraphQL query
* `variables` is the (optional) set of variables to be used in the query.

When the query completes, the _then()_ closure is executed.

## Promises and Promise Chains

Promises work by adding a task to a queue; they are executed in the background.
When the promise _resolves_, any closures (specified by _then()_) are
executed. You can chain promises together so that they operate one after
the other. In the case of the Inomial client, the task is actually sent to the
server for processing; the promise resolves when we receive the response.

The Inomial Websocket API is fully asynchronous on both the client and server
side. What this means in practice is that you can fire off as many queries
as you want, but the responses will arrive in the order that the queries complete;
fastest query wins.

Consider the following:

    let promise1 = client.query("{ account(uuid: \"D097E534-BB96-4B51-9532-90CFBDEF2124\") { usn Transactions { objects { txNumber } } } }")
        .then((response) => { console.log("RECEIVED RESULT: " + JSON.stringify(response)); });

    let promise2 = client.query("{ account(uuid: \"240AA2A5-A3AD-4E0E-9D7E-81F4BDD5973A\") { usn } }")
         .then((response) => { console.log("RECEIVED RESULT: " + JSON.stringify(response)); });

The first query is far more complex than the second, so the second query is probably
going to complete (and print to the console) before the first one.

If you want to make sure that queries (and especially mutations) execute in order,
use a [promise chain](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises#Chaining):

    let promiseChain = client.query("{ account(uuid: \"D097E534-BB96-4B51-9532-90CFBDEF2124\") { usn Transactions { objects { txNumber } } } }")
      .then((response) => { client.query("{ account(uuid: \"240AA2A5-A3AD-4E0E-9D7E-81F4BDD5973A\") { usn } }")
      .then((response) => { console.log("RECEIVED RESULT: " + JSON.stringify(response)); });

In this example, once the complex query completes, it executes the second query.
Once that completes, it prints the results.

# Utility Functions

#### `getAccountUuid(usn)`

Returns a `Promise` which resolves to the UUID of the given account USN. The result
is cached, so this function may resolve immediately.

#### `getSubscriptionUuid(usn)`

Returns a `Promise` which resolves to the UUID of the given subscription USN. The result
is cached, so this function may resolve immediately.

#### `getOffset(subscriber)`

The offset functions provide a simple way of storing event offsets in the Inomial
server, making it unnecessary for event handlers to need local storage.

`getOffset` returns a `Promise` which resolves to the last offset stored for the given
_subscriber_ string. The returned offset is an opaque string value which can be used in
`subscription` queries.

Note that the _subscriber_ is just an arbitrary string value, and you should use a unique
subscriber for each client/subscription combination. For example, if your client
subscribes to two GraphQL events, it should use a _different_ subscriber ID for each
subscription, and that ID should be different from the ID used by any other client. 

#### `setOffset(subscriber, offset)`

The offset functions provide a simple way of storing event offsets in the Inomial
server, making it unnecessary for event handlers to need local storage.

`setOffset` updates the currently stored offset to the provided `offset`. The `offset`
is an opaque string value which is returned by the `offset` field of subscription
events.

To prevent accidentally resetting the offset, `setOffset` won't update the offset if
the new value could result in messages being delivered again.