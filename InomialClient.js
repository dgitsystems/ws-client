//
// An asynchronous client for sending and receiving messages to the
// Inomial GraphQL server, via a websocket.
//
// This client is the preferred way to communicate with Inomial, because
// it requires only a single HTTP connection for queries, mutations and
// subscriptions.
//

module.exports = {
    connect: function(hostname, stage, origin, apikey) {
        const client = new InomialClient(hostname, stage, origin, apikey);
        client.connect();
        return client;
    }
};


// Install the websocket client with: npm install websocket
let WebSocketClient = require('websocket').client;

class InomialClient {
//
// Create a new client of the Inomial GraphQL server.
//
    constructor(hostname, stage, origin, apikey) {
        // If the connection is down, queries are added to this queue.
        // When the connection comes back up, the queries are executed.
        this.requestQueue = [];

        // Set of outstanding queries, indexed by request ID.
        this.responseQueue = {};

        // Request ID generator.
        this.nextRequestId = 1000000;

        // URL We'll be connecting to.
        this.url = "wss://" + hostname + "/" + stage + "/api/events";

        // WSS Origin header, for non-browser clients.
        this.origin = origin;

        // API key, for non-browser clients. Browser clients will inherit the
        // HTTP session credentials.
        this.apikey = apikey;

        // The connection will be set once we connect.
        this.connection = null;

        // USN caches for accounts and subscriptions
        this.accountUuidCache = {};
        this.subscriptionUuidCache = {};

        this.reconnectPolicy = false;
    }

//
// Connect to the WebSocket server. You only need to provide
// the hostname and production stage (normally "live" or "test").
// "Origin" is the WSS Origin header; should be null for web clients, or
// you can set it to let the server know what your application name is.
//
// APIKEY is your Inomial-provided API key.
//
    connect() {
        console.log("Attempting to connect to " + this.url);

        let headers;

        if (this.apikey != null)
            headers = {"Authorization": "BASIC " + this.apikey};

        this.client = new WebSocketClient();

        this.client.on('connect', this.onConnect.bind(this));
        this.client.on('connectFailed', this.onConnectError.bind(this));

        this.client.connect(this.url, null, this.origin, headers);
    }

//
// Connection has been established. Any queries which have been waiting for the
// connection will now be executed.
//
    onConnect(connection) {
        console.log("Connection started to " + this.url);

        this.connection = connection;
        connection.on('message', this.onMessage.bind(this));
        connection.on('error', this.onError.bind(this));
        connection.on('close', this.onClose.bind(this));

        // Process requests that were made before the connection was established.
        // If something goes wrong, the requests might end up re-queued, so make a copy
        // of the request queue and reset it so it can be reused.

        let sendQueue = this.requestQueue;
        this.requestQueue = [];
        for (let i in sendQueue)
            this.sendRequest(sendQueue[i]);
    }

    onConnectError(e) {
        console.log("Unable to connect: " + e);
        console.log("  Retrying in 10 seconds");
        setTimeout(this.connect.bind(this), 10000);
    }

    /**
     * Perform a query and return a promise.
     *
     * This call accepts a string and variables. If the connection is established,
     * the query is sent immediately; if the connection is not established then the
     * query is queued until the connection becomes available.
     */
    query(queryString, variables) {
        // The query we're going to send to the server.
        let query = {
            query: queryString,
            variables: variables
        };

        // Parameters for sending the query. This holds the promise
        // resolve/reject methods.
        let request = {
            query: query,
            resolve: null,
            reject: null,
            isSubscription: false
        };

        let promise = new Promise((resolve, reject) => {
            request.resolve = resolve;
            request.reject = reject;
        });

        if (this.connection == null) {
            this.requestQueue.push(request);
            return promise;
        }

        // Internally we deal with requests, but we return a simple
        // promise to the caller.
        this.sendRequest(request);
        return promise;
    }

    /**
     * Perform a subscription. When we receive a subscription notification,
     * we call the callback function. This function doesn't return anything.
     * Note that if the websocket is not connected, the subscription may not be
     * created immediately.
     */
    subscribe(queryString, variables, callback) {

        if (callback == null)
            throw new Error("callback must not be null");

        // The query we're going to send to the server.
        let query = {
            query: queryString,
            variables: variables
        };

        // Parameters for sending the query. This holds the promise
        // resolve/reject methods.
        let request = {
            query: query,
            resolve: callback,
            reject: null,
            isSubscription: true
        };

        if (this.connection == null) {
            this.requestQueue.push(request);
            return;
        }

        // Internally we deal with requests, but we return a simple
        // promise to the caller.
        this.sendRequest(request);
    }

