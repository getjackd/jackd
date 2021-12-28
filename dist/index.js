"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvalidResponseError = exports.JackdClient = void 0;
const net_1 = require("net");
const assert = require("assert");
const EventEmitter = require("events");
const DELIMITER = '\r\n';
class JackdClient {
    constructor(opts) {
        this.socket = new net_1.Socket();
        this.connected = false;
        this.buffer = Buffer.from([]);
        this.incomingBytes = 0;
        this.useLegacyStringPayloads = false;
        this.messages = [];
        this.executions = [];
        this.close = this.quit;
        this.disconnect = this.quit;
        this.executeCommand = this.createCommandHandler(command => command, [
            async (response) => {
                validate(response);
                return response;
            }
        ]);
        this.use = this.createCommandHandler(tube => {
            assert(tube);
            return Buffer.from(`use ${tube}\r\n`, 'ascii');
        }, [
            async (buffer) => {
                const ascii = validate(buffer);
                if (ascii.startsWith(USING)) {
                    const [, tube] = ascii.split(' ');
                    return tube;
                }
                invalidResponse(ascii);
            }
        ]);
        this.put = this.createCommandHandler((payload, { priority, delay, ttr } = {}) => {
            assert(payload);
            let body = payload;
            if (typeof body === 'object') {
                body = JSON.stringify(payload);
            }
            if (typeof body === 'string') {
                body = Buffer.from(body);
            }
            let command = Buffer.from(`put ${priority || 0} ${delay || 0} ${ttr || 60} ${body.length}\r\n`, 'ascii');
            return Buffer.concat([command, body, Buffer.from(DELIMITER, 'ascii')]);
        }, [
            async (buffer) => {
                const ascii = validate(buffer, [
                    BURIED,
                    EXPECTED_CRLF,
                    JOB_TOO_BIG,
                    DRAINING
                ]);
                if (ascii.startsWith(INSERTED)) {
                    const [, id] = ascii.split(' ');
                    return id;
                }
                invalidResponse(ascii);
            }
        ]);
        this.delete = this.createCommandHandler(id => {
            assert(id);
            return Buffer.from(`delete ${id}\r\n`, 'ascii');
        }, [
            async (buffer) => {
                const ascii = validate(buffer, [NOT_FOUND]);
                if (ascii === DELETED)
                    return;
                invalidResponse(ascii);
            }
        ]);
        this.reserve = this.createCommandHandler(() => Buffer.from('reserve\r\n', 'ascii'), this.createReserveHandlers());
        this.reserveWithTimeout = this.createCommandHandler(seconds => Buffer.from(`reserve-with-timeout ${seconds}\r\n`, 'ascii'), this.createReserveHandlers());
        this.watch = this.createCommandHandler(tube => {
            assert(tube);
            return Buffer.from(`watch ${tube}\r\n`, 'ascii');
        }, [
            async (buffer) => {
                const ascii = validate(buffer);
                if (ascii.startsWith(WATCHING)) {
                    const [, count] = ascii.split(' ');
                    return count;
                }
                invalidResponse(ascii);
            }
        ]);
        this.ignore = this.createCommandHandler(tube => {
            assert(tube);
            return Buffer.from(`ignore ${tube}\r\n`, 'ascii');
        }, [
            async (buffer) => {
                const ascii = validate(buffer, [NOT_IGNORED]);
                if (ascii.startsWith(WATCHING)) {
                    const [, count] = ascii.split(' ');
                    return count;
                }
                invalidResponse(ascii);
            }
        ]);
        this.bury = this.createCommandHandler((id, { priority } = {}) => {
            assert(id);
            return Buffer.from(`bury ${id} ${priority || 0}\r\n`, 'ascii');
        }, [
            async (buffer) => {
                const ascii = validate(buffer, [NOT_FOUND]);
                if (ascii === BURIED)
                    return;
                invalidResponse(ascii);
            }
        ]);
        this.peekBuried = this.createCommandHandler(() => {
            return Buffer.from(`peek-buried\r\n`, 'ascii');
        }, (() => {
            let id;
            return [
                async (buffer) => {
                    const ascii = validate(buffer, [NOT_FOUND]);
                    if (ascii.startsWith(FOUND)) {
                        const [, incomingId] = ascii.split(' ');
                        id = incomingId;
                        return;
                    }
                    invalidResponse(ascii);
                },
                async (payload) => {
                    return { id, payload };
                }
            ];
        })());
        this.executeMultiPartCommand = this.createCommandHandler(command => command, [
            async (buffer) => {
                validate(buffer);
            },
            async (payload) => {
                if (this.useLegacyStringPayloads) {
                    return payload.toString('ascii');
                }
                return payload;
            }
        ]);
        this.pauseTube = this.createCommandHandler((tube, { delay } = {}) => Buffer.from(`pause-tube ${tube} ${delay || 0}`, 'ascii'), [
            async (buffer) => {
                const ascii = validate(buffer, [NOT_FOUND]);
                if (ascii === PAUSED)
                    return;
                invalidResponse(ascii);
            }
        ]);
        this.release = this.createCommandHandler((id, { priority, delay } = {}) => {
            assert(id);
            return Buffer.from(`release ${id} ${priority || 0} ${delay || 0}\r\n`, 'ascii');
        }, [
            async (buffer) => {
                const ascii = validate(buffer, [BURIED, NOT_FOUND]);
                if (ascii === RELEASED)
                    return;
                invalidResponse(ascii);
            }
        ]);
        this.touch = this.createCommandHandler(id => {
            assert(id);
            return Buffer.from(`touch ${id}\r\n`, 'ascii');
        }, [
            async (buffer) => {
                const ascii = validate(buffer, [NOT_FOUND]);
                if (ascii === TOUCHED)
                    return;
                invalidResponse(ascii);
            }
        ]);
        this.peek = this.createCommandHandler(id => {
            assert(id);
            return Buffer.from(`peek ${id}\r\n`, 'ascii');
        }, (() => {
            let id;
            return [
                async (buffer) => {
                    const ascii = validate(buffer, [NOT_FOUND]);
                    if (ascii.startsWith(FOUND)) {
                        const [, incomingId] = ascii.split(' ');
                        id = incomingId;
                    }
                    invalidResponse(ascii);
                },
                async function (payload) {
                    return { id, payload };
                }
            ];
        })());
        this.kick = this.createCommandHandler(bound => {
            assert(bound);
            return Buffer.from(`kick ${bound}\r\n`, 'ascii');
        }, [
            async (buffer) => {
                const ascii = validate(buffer);
                if (ascii.startsWith(KICKED))
                    return;
                invalidResponse(ascii);
            }
        ]);
        this.kickJob = this.createCommandHandler(id => {
            assert(id);
            return Buffer.from(`kick-job ${id}\r\n`, 'ascii');
        }, [
            async (buffer) => {
                const ascii = validate(buffer, [NOT_FOUND]);
                if (ascii.startsWith(KICKED))
                    return;
                invalidResponse(ascii);
            }
        ]);
        this.getCurrentTube = this.createCommandHandler(() => Buffer.from(`list-tube-used\r\n`, 'ascii'), [
            async (buffer) => {
                const ascii = validate(buffer, [NOT_FOUND]);
                if (ascii.startsWith(USING)) {
                    const [, tube] = ascii.split(' ');
                    return tube;
                }
                invalidResponse(ascii);
            }
        ]);
        if (opts && opts.useLegacyStringPayloads) {
            this.useLegacyStringPayloads = true;
        }
        this.socket.on('ready', () => {
            this.connected = true;
        });
        this.socket.on('close', () => {
            this.connected = false;
        });
        this.socket.on('data', async (incoming) => {
            this.buffer = Buffer.concat([this.buffer, incoming]);
            await this.processChunk(this.buffer);
        });
    }
    async processChunk(head) {
        let index = -1;
        if (this.incomingBytes > 0) {
            const remainingBytes = this.incomingBytes - head.length;
            if (remainingBytes > -DELIMITER.length) {
                return;
            }
            index = head.length - DELIMITER.length;
            this.incomingBytes = 0;
        }
        else {
            index = head.indexOf(DELIMITER);
        }
        if (index > -1) {
            this.messages.push(head.subarray(0, index));
            await this.flushExecutions();
            const tail = head.subarray(index + DELIMITER.length, head.length);
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
                        emitter.emit('resolve', result);
                        this.executions.shift();
                        i--;
                        break;
                    }
                }
            }
            catch (err) {
                emitter.emit('reject', err);
            }
        }
    }
    isConnected() {
        return this.connected;
    }
    async connect(opts) {
        let host = undefined;
        let port = 11300;
        if (opts && opts.host) {
            host = opts.host;
        }
        if (opts && opts.port) {
            port = opts.port;
        }
        await new Promise((resolve, reject) => {
            this.socket.once('error', (error) => {
                if (error.code === 'EISCONN') {
                    return resolve();
                }
                reject(error);
            });
            this.socket.connect(port, host, resolve);
        });
        return this;
    }
    write(buffer) {
        assert(buffer);
        return new Promise((resolve, reject) => {
            this.socket.write(buffer, err => (err ? reject(err) : resolve()));
        });
    }
    async quit() {
        await this.write(Buffer.from('quit\r\n', 'ascii'));
    }
    createReserveHandlers() {
        const self = this;
        let id;
        return [
            async (buffer) => {
                const ascii = validate(buffer, [DEADLINE_SOON, TIMED_OUT]);
                if (ascii.startsWith(RESERVED)) {
                    const [, incomingId, bytes] = ascii.split(' ');
                    id = incomingId;
                    self.incomingBytes = parseInt(bytes);
                    return;
                }
                invalidResponse(ascii);
            },
            async (payload) => {
                if (self.useLegacyStringPayloads) {
                    return { id, payload: payload.toString('ascii') };
                }
                return { id, payload };
            }
        ];
    }
    createCommandHandler(commandStringFunction, handlers) {
        const self = this;
        return async function command() {
            const commandString = commandStringFunction.apply(this, arguments);
            await self.write(commandString);
            const emitter = new EventEmitter();
            self.executions.push({
                handlers: handlers.concat(),
                emitter
            });
            return await new Promise((resolve, reject) => {
                emitter.once('resolve', resolve);
                emitter.once('reject', reject);
            });
        };
    }
}
exports.JackdClient = JackdClient;
module.exports = JackdClient;
function validate(buffer, additionalErrors = []) {
    const ascii = buffer.toString('ascii');
    const errors = [OUT_OF_MEMORY, INTERNAL_ERROR, BAD_FORMAT, UNKNOWN_COMMAND];
    if (errors.concat(additionalErrors).some(error => ascii.startsWith(error))) {
        throw new Error(ascii);
    }
    return ascii;
}
class InvalidResponseError extends Error {
}
exports.InvalidResponseError = InvalidResponseError;
function invalidResponse(ascii) {
    const error = new InvalidResponseError(`Unexpected response: ${ascii}`);
    error.response = ascii;
    throw error;
}
const RESERVED = 'RESERVED';
const INSERTED = 'INSERTED';
const USING = 'USING';
const TOUCHED = 'TOUCHED';
const DELETED = 'DELETED';
const BURIED = 'BURIED';
const RELEASED = 'RELEASED';
const NOT_FOUND = 'NOT_FOUND';
const OUT_OF_MEMORY = 'OUT_OF_MEMORY';
const INTERNAL_ERROR = 'INTERNAL_ERROR';
const BAD_FORMAT = 'BAD_FORMAT';
const UNKNOWN_COMMAND = 'UNKNOWN_COMMAND';
const EXPECTED_CRLF = 'EXPECTED_CRLF';
const JOB_TOO_BIG = 'JOB_TOO_BIG';
const DRAINING = 'DRAINING';
const TIMED_OUT = 'TIMED_OUT';
const DEADLINE_SOON = 'DEADLINE_SOON';
const FOUND = 'FOUND';
const WATCHING = 'WATCHING';
const NOT_IGNORED = 'NOT_IGNORED';
const KICKED = 'KICKED';
const PAUSED = 'PAUSED';
//# sourceMappingURL=index.js.map