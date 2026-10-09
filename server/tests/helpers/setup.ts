import supertest from "supertest";

/**
 * Makes Supertest connect to the test server on the address family the
 * server is listening on.
 *
 * Supertest starts the app with `listen(0)`, which binds the IPv6 wildcard,
 * and then sends its request to `127.0.0.1:<port>`, which is IPv4. On this
 * machine that mismatch let a request, now and then, be answered by something
 * that was not the app: a 426 from a WebSocket server, a 404 from a route the
 * app has, a request that hung until the test timed out. Different tests each
 * time, never repeatable alone, about one full run in four.
 *
 * Connecting to `[::1]` reaches the same listening socket over the family it
 * was bound on, so the port number is unique where it is used.
 */
interface WithServerAddress {
  serverAddress(app: unknown, path: string): string;
}

const Test = (supertest as unknown as { Test: { prototype: WithServerAddress } }).Test;
const serverAddress = Test.prototype.serverAddress;

Test.prototype.serverAddress = function (this: WithServerAddress, app: unknown, path: string) {
  return serverAddress.call(this, app, path).replace("//127.0.0.1:", "//[::1]:");
};