    /**
     * Send a request. The promise has already been set up, but we only assign a request ID
     * when we actually send the request, in case we want to re-transmit it later with a different
     * ID.
     */
    sendRequest(request) {
        let requestId = "R" + this.nextRequestId++;
        this.responseQueue[requestId] = request;

        let query = request.query;
        query.extensions = {requestId: requestId};
        this.connection.sendUTF(JSON.stringify(query));
    }

    onMessage(message) {
        if (message.type !== 'utf8') {
            console.log("Recieved unexpected response type: " + message.type);
            return;
        }

        let response = JSON.parse(message.utf8Data);
        let requestId = response.extensions != null ? response.extensions.requestId : null;

        let request = this.responseQueue[requestId];

        if (request != null) {
            // This is super important to avoid memory leaks.
            if (!request.isSubscription)
              delete this.responseQueue[requestId];
            request.resolve(response);
        } else
            console.log("Received response to unknown request " + requestId + ", response=" + JSON.stringify(response));
    }

    /**
     * Removes requests from the reply wait queue, and adds them to the send queue.
     */
    doReconnect() {
        if (!this.reconnectPolicy) {
            console.log("Auto-reconnection disabled");
            return;
        }

        console.log("Attempting to reconnect");

        this.connection = null;
        for (let requestId in this.responseQueue) {
            if (this.responseQueue.hasOwnProperty(requestId)) {
                console.log("Re-queueing request " + requestId);
                const request = this.responseQueue[requestId];
                this.requestQueue.push(request)
            }
        }

        this.responseQueue = {};
        this.connect();
    }

    onError(error) {
        console.log("onError, error=" + error);
        this.doReconnect();
    }

    onClose(reason) {
        console.log("onClose, reason=" + reason);
        this.doReconnect();
    }

    /**
     * Utility functions to obtain the UUID for an account, given the USN.
     * Some customers prefer to store the USN instead of the UUID for
     * accounts; this caching utility function makes it easy to convert.
     *
     * This function returns a promise.
     */
    getAccountUuid(usn) {
        let accountUuidCache = this.accountUuidCache;
        let uuid = accountUuidCache[usn];

        if (uuid != null) {
            return Promise.resolve(uuid);
        }

        return this
            .query("query($usn: String) { account(usn: $usn) { accountUuid } }", {usn: usn})
            .then((result) => {
                const uuid = result.data.account.accountUuid;
                accountUuidCache[usn] = uuid;
                return uuid;
            });
    }

    /**
     * Utility function to obtain the UUID for a subscription, given the USN.
     * Some customers prefer to store the USN instead of the UUID for
     * accounts; this caching utility function makes it easy to convert.
     *
     * This function returns a promise.
     */
    getSubscriptionUuid(usn) {
        let subscriptionUuidCache = this.subscriptionUuidCache;
        let uuid = subscriptionUuidCache[usn];

        if (uuid != null) {
            return Promise.resolve(uuid);
        }

        return this
            .query("query($usn: String) { subscription(usn: $usn) { subscriptionUuid } }", {usn: usn})
            .then((result) => {
                const uuid = result.data.subscription.subscriptionUuid;
                subscriptionUuidCache[usn] = uuid;
                return uuid;
            });
    }

    /**
     * Utility function to return the offset for a given subscriber, which is just a string representing
     * the subscriber who will be listening for a particular subscription. Each subscription should have
     * a unique subscriber ID, even within a single client.
     *
     * getOffset returns a promise, you should add a _then_ to the returned value to perform the actual subscription.
     */
    getOffset(subscriber) {
        return this
            .query("query($subscriber: String!) { announceGetOffset(subscriber: $subscriber) }", {subscriber: subscriber})
            .then((result) => result.data.announceGetOffset != null ? result.data.announceGetOffset : null)
    }

    setOffset(subscriber, offset) {
        return this
            .query("mutation($subscriber: String!, $offset: String!) { announceSetOffset(subscriber: $subscriber, offset: $offset) }", {subscriber: subscriber, offset: offset})
    }
}

