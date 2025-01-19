"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  CommandExecution: () => CommandExecution,
  InvalidResponseError: () => InvalidResponseError,
  JackdClient: () => JackdClient,
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);
var import_net = require("net");
var import_assert = __toESM(require("assert"), 1);
var import_events = __toESM(require("events"), 1);
var DELIMITER = "\r\n";
var CommandExecution = class {
  handlers = [];
  emitter = new import_events.default();
};
var JackdClient = class {
  socket = new import_net.Socket();
  connected = false;
  buffer = new Uint8Array();
  chunkLength = 0;
  // beanstalkd executes all commands serially. Because Node.js is single-threaded,
  // this allows us to queue up all of the messages and commands as they're invokved
  // without needing to explicitly wait for promises.
  messages = [];
  executions = [];
  constructor() {
    this.socket.on("ready", () => {
      this.connected = true;
    });
    this.socket.on("close", () => {
      this.connected = false;
    });
    this.socket.on("data", async (incoming) => {
      const newBuffer = new Uint8Array(this.buffer.length + incoming.length);
      newBuffer.set(this.buffer);
      newBuffer.set(new Uint8Array(incoming), this.buffer.length);
      this.buffer = newBuffer;
      await this.processChunk(this.buffer);
    });
  }
  async processChunk(head) {
    let index = -1;
    if (this.chunkLength > 0) {
      const remainingBytes = this.chunkLength - head.length;
      if (remainingBytes > -DELIMITER.length) {
        return;
      }
      index = head.length - DELIMITER.length;
      this.chunkLength = 0;
    } else {
      const delimiterBytes = new TextEncoder().encode(DELIMITER);
      index = findIndex(head, delimiterBytes);
    }
    if (index > -1) {
      this.messages.push(head.slice(0, index));
      await this.flushExecutions();
      const tail = head.slice(index + DELIMITER.length);
      this.buffer = tail;
      await this.processChunk(tail);
    }
  }
  async flushExecutions() {
    for (let i = 0; i < this.executions.length; i++) {
      if (this.messages.length === 0) {
        return;
      }
      const execution = this.executions[0];
      const { handlers, emitter } = execution;
      try {
        while (handlers.length && this.messages.length) {
          const handler = handlers.shift();
          const result = await handler(this.messages.shift());
          if (handlers.length === 0) {
            emitter.emit("resolve", result);
            this.executions.shift();
            i--;
            break;
          }
        }
      } catch (err) {
        emitter.emit("reject", err);
        this.executions.shift();
        i--;
      }
    }
  }
  /**
   * For environments where network partitioning is common.
   * @returns {Boolean}
   */
  isConnected() {
    return this.connected;
  }
  async connect(opts) {
    let host = "localhost";
    let port = 11300;
    if (opts && opts.host) {
      host = opts.host;
    }
    if (opts && opts.port) {
      port = opts.port;
    }
    await new Promise((resolve, reject) => {
      this.socket.once("error", (error) => {
        if (error.code === "EISCONN") {
          return resolve();
        }
        reject(error);
      });
      this.socket.connect(port, host, resolve);
    });
    return this;
  }
  write(buffer) {
    (0, import_assert.default)(buffer);
    return new Promise((resolve, reject) => {
      this.socket.write(buffer, (err) => err ? reject(err) : resolve());
    });
  }
  quit = async () => {
    if (!this.connected) return;
    const waitForClose = new Promise((resolve, reject) => {
      this.socket.once("close", resolve);
      this.socket.once("error", reject);
    });
    this.socket.end(new TextEncoder().encode("quit\r\n"));
    await waitForClose;
  };
  close = this.quit;
  disconnect = this.quit;
  put = this.createCommandHandler(
    (payload, { priority, delay, ttr } = {}) => {
      (0, import_assert.default)(payload);
      let body;
      if (typeof payload === "object") {
        const string = JSON.stringify(payload);
        body = new TextEncoder().encode(string);
      } else {
        body = new TextEncoder().encode(payload);
      }
      const command = new TextEncoder().encode(
        `put ${priority || 0} ${delay || 0} ${ttr || 60} ${body.length}\r
`
      );
      const delimiter = new TextEncoder().encode(DELIMITER);
      const result = new Uint8Array(
        command.length + body.length + delimiter.length
      );
      result.set(command);
      result.set(body, command.length);
      result.set(delimiter, command.length + body.length);
      return result;
    },
    [
      (buffer) => {
        const ascii = validate(buffer, [
          BURIED,
          EXPECTED_CRLF,
          JOB_TOO_BIG,
          DRAINING
        ]);
        if (ascii.startsWith(INSERTED)) {
          const [, id] = ascii.split(" ");
          return parseInt(id);
        }
        invalidResponse(ascii);
      }
    ]
  );
  use = this.createCommandHandler(
    (tube) => {
      (0, import_assert.default)(tube);
      return new TextEncoder().encode(`use ${tube}\r
`);
    },
    [
      (buffer) => {
        const ascii = validate(buffer);
        if (ascii.startsWith(USING)) {
          const [, tube] = ascii.split(" ");
          return tube;
        }
        invalidResponse(ascii);
      }
    ]
  );
  createReserveHandlers(additionalResponses = [], decodePayload = true) {
    let id;
    return [
      (buffer) => {
        const ascii = validate(buffer, [
          DEADLINE_SOON,
          TIMED_OUT,
          ...additionalResponses
        ]);
        if (ascii.startsWith(RESERVED)) {
          const [, incomingId, bytes] = ascii.split(" ");
          id = parseInt(incomingId);
          this.chunkLength = parseInt(bytes);
          return;
        }
        invalidResponse(ascii);
      },
      (payload) => {
        return {
          id,
          payload: decodePayload ? new TextDecoder().decode(payload) : payload
        };
      }
    ];
  }
  reserve = this.createCommandHandler(
    () => new TextEncoder().encode("reserve\r\n"),
    this.createReserveHandlers([], true)
  );
  reserveRaw = this.createCommandHandler(
    () => new TextEncoder().encode("reserve\r\n"),
    this.createReserveHandlers([], false)
  );
  reserveWithTimeout = this.createCommandHandler(
    (seconds) => new TextEncoder().encode(`reserve-with-timeout ${seconds}\r
`),
    this.createReserveHandlers([], true)
  );
  reserveJob = this.createCommandHandler(
    (id) => new TextEncoder().encode(`reserve-job ${id}\r
`),
    this.createReserveHandlers([NOT_FOUND], true)
  );
  delete = this.createCommandHandler(
    (id) => {
      (0, import_assert.default)(id);
      return new TextEncoder().encode(`delete ${id}\r
`);
    },
    [
      (buffer) => {
        const ascii = validate(buffer, [NOT_FOUND]);
        if (ascii === DELETED) return;
        invalidResponse(ascii);
      }
    ]
  );
  release = this.createCommandHandler(
    (id, { priority, delay } = {}) => {
      (0, import_assert.default)(id);
      return new TextEncoder().encode(
        `release ${id} ${priority || 0} ${delay || 0}\r
`
      );
    },
    [
      (buffer) => {
        const ascii = validate(buffer, [BURIED, NOT_FOUND]);
        if (ascii === RELEASED) return;
        invalidResponse(ascii);
      }
    ]
  );
  bury = this.createCommandHandler(
    (id, priority) => {
      (0, import_assert.default)(id);
      return new TextEncoder().encode(`bury ${id} ${priority || 0}\r
`);
    },
    [
      (buffer) => {
        const ascii = validate(buffer, [NOT_FOUND]);
        if (ascii === BURIED) return;
        invalidResponse(ascii);
      }
    ]
  );
  touch = this.createCommandHandler(
    (id) => {
      (0, import_assert.default)(id);
      return new TextEncoder().encode(`touch ${id}\r
`);
    },
    [
      (buffer) => {
        const ascii = validate(buffer, [NOT_FOUND]);
        if (ascii === TOUCHED) return;
        invalidResponse(ascii);
      }
    ]
  );
  watch = this.createCommandHandler(
    (tube) => {
      (0, import_assert.default)(tube);
      return new TextEncoder().encode(`watch ${tube}\r
`);
    },
    [
      (buffer) => {
        const ascii = validate(buffer);
        if (ascii.startsWith(WATCHING)) {
          const [, count] = ascii.split(" ");
          return parseInt(count);
        }
        invalidResponse(ascii);
      }
    ]
  );
  ignore = this.createCommandHandler(
    (tube) => {
      (0, import_assert.default)(tube);
      return new TextEncoder().encode(`ignore ${tube}\r
`);
    },
    [
      (buffer) => {
        const ascii = validate(buffer, [NOT_IGNORED]);
        if (ascii.startsWith(WATCHING)) {
          const [, count] = ascii.split(" ");
          return parseInt(count);
        }
        invalidResponse(ascii);
      }
    ]
  );
  pauseTube = this.createCommandHandler(
    (tube, { delay } = {}) => new TextEncoder().encode(`pause-tube ${tube} ${delay || 0}`),
    [
      (buffer) => {
        const ascii = validate(buffer, [NOT_FOUND]);
        if (ascii === PAUSED) return;
        invalidResponse(ascii);
      }
    ]
  );
  /* Other commands */
  peek = this.createCommandHandler((id) => {
    (0, import_assert.default)(id);
    return new TextEncoder().encode(`peek ${id}\r
`);
  }, this.createPeekHandlers());
  createPeekHandlers() {
    let id;
    return [
      (buffer) => {
        const ascii = validate(buffer, [NOT_FOUND]);
        if (ascii.startsWith(FOUND)) {
          const [, peekId, bytes] = ascii.split(" ");
          id = parseInt(peekId);
          this.chunkLength = parseInt(bytes);
          return;
        }
        invalidResponse(ascii);
      },
      (payload) => {
        return {
          id,
          payload: new TextDecoder().decode(payload)
        };
      }
    ];
  }
  peekReady = this.createCommandHandler(() => {
    return new TextEncoder().encode(`peek-ready\r
`);
  }, this.createPeekHandlers());
  peekDelayed = this.createCommandHandler(() => {
    return new TextEncoder().encode(`peek-delayed\r
`);
  }, this.createPeekHandlers());
  peekBuried = this.createCommandHandler(() => {
    return new TextEncoder().encode(`peek-buried\r
`);
  }, this.createPeekHandlers());
  kick = this.createCommandHandler(
    (bound) => {
      (0, import_assert.default)(bound);
      return new TextEncoder().encode(`kick ${bound}\r
`);
    },
    [
      (buffer) => {
        const ascii = validate(buffer);
        if (ascii.startsWith(KICKED)) {
          const [, kicked] = ascii.split(" ");
          return parseInt(kicked);
        }
        invalidResponse(ascii);
      }
    ]
  );
  kickJob = this.createCommandHandler(
    (id) => {
      (0, import_assert.default)(id);
      return new TextEncoder().encode(`kick-job ${id}\r
`);
    },
    [
      (buffer) => {
        const ascii = validate(buffer, [NOT_FOUND]);
        if (ascii.startsWith(KICKED)) return;
        invalidResponse(ascii);
      }
    ]
  );
  statsJob = this.createCommandHandler((id) => {
    (0, import_assert.default)(id);
    return new TextEncoder().encode(`stats-job ${id}\r
`);
  }, this.createYamlCommandHandlers());
  statsTube = this.createCommandHandler((tube) => {
    (0, import_assert.default)(tube);
    return new TextEncoder().encode(`stats-tube ${tube}\r
`);
  }, this.createYamlCommandHandlers());
  stats = this.createCommandHandler(
    () => new TextEncoder().encode(`stats\r
`),
    this.createYamlCommandHandlers()
  );
  listTubes = this.createCommandHandler(
    () => new TextEncoder().encode(`list-tubes\r
`),
    this.createYamlCommandHandlers()
  );
  listTubesWatched = this.createCommandHandler(
    () => new TextEncoder().encode(`list-tubes-watched\r
`),
    this.createYamlCommandHandlers()
  );
  createYamlCommandHandlers() {
    return [
      (buffer) => {
        const ascii = validate(buffer, [DEADLINE_SOON, TIMED_OUT]);
        if (ascii.startsWith(OK)) {
          const [, bytes] = ascii.split(" ");
          this.chunkLength = parseInt(bytes);
          return;
        }
        invalidResponse(ascii);
      },
      (payload) => {
        return new TextDecoder().decode(payload);
      }
    ];
  }
  getCurrentTube = this.createCommandHandler(
    () => new TextEncoder().encode(`list-tube-used\r
`),
    [
      (buffer) => {
        const ascii = validate(buffer, [NOT_FOUND]);
        if (ascii.startsWith(USING)) {
          const [, tube] = ascii.split(" ");
          return tube;
        }
        invalidResponse(ascii);
      }
    ]
  );
  listTubeUsed = this.getCurrentTube;
  createCommandHandler(commandStringFunction, handlers) {
    return async (...args) => {
      const commandString = commandStringFunction.apply(this, args);
      await this.write(commandString);
      const emitter = new import_events.default();
      this.executions.push({
        handlers: handlers.concat(),
        emitter
      });
      return await new Promise((resolve, reject) => {
        emitter.once("resolve", resolve);
        emitter.once("reject", reject);
      });
    };
  }
};
var index_default = JackdClient;
function validate(buffer, additionalResponses = []) {
  const ascii = new TextDecoder().decode(buffer);
  const errors = [OUT_OF_MEMORY, INTERNAL_ERROR, BAD_FORMAT, UNKNOWN_COMMAND];
  if (errors.concat(additionalResponses).some((error) => ascii.startsWith(error))) {
    throw new Error(ascii);
  }
  return ascii;
}
var InvalidResponseError = class extends Error {
  response = "internal error";
};
function invalidResponse(ascii) {
  console.log(ascii);
  const error = new InvalidResponseError(`Unexpected response: ${ascii}`);
  error.response = ascii;
  throw error;
}
function findIndex(array, subarray) {
  for (let i = 0; i <= array.length - subarray.length; i++) {
    let found = true;
    for (let j = 0; j < subarray.length; j++) {
      if (array[i + j] !== subarray[j]) {
        found = false;
        break;
      }
    }
    if (found) return i;
  }
  return -1;
}
var RESERVED = "RESERVED";
var INSERTED = "INSERTED";
var USING = "USING";
var TOUCHED = "TOUCHED";
var DELETED = "DELETED";
var BURIED = "BURIED";
var RELEASED = "RELEASED";
var NOT_FOUND = "NOT_FOUND";
var OUT_OF_MEMORY = "OUT_OF_MEMORY";
var INTERNAL_ERROR = "INTERNAL_ERROR";
var BAD_FORMAT = "BAD_FORMAT";
var UNKNOWN_COMMAND = "UNKNOWN_COMMAND";
var EXPECTED_CRLF = "EXPECTED_CRLF";
var JOB_TOO_BIG = "JOB_TOO_BIG";
var DRAINING = "DRAINING";
var TIMED_OUT = "TIMED_OUT";
var DEADLINE_SOON = "DEADLINE_SOON";
var FOUND = "FOUND";
var WATCHING = "WATCHING";
var NOT_IGNORED = "NOT_IGNORED";
var KICKED = "KICKED";
var PAUSED = "PAUSED";
var OK = "OK";
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CommandExecution,
  InvalidResponseError,
  JackdClient
});
