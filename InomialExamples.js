#!/usr/bin/env node
//
// This is an example node.js program which connects to the Inomial API and performs queries.
// It does its best to manage the server connection, and will reconnect and even resubmit
// queries and mutations which haven't completed. An InomialClient connection will persist
// until the program terminates.
//

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
process.env.NODE_TLS_REJECT_UNAUTHORIZED = (process.env.INOMIAL_INSECURE_SSL == "true") ? 0 : 1;

// Connect to the Inomial API server.
let client = InomialClient.connect();


async function subscribe()
{
  // Subscribe to some events.
  // client.subscribe("subscription { AccountEvents { offset accountUuid account { AccountDisposition { name } } } }", null, receivedEvent);
  client.subscribe("subscription { DispositionEvents { offset accountUuid account { AccountDisposition { name } } } }", null, receivedEvent);
  client.subscribe("subscription { TransactionEvents { offset accountUuid } }", null, receivedEvent);

  // Subscribe to an event with a known offset, and store the offset after receiving the event.
  // This is the reliable message delivery pattern for Inomial clients.
  var offset = await client.getOffset("cli-1");
  client.subscribe(
    "subscription($offset: String) { AccountEvents(offset: $offset) { offset accountUuid account { AccountDisposition { name } } } }",
    {offset: offset}, offsetEvent);
}


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

// Use promises for everything.
function asynchronousTest()
{
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
}


//
// Use await for everything.
//
async function synchronousTest()
{
  console.log("PERFORMING SYNCHRONOUS VERSION");
  var response = await client.query("{ account(uuid: \"97a753fb-e44f-46f9-8d1e-f6c83580d925\") { usn } }");
  console.log("RECEIVED SYNCHRONOUS RESULT: " + JSON.stringify(response));

  // 
  // Test synchronous get
  // 
  let uuid = await client.getAccountUuid("2142649983");
  console.log("got SYNCHRONOUS account uuid: " + uuid);

  let uuid2 = await client.getAccountUuid("2142649983");
  console.log("got SYNCHRONOUS cached account uuid: " + uuid2);


  let uuid3 = await client.getSubscriptionUuid("2143015614");
  console.log("got SYNCHRONOUS subscription uuid: " + uuid3);
  let uuid4 = await client.getSubscriptionUuid("2143015614");
  console.log("got SYNCHRONOUS cached subscription uuid: " + uuid4);

  const accountUuid = "8b5cc287-c1b0-440e-9c1c-0774c1c5696f";
  
  // subscribe to the announcement we're about to send.
  await client.subscribe("subscription { AccountEvents(accountUuid: \"" + accountUuid + "\") { offset accountUuid } }", null, () => {
    console.log("received SYNCHRONOUS(ish) event"); });

  await client.query("mutation { announceAccount(accountUuid: \"" + accountUuid + "\") }");
  console.log("fired SYNCHRONOUS mutation");
}

synchronousTest();
// subscribe();
// asynchronousTest();
