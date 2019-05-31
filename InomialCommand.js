#!/usr/bin/env node
//
// This is an example node.js program which connects to the Inomial API and performs queries.
// It does its best to manage the server connection, and will reconnect and even resubmit
// queries and mutations which haven't completed. An InomialClient connection will persist
// until the program terminates.
//

const HOSTNAME = "example.inomial.net";
const STAGE = "test";
const ORIGIN = null;
const APIKEY = "xxx";



const InomialClient = require("./InomialClient.js");

let offset = process.argv[2];
if (offset === undefined)
    offset = null;

function receivedEvent(event) {
    console.log("RECEIVED EVENT:" + JSON.stringify(event));
}

function offsetEvent(event) {
    console.log("RECEIVED OFFSET EVENT:" + JSON.stringify(event));
    var offset = event.data.AccountEvents.offset;
    console.log("GOT OFFSET: " + offset);
    client.setOffset("cli-1", offset);
}

// Allow connection to self-signed certificates.
// This should be removed for production work.
// process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Compute the offset based on some number.
// FIXME: do this better/different.
let offset64 = (offset == null) ? null : '"' + Buffer.from("" + offset).toString('base64') + '"';
console.log("Requesting offset: " + offset + " (" + offset64 + ")");

// Connect to the Inomial API server.
let client = InomialClient.connect(HOSTNAME, STAGE, ORIGIN, APIKEY);




// Subscribe to some events.
// client.subscribe("subscription { AccountEvents(offset: " + offset64 + ") { offset accountUuid account { AccountDisposition { name } } } }", null, receivedEvent);
client.subscribe("subscription { DispositionEvents(offset: " + offset64 + ") { offset accountUuid account { AccountDisposition { name } } } }", null, receivedEvent);
client.subscribe("subscription { TransactionEvents { offset txUuid } }", null, receivedEvent);

// Subscribe to an event with a known offset, and store the offset after receiving the event.
// This is the reliable message delivery pattern for Inomial clients.
client.getOffset("cli-1").then((offset) =>
    client.subscribe(
        "subscription($offset: String) { AccountEvents(offset: $offset) { offset accountUuid account { AccountDisposition { name } } } }",
        {offset: offset}, offsetEvent)
);



//
// Perform a query or mutation. Maybe the mutation will trigger an event!
// Queries using this API are asynchronous; they return a Promise.
// This means that you can send multiple queries simultaneously over the
// same WebSocket connection; queries will return as soon as possible,
// but not necessarily in the order they are sent (if you need strict
// ordering of queries, wait for a promise to complete before sending the
// next query).
//
// See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
// for information about how to use promises.
//
console.log("Sending query...");

//
// Send a query to the server. This returns a unique promise, which then logs to the console.
//
let promise = client.query("{ account(uuid: \"97a753fb-e44f-46f9-8d1e-f6c83580d925\") { usn } }")
    .then((response) => { console.log("RECEIVED RESULT: " + JSON.stringify(response)); });

//
// Test synchronous get
//
client.getAccountUuid("2142649983").then((uuid) => { console.log("got account uuid: " + uuid)}).then(() => {
  client.getAccountUuid("2142649983").then((uuid) => { console.log("got cached account uuid: " + uuid)})});


client.getSubscriptionUuid("2143015614").then((uuid) => { console.log("got subscription uuid: " + uuid)}).then(() => {
    client.getSubscriptionUuid("2143015614").then((uuid) => { console.log("got cached subscription uuid: " + uuid)})});


// Fire an announcement just for fun!
client.query("mutation { announceAccount(accountUuid: \"8b5cc287-c1b0-440e-9c1c-0774c1c5696f\") }");