//
// DONE: return a Promise after a query
// DONE: use extensions in the request and response to add the request ID
// DONE: dequeue queries when server comes back online.
// DONE: mark server as offline on disconnect, re-queue outstanding requests and enqueue new requests.
// DONE: remove request ID once request is complete!
// DONE: Automatically reconnect on disconnect/error/unable to connect (InomialClient.prototype.onConnectError)
// DONE: getAccountUuid(usn) / getSubscriptionUuid(usn) functions in the InomialClient (for MM).
// DONE: subscription events are removed from the request map; we can currently only receive a single event!
// NOPE: ability to cancel a promise on the client side (https://stackoverflow.com/questions/29478751/cancel-a-vanilla-ecmascript-6-promise-chain#29479435).
// DONE: simple client & server API for managing offsets
// DONE: should the client be public in github?
// TODO: command doesn't terminate when the last query is run.
// TODO: unsubscribe support (for browsers).
// TODO: deal with authentication errors (401?) via callback (for browsers)
// TODO: document the client.
// TODO: server seems to hang on to subscriptions even after disconnect (with >1 subscription active) - see below?
// TODO: appears to be a race condition where the same message can get delivered twice, run InomialCommand.js to see it happen.
//       although a reconnection also delivers the announcement, maybe that offset is being compared using <= in some cases.
//
// ql_1  | Closing web socket: WebSocket Read EOF
// ql_1  | Trying to remove future: null
// ql_1  | [qtp222947526-20] WARN org.eclipse.jetty.websocket.common.io.AbstractWebSocketConnection -
// ql_1  | java.lang.NullPointerException
// ql_1  | 	at com.inomial.smileql.announce.AnnouncementSocket.onWebSocketClose(AnnouncementSocket.java:91)
// ql_1  | 	at org.eclipse.jetty.websocket.common.events.JettyListenerEventDriver.onClose(JettyListenerEventDriver.java:98)
// ql_1  | 	at org.eclipse.jetty.websocket.common.WebSocketSession.notifyClose(WebSocketSession.java:497)
// ql_1  | 	at org.eclipse.jetty.websocket.common.WebSocketSession.onConnectionStateChange(WebSocketSession.java:540)
// ql_1  | 	at org.eclipse.jetty.websocket.common.io.IOState.notifyStateListeners(IOState.java:184)
// ql_1  | 	at org.eclipse.jetty.websocket.common.io.IOState.onReadFailure(IOState.java:498)
// ql_1  | 	at org.eclipse.jetty.websocket.common.io.AbstractWebSocketConnection.readParse(AbstractWebSocketConnection.java:546)
// ql_1  | 	at org.eclipse.jetty.websocket.common.io.AbstractWebSocketConnection.onFillable(AbstractWebSocketConnection.java:390)
// ql_1  | 	at org.eclipse.jetty.io.AbstractConnection$ReadCallback.succeeded(AbstractConnection.java:305)
// ql_1  | 	at org.eclipse.jetty.io.FillInterest.fillable(FillInterest.java:103)
// ql_1  | 	at org.eclipse.jetty.io.ChannelEndPoint$2.run(ChannelEndPoint.java:118)
// ql_1  | 	at org.eclipse.jetty.util.thread.strategy.EatWhatYouKill.runTask(EatWhatYouKill.java:333)
// ql_1  | 	at org.eclipse.jetty.util.thread.strategy.EatWhatYouKill.doProduce(EatWhatYouKill.java:310)
// ql_1  | 	at org.eclipse.jetty.util.thread.strategy.EatWhatYouKill.tryProduce(EatWhatYouKill.java:168)
// ql_1  | 	at org.eclipse.jetty.util.thread.strategy.EatWhatYouKill.run(EatWhatYouKill.java:126)
// ql_1  | 	at org.eclipse.jetty.util.thread.ReservedThreadExecutor$ReservedThread.run(ReservedThreadExecutor.java:366)
// ql_1  | 	at org.eclipse.jetty.util.thread.QueuedThreadPool.runJob(QueuedThreadPool.java:765)
// ql_1  | 	at org.eclipse.jetty.util.thread.QueuedThreadPool$2.run(QueuedThreadPool.java:683)
// ql_1  | 	at java.lang.Thread.run(Thread.java:748)