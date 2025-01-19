import { Socket } from "net"
import assert from "assert"
import EventEmitter from "events"

const DELIMITER = "\r\n"

type JackdPayload = Uint8Array | string | object

export type CommandHandler<T> = (chunk: Uint8Array) => T | Promise<T>

export class CommandExecution<T> {
  handlers: CommandHandler<T | void>[] = []
  emitter: EventEmitter = new EventEmitter()
}

export interface JackdConnectOpts {
  host: string
  port?: number
}

export interface JackdPutOpts {
  delay?: number
  priority?: number
  ttr?: number
}

export interface JackdJobRaw {
  id: number
  payload: Uint8Array
}

export interface JackdJob {
  id: number
  payload: string
}

interface JackdReleaseOpts {
  priority?: number
  delay?: number
}

interface JackdPauseTubeOpts {
  delay?: number
}

type JackdPutArgs = [
  payload: Uint8Array | string | object,
  options?: JackdPutOpts
]
type JackdReleaseArgs = [jobId: number, options?: JackdReleaseOpts]
type JackdPauseTubeArgs = [tubeId: string, options?: JackdPauseTubeOpts]
type JackdJobArgs = [jobId: number]
type JackdTubeArgs = [tubeId: string]
type JackdBuryArgs = [jobId: number, priority?: number]

type JackdArgs =
  | JackdPutArgs
  | JackdReleaseArgs
  | JackdPauseTubeArgs
  | JackdJobArgs
  | JackdTubeArgs
  | never[]
  | number[]
  | [jobId: number, priority?: number]

export class JackdClient {
  socket: Socket = new Socket()
  connected: boolean = false
  buffer: Uint8Array = new Uint8Array()
  chunkLength: number = 0

  // beanstalkd executes all commands serially. Because Node.js is single-threaded,
  // this allows us to queue up all of the messages and commands as they're invokved
  // without needing to explicitly wait for promises.
  messages: Uint8Array[] = []
  executions: CommandExecution<unknown>[] = []

  constructor() {
    this.socket.on("ready", () => {
      this.connected = true
    })

    this.socket.on("close", () => {
      this.connected = false
    })

    // When we receive data from the socket, let's process it and put it in our
    // messages.
    this.socket.on("data", async incoming => {
      // Write the incoming data onto the buffer
      const newBuffer = new Uint8Array(this.buffer.length + incoming.length)
      newBuffer.set(this.buffer)
      newBuffer.set(new Uint8Array(incoming), this.buffer.length)
      this.buffer = newBuffer
      await this.processChunk(this.buffer)
    })
  }

  async processChunk(head: Uint8Array) {
    let index = -1

    // If we're waiting on some bytes from a command...
    if (this.chunkLength > 0) {
      // ...subtract it from the remaining bytes.
      const remainingBytes = this.chunkLength - head.length

      // If we still have remaining bytes, leave. We need to wait for the
      // data to come in. Payloads, regardless of their content, must end
      // with the delimiter. This is why we check if it's over the negative
      // delimiter length. If the incoming bytes is -2, we can be absolutely
      // sure the entire message was processed because the delimiter was
      // processed too.
      if (remainingBytes > -DELIMITER.length) {
        return
      }

      index = head.length - DELIMITER.length
      this.chunkLength = 0
    } else {
      const delimiterBytes = new TextEncoder().encode(DELIMITER)
      index = findIndex(head, delimiterBytes)
    }

    if (index > -1) {
      this.messages.push(head.slice(0, index))

      // We have to start flushing executions as soon as we push messages. This is to avoid
      // instances where job payloads might contain line breaks. We let the downstream handlers
      // set the incoming bytes almost immediately.
      await this.flushExecutions()

      const tail = head.slice(index + DELIMITER.length)
      this.buffer = tail
      await this.processChunk(tail)
    }
  }

  async flushExecutions() {
    for (let i = 0; i < this.executions.length; i++) {
      if (this.messages.length === 0) {
        // If there are no remaining messages, we can't continue executing. Leave.
        return
      }

      const execution = this.executions[0]
      const { handlers, emitter } = execution

      try {
        // Executions can have multiple handlers. This happens with messages that expect
        // data chunks after the initial response.
        while (handlers.length && this.messages.length) {
          const handler = handlers.shift()

          const result = await handler!(this.messages.shift()!)

          if (handlers.length === 0) {
            emitter.emit("resolve", result)

            // We modified the executions array by removing an element. Decrement the loop.
            this.executions.shift()
            i--

            break
          }
        }
      } catch (err) {
        emitter.emit("reject", err)

        // This execution is botched, don't hang the entire queue
        this.executions.shift()
        i--
      }
    }
  }

  /**
   * For environments where network partitioning is common.
   * @returns {Boolean}
   */
  isConnected(): boolean {
    return this.connected
  }

  async connect(opts?: JackdConnectOpts): Promise<this> {
    let host: string = "localhost"
    let port = 11300

    if (opts && opts.host) {
      host = opts.host
    }

    if (opts && opts.port) {
      port = opts.port
    }

    await new Promise<void>((resolve, reject) => {
      this.socket.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EISCONN") {
          return resolve()
        }

        reject(error)
      })

      this.socket.connect(port, host, resolve)
    })

    return this
  }

  write(buffer: Uint8Array) {
    assert(buffer)

    return new Promise<void>((resolve, reject) => {
      this.socket.write(buffer, err => (err ? reject(err) : resolve()))
    })
  }

  quit = async () => {
    if (!this.connected) return

    const waitForClose = new Promise<void>((resolve, reject) => {
      this.socket.once("close", resolve)
      this.socket.once("error", reject)
    })

    this.socket.end(new TextEncoder().encode("quit\r\n"))
    await waitForClose
  }

  close = this.quit
  disconnect = this.quit

  put = this.createCommandHandler<JackdPutArgs, number>(
    (payload: JackdPayload, { priority, delay, ttr }: JackdPutOpts = {}) => {
      assert(payload)
      let body: Uint8Array

      // If the caller passed in an object, convert it to a valid Uint8Array from a JSON string
      if (typeof payload === "object") {
        const string = JSON.stringify(payload)
        body = new TextEncoder().encode(string)
      } else {
        // Anything else, just capture the Uint8Array
        body = new TextEncoder().encode(payload)
      }

      const command = new TextEncoder().encode(
        `put ${priority || 0} ${delay || 0} ${ttr || 60} ${body.length}\r\n`
      )

      const delimiter = new TextEncoder().encode(DELIMITER)
      const result = new Uint8Array(
        command.length + body.length + delimiter.length
      )
      result.set(command)
      result.set(body, command.length)
      result.set(delimiter, command.length + body.length)
      return result
    },
    [
      buffer => {
        const ascii = validate(buffer, [
          BURIED,
          EXPECTED_CRLF,
          JOB_TOO_BIG,
          DRAINING
        ])

        if (ascii.startsWith(INSERTED)) {
          const [, id] = ascii.split(" ")
          return parseInt(id)
        }

        invalidResponse(ascii)
      }
    ]
  )

  use = this.createCommandHandler<JackdTubeArgs, string>(
    tube => {
      assert(tube)
      return new TextEncoder().encode(`use ${tube}\r\n`)
    },
    [
      buffer => {
        const ascii = validate(buffer)

        if (ascii.startsWith(USING)) {
          const [, tube] = ascii.split(" ")
          return tube
        }

        invalidResponse(ascii)
      }
    ]
  )

  createReserveHandlers<T extends JackdJob | JackdJobRaw>(
    additionalResponses: Array<string> = [],
    decodePayload: boolean = true
  ): [CommandHandler<void>, CommandHandler<T>] {
    let id: number

    return [
      (buffer: Uint8Array) => {
        const ascii = validate(buffer, [
          DEADLINE_SOON,
          TIMED_OUT,
          ...additionalResponses
        ])

        if (ascii.startsWith(RESERVED)) {
          const [, incomingId, bytes] = ascii.split(" ")
          id = parseInt(incomingId)
          this.chunkLength = parseInt(bytes)
          return
        }

        invalidResponse(ascii)
      },
      (payload: Uint8Array) => {
        return {
          id,
          payload: decodePayload ? new TextDecoder().decode(payload) : payload
        } as T
      }
    ]
  }

  reserve = this.createCommandHandler<[], JackdJob>(
    () => new TextEncoder().encode("reserve\r\n"),
    this.createReserveHandlers<JackdJob>([], true)
  )

  reserveRaw = this.createCommandHandler<[], JackdJobRaw>(
    () => new TextEncoder().encode("reserve\r\n"),
    this.createReserveHandlers<JackdJobRaw>([], false)
  )

  reserveWithTimeout = this.createCommandHandler<[number], JackdJob>(
    seconds => new TextEncoder().encode(`reserve-with-timeout ${seconds}\r\n`),
    this.createReserveHandlers<JackdJob>([], true)
  )

  reserveJob = this.createCommandHandler<[number], JackdJob>(
    id => new TextEncoder().encode(`reserve-job ${id}\r\n`),
    this.createReserveHandlers<JackdJob>([NOT_FOUND], true)
  )

  delete = this.createCommandHandler<JackdJobArgs, void>(
    id => {
      assert(id)
      return new TextEncoder().encode(`delete ${id}\r\n`)
    },
    [
      buffer => {
        const ascii = validate(buffer, [NOT_FOUND])

        if (ascii === DELETED) return
        invalidResponse(ascii)
      }
    ]
  )

  release = this.createCommandHandler<JackdReleaseArgs, void>(
    (id, { priority, delay } = {}) => {
      assert(id)
      return new TextEncoder().encode(
        `release ${id} ${priority || 0} ${delay || 0}\r\n`
      )
    },
    [
      buffer => {
        const ascii = validate(buffer, [BURIED, NOT_FOUND])
        if (ascii === RELEASED) return
        invalidResponse(ascii)
      }
    ]
  )

  bury = this.createCommandHandler<JackdBuryArgs, void>(
    (id, priority) => {
      assert(id)
      return new TextEncoder().encode(`bury ${id} ${priority || 0}\r\n`)
    },
    [
      buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii === BURIED) return
        invalidResponse(ascii)
      }
    ]
  )

  touch = this.createCommandHandler<JackdJobArgs, void>(
    id => {
      assert(id)
      return new TextEncoder().encode(`touch ${id}\r\n`)
    },
    [
      buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii === TOUCHED) return
        invalidResponse(ascii)
      }
    ]
  )

  watch = this.createCommandHandler<JackdTubeArgs, number>(
    tube => {
      assert(tube)
      return new TextEncoder().encode(`watch ${tube}\r\n`)
    },
    [
      buffer => {
        const ascii = validate(buffer)

        if (ascii.startsWith(WATCHING)) {
          const [, count] = ascii.split(" ")
          return parseInt(count)
        }

        invalidResponse(ascii)
      }
    ]
  )

  ignore = this.createCommandHandler<JackdTubeArgs, number>(
    tube => {
      assert(tube)
      return new TextEncoder().encode(`ignore ${tube}\r\n`)
    },
    [
      buffer => {
        const ascii = validate(buffer, [NOT_IGNORED])

        if (ascii.startsWith(WATCHING)) {
          const [, count] = ascii.split(" ")
          return parseInt(count)
        }
        invalidResponse(ascii)
      }
    ]
  )

  pauseTube = this.createCommandHandler<JackdPauseTubeArgs, void>(
    (tube, { delay } = {}) =>
      new TextEncoder().encode(`pause-tube ${tube} ${delay || 0}`),

    [
      buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii === PAUSED) return
        invalidResponse(ascii)
      }
    ]
  )

  /* Other commands */

  peek = this.createCommandHandler<JackdJobArgs, JackdJob>(id => {
    assert(id)
    return new TextEncoder().encode(`peek ${id}\r\n`)
  }, this.createPeekHandlers())

  createPeekHandlers(): [CommandHandler<void>, CommandHandler<JackdJob>] {
    let id: number

    return [
      (buffer: Uint8Array) => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii.startsWith(FOUND)) {
          const [, peekId, bytes] = ascii.split(" ")
          id = parseInt(peekId)
          this.chunkLength = parseInt(bytes)
          return
        }
        invalidResponse(ascii)
      },
      (payload: Uint8Array) => {
        return {
          id,
          payload: new TextDecoder().decode(payload)
        }
      }
    ]
  }

  peekReady = this.createCommandHandler<[], JackdJob>(() => {
    return new TextEncoder().encode(`peek-ready\r\n`)
  }, this.createPeekHandlers())

  peekDelayed = this.createCommandHandler<[], JackdJob>(() => {
    return new TextEncoder().encode(`peek-delayed\r\n`)
  }, this.createPeekHandlers())

  peekBuried = this.createCommandHandler<[], JackdJob>(() => {
    return new TextEncoder().encode(`peek-buried\r\n`)
  }, this.createPeekHandlers())

  kick = this.createCommandHandler<[jobsCount: number], number>(
    bound => {
      assert(bound)
      return new TextEncoder().encode(`kick ${bound}\r\n`)
    },
    [
      buffer => {
        const ascii = validate(buffer)
        if (ascii.startsWith(KICKED)) {
          const [, kicked] = ascii.split(" ")
          return parseInt(kicked)
        }

        invalidResponse(ascii)
      }
    ]
  )

  kickJob = this.createCommandHandler<JackdJobArgs, void>(
    id => {
      assert(id)
      return new TextEncoder().encode(`kick-job ${id}\r\n`)
    },
    [
      buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii.startsWith(KICKED)) return
        invalidResponse(ascii)
      }
    ]
  )

  statsJob = this.createCommandHandler<JackdJobArgs, string>(id => {
    assert(id)
    return new TextEncoder().encode(`stats-job ${id}\r\n`)
  }, this.createYamlCommandHandlers())

  statsTube = this.createCommandHandler<JackdTubeArgs, string>(tube => {
    assert(tube)
    return new TextEncoder().encode(`stats-tube ${tube}\r\n`)
  }, this.createYamlCommandHandlers())

  stats = this.createCommandHandler<[], string>(
    () => new TextEncoder().encode(`stats\r\n`),
    this.createYamlCommandHandlers()
  )

  listTubes = this.createCommandHandler<[], string>(
    () => new TextEncoder().encode(`list-tubes\r\n`),
    this.createYamlCommandHandlers()
  )

  listTubesWatched = this.createCommandHandler<[], string>(
    () => new TextEncoder().encode(`list-tubes-watched\r\n`),
    this.createYamlCommandHandlers()
  )

  createYamlCommandHandlers(): [CommandHandler<void>, CommandHandler<string>] {
    return [
      (buffer: Uint8Array) => {
        const ascii = validate(buffer, [DEADLINE_SOON, TIMED_OUT])

        if (ascii.startsWith(OK)) {
          const [, bytes] = ascii.split(" ")
          this.chunkLength = parseInt(bytes)
          return
        }

        invalidResponse(ascii)
      },
      (payload: Uint8Array) => {
        // Payloads for internal beanstalkd commands are always returned in ASCII
        return new TextDecoder().decode(payload)
      }
    ]
  }

  getCurrentTube = this.createCommandHandler<[], string>(
    () => new TextEncoder().encode(`list-tube-used\r\n`),
    [
      buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii.startsWith(USING)) {
          const [, tube] = ascii.split(" ")
          return tube
        }
        invalidResponse(ascii)
      }
    ]
  )

  listTubeUsed = this.getCurrentTube

  createCommandHandler<TArgs extends JackdArgs, TReturn>(
    commandStringFunction: (...args: TArgs) => Uint8Array,
    handlers: CommandHandler<TReturn | void>[]
  ): (...args: TArgs) => Promise<TReturn> {
    return async (...args) => {
      const commandString: Uint8Array = commandStringFunction.apply(this, args)
      await this.write(commandString)

      const emitter = new EventEmitter()

      this.executions.push({
        handlers: handlers.concat(),
        emitter
      })

      return await new Promise((resolve, reject) => {
        emitter.once("resolve", resolve)
        emitter.once("reject", reject)
      })
    }
  }
}

export default JackdClient

function validate(
  buffer: Uint8Array,
  additionalResponses: string[] = []
): string {
  const ascii = new TextDecoder().decode(buffer)
  const errors = [OUT_OF_MEMORY, INTERNAL_ERROR, BAD_FORMAT, UNKNOWN_COMMAND]

  if (
    errors.concat(additionalResponses).some(error => ascii.startsWith(error))
  ) {
    throw new Error(ascii)
  }

  return ascii
}

export class InvalidResponseError extends Error {
  response: string = "internal error"
}

function invalidResponse(ascii: string) {
  console.log(ascii)
  const error = new InvalidResponseError(`Unexpected response: ${ascii}`)
  error.response = ascii
  throw error
}

// Helper function to find index of subarray
function findIndex(array: Uint8Array, subarray: Uint8Array): number {
  for (let i = 0; i <= array.length - subarray.length; i++) {
    let found = true
    for (let j = 0; j < subarray.length; j++) {
      if (array[i + j] !== subarray[j]) {
        found = false
        break
      }
    }
    if (found) return i
  }
  return -1
}

const RESERVED = "RESERVED"
const INSERTED = "INSERTED"
const USING = "USING"
const TOUCHED = "TOUCHED"
const DELETED = "DELETED"
const BURIED = "BURIED"
const RELEASED = "RELEASED"
const NOT_FOUND = "NOT_FOUND"
const OUT_OF_MEMORY = "OUT_OF_MEMORY"
const INTERNAL_ERROR = "INTERNAL_ERROR"
const BAD_FORMAT = "BAD_FORMAT"
const UNKNOWN_COMMAND = "UNKNOWN_COMMAND"
const EXPECTED_CRLF = "EXPECTED_CRLF"
const JOB_TOO_BIG = "JOB_TOO_BIG"
const DRAINING = "DRAINING"
const TIMED_OUT = "TIMED_OUT"
const DEADLINE_SOON = "DEADLINE_SOON"
const FOUND = "FOUND"
const WATCHING = "WATCHING"
const NOT_IGNORED = "NOT_IGNORED"
const KICKED = "KICKED"
const PAUSED = "PAUSED"
const OK = "OK"
