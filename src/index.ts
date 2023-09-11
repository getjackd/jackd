import { Socket } from 'net'
import assert = require('assert')
import EventEmitter = require('events')

import {
  CommandExecution,
  CommandHandler,
  ConnectOpts,
  Job,
  PauseTubeArgs,
  PutArgs,
  ReleaseArgs,
  JobArgs,
  TubeArgs,
  CtorOpts,
  PutOpts
} from './types'

const DELIMITER = '\r\n'

export class JackdClient {
  socket: Socket = new Socket()
  connected: Boolean = false
  buffer: Buffer = Buffer.from([])
  chunkLength: number = 0

  useLegacyStringPayloads: boolean = false

  connectOpts?: ConnectOpts
  retries = 0
  maxRetries: number
  reconnectionDelay = 1000

  // beanstalkd executes all commands serially. Because Node.js is single-threaded,
  // this allows us to queue up all of the messages and commands as they're invokved
  // without needing to explicitly wait for promises.
  messages: Buffer[] = []
  executions: CommandExecution<any>[] = []

  constructor(opts?: CtorOpts) {
    if (opts && opts.useLegacyStringPayloads) {
      this.useLegacyStringPayloads = true
    }

    this.maxRetries = opts.maxRetries ?? 10

    this.socket.on('ready', () => {
      this.connected = true
    })

    this.socket.on('close', hadError => {
      this.connected = false

      if (!hadError) return

      if (this.retries < this.maxRetries) {
        let delay = this.reconnectionDelay * Math.pow(2, ++this.retries)
        setTimeout(() => this.connectSocket().catch(console.error), delay)
      }
    })

    process.on('SIGINT', () => {
      this.socket.destroy()
    })

    // When we receive data from the socket, let's process it and put it in our
    // messages.
    this.socket.on('data', async incoming => {
      // Write the incoming data onto the buffer
      this.buffer = Buffer.concat([this.buffer, incoming])
      await this.processChunk(this.buffer)
    })
  }

  async processChunk(head: Buffer) {
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
      index = head.indexOf(DELIMITER)
    }

    if (index > -1) {
      this.messages.push(head.subarray(0, index))

      // We have to start flushing executions as soon as we push messages. This is to avoid
      // instances where job payloads might contain line breaks. We let the downstream handlers
      // set the incoming bytes almost immediately.
      await this.flushExecutions()

      const tail = head.subarray(index + DELIMITER.length, head.length)
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

          const result = await handler(this.messages.shift())

          if (handlers.length === 0) {
            emitter.emit('resolve', result)

            // We modified the executions array by removing an element. Decrement the loop.
            this.executions.shift()
            i--

            break
          }
        }
      } catch (err) {
        emitter.emit('reject', err)

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
  isConnected(): Boolean {
    return this.connected
  }

  async connect({
    host = '127.0.0.1',
    port = 11300
  }: ConnectOpts = {}): Promise<this> {
    this.connectOpts = { host, port }
    await this.connectSocket()
    return this
  }

  async connectSocket() {
    const { host, port } = this.connectOpts

    return new Promise<void>((resolve, reject) => {
      this.socket.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EISCONN') {
          return resolve()
        }

        reject(error)
      })

      this.socket.connect(port, host, resolve)
    })
  }

  write(buffer: Buffer) {
    assert(buffer)

    return new Promise<void>((resolve, reject) => {
      this.socket.write(buffer, err => (err ? reject(err) : resolve()))
    })
  }

  async quit() {
    this.socket.end(Buffer.from('quit\r\n', 'ascii'))
  }

  close = this.quit
  disconnect = this.quit

  put = this.createCommandHandler<PutArgs, string>(
    (
      payload: Buffer | string | object,
      { priority, delay, ttr }: PutOpts = {}
    ) => {
      assert(payload)
      let body: any = payload

      // If the caller passed in an object, convert it to a string
      if (typeof body === 'object') {
        body = JSON.stringify(payload)
      }

      // If the body is a string, convert it to a UTF-8 Buffer
      if (typeof body === 'string') {
        body = Buffer.from(body)
      }

      let command = Buffer.from(
        `put ${priority || 0} ${delay || 0} ${ttr || 60} ${body.length}\r\n`,
        'ascii'
      )

      return Buffer.concat([command, body, Buffer.from(DELIMITER, 'ascii')])
    },
    [
      async buffer => {
        const ascii = validate(buffer, [
          BURIED,
          EXPECTED_CRLF,
          JOB_TOO_BIG,
          DRAINING
        ])

        if (ascii.startsWith(INSERTED)) {
          const [, id] = ascii.split(' ')
          return id
        }

        invalidResponse(ascii)
      }
    ]
  )

  use = this.createCommandHandler<TubeArgs, string>(
    tube => {
      assert(tube)
      return Buffer.from(`use ${tube}\r\n`, 'ascii')
    },
    [
      async buffer => {
        const ascii = validate(buffer)

        if (ascii.startsWith(USING)) {
          const [, tube] = ascii.split(' ')
          return tube
        }

        invalidResponse(ascii)
      }
    ]
  )

  createReserveHandlers(
    additionalResponses: Array<string> = []
  ): [CommandHandler<void>, CommandHandler<Job>] {
    const self = this
    let id: string

    return [
      async buffer => {
        const ascii = validate(buffer, [
          DEADLINE_SOON,
          TIMED_OUT,
          ...additionalResponses
        ])

        if (ascii.startsWith(RESERVED)) {
          const [, incomingId, bytes] = ascii.split(' ')
          id = incomingId
          self.chunkLength = parseInt(bytes)

          return
        }

        invalidResponse(ascii)
      },
      async (payload: Buffer) => {
        return { id, payload: this.decodeAsciiWhenLegacy(payload) }
      }
    ]
  }

  decodeAsciiWhenLegacy = (payload: Buffer): Buffer | string =>
    this.useLegacyStringPayloads ? payload.toString('ascii') : payload

  reserve = this.createCommandHandler<[], Job>(
    () => Buffer.from('reserve\r\n', 'ascii'),
    this.createReserveHandlers()
  )

  reserveWithTimeout = this.createCommandHandler<[number], Job>(
    seconds => Buffer.from(`reserve-with-timeout ${seconds}\r\n`, 'ascii'),
    this.createReserveHandlers()
  )

  reserveJob = this.createCommandHandler<[number], Job>(
    id => Buffer.from(`reserve-job ${id}\r\n`, 'ascii'),
    this.createReserveHandlers([NOT_FOUND])
  )

  delete = this.createCommandHandler<JobArgs, void>(
    id => {
      assert(id)
      return Buffer.from(`delete ${id}\r\n`, 'ascii')
    },
    [
      async buffer => {
        const ascii = validate(buffer, [NOT_FOUND])

        if (ascii === DELETED) return
        invalidResponse(ascii)
      }
    ]
  )

  release = this.createCommandHandler<ReleaseArgs, void>(
    (id, { priority, delay } = {}) => {
      assert(id)
      return Buffer.from(
        `release ${id} ${priority || 0} ${delay || 0}\r\n`,
        'ascii'
      )
    },
    [
      async buffer => {
        const ascii = validate(buffer, [BURIED, NOT_FOUND])
        if (ascii === RELEASED) return
        invalidResponse(ascii)
      }
    ]
  )

  bury = this.createCommandHandler<[jobId: string, priority: number], void>(
    (id, priority) => {
      assert(id)
      return Buffer.from(`bury ${id} ${priority || 0}\r\n`, 'ascii')
    },
    [
      async buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii === BURIED) return
        invalidResponse(ascii)
      }
    ]
  )

  touch = this.createCommandHandler<JobArgs, void>(
    id => {
      assert(id)
      return Buffer.from(`touch ${id}\r\n`, 'ascii')
    },
    [
      async buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii === TOUCHED) return
        invalidResponse(ascii)
      }
    ]
  )

  watch = this.createCommandHandler<TubeArgs, number>(
    tube => {
      assert(tube)
      return Buffer.from(`watch ${tube}\r\n`, 'ascii')
    },
    [
      async buffer => {
        const ascii = validate(buffer)

        if (ascii.startsWith(WATCHING)) {
          const [, count] = ascii.split(' ')
          return parseInt(count)
        }

        invalidResponse(ascii)
      }
    ]
  )

  ignore = this.createCommandHandler<TubeArgs, number>(
    tube => {
      assert(tube)
      return Buffer.from(`ignore ${tube}\r\n`, 'ascii')
    },
    [
      async buffer => {
        const ascii = validate(buffer, [NOT_IGNORED])

        if (ascii.startsWith(WATCHING)) {
          const [, count] = ascii.split(' ')
          return parseInt(count)
        }
        invalidResponse(ascii)
      }
    ]
  )

  pauseTube = this.createCommandHandler<PauseTubeArgs, void>(
    (tube, { delay } = {}) =>
      Buffer.from(`pause-tube ${tube} ${delay || 0}`, 'ascii'),

    [
      async buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii === PAUSED) return
        invalidResponse(ascii)
      }
    ]
  )

  /* Other commands */

  peek = this.createCommandHandler<JobArgs, Job>(id => {
    assert(id)
    return Buffer.from(`peek ${id}\r\n`, 'ascii')
  }, this.createPeekHandlers())

  createPeekHandlers(): [CommandHandler<void>, CommandHandler<Job>] {
    let self = this
    let id: string

    return [
      async (buffer: Buffer) => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii.startsWith(FOUND)) {
          const [, peekId, bytes] = ascii.split(' ')
          id = peekId
          self.chunkLength = parseInt(bytes)

          return
        }
        invalidResponse(ascii)
      },
      async (payload: Buffer) => {
        return { id, payload: this.decodeAsciiWhenLegacy(payload) }
      }
    ]
  }

  peekReady = this.createCommandHandler<[], Job>(() => {
    return Buffer.from(`peek-ready\r\n`, 'ascii')
  }, this.createPeekHandlers())

  peekDelayed = this.createCommandHandler<[], Job>(() => {
    return Buffer.from(`peek-delayed\r\n`, 'ascii')
  }, this.createPeekHandlers())

  peekBuried = this.createCommandHandler<[], Job>(() => {
    return Buffer.from(`peek-buried\r\n`, 'ascii')
  }, this.createPeekHandlers())

  kick = this.createCommandHandler<[jobsCount: number], number>(
    bound => {
      assert(bound)
      return Buffer.from(`kick ${bound}\r\n`, 'ascii')
    },
    [
      async buffer => {
        const ascii = validate(buffer)
        if (ascii.startsWith(KICKED)) {
          const [, kicked] = ascii.split(' ')
          return parseInt(kicked)
        }

        invalidResponse(ascii)
      }
    ]
  )

  kickJob = this.createCommandHandler<JobArgs, void>(
    id => {
      assert(id)
      return Buffer.from(`kick-job ${id}\r\n`, 'ascii')
    },
    [
      async buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii.startsWith(KICKED)) return
        invalidResponse(ascii)
      }
    ]
  )

  statsJob = this.createCommandHandler<JobArgs, string>(id => {
    assert(id)
    return Buffer.from(`stats-job ${id}\r\n`, 'ascii')
  }, this.createYamlCommandHandlers())

  statsTube = this.createCommandHandler<JobArgs, string>(tube => {
    assert(tube)
    return Buffer.from(`stats-tube ${tube}\r\n`, 'ascii')
  }, this.createYamlCommandHandlers())

  stats = this.createCommandHandler<JobArgs, string>(
    () => Buffer.from(`stats\r\n`, 'ascii'),
    this.createYamlCommandHandlers()
  )

  listTubes = this.createCommandHandler<JobArgs, string>(
    () => Buffer.from(`list-tubes\r\n`, 'ascii'),
    this.createYamlCommandHandlers()
  )

  listTubesWatched = this.createCommandHandler<JobArgs, string>(
    () => Buffer.from(`list-tubes-watched\r\n`, 'ascii'),
    this.createYamlCommandHandlers()
  )

  createYamlCommandHandlers(): [CommandHandler<void>, CommandHandler<string>] {
    const self = this

    return [
      async buffer => {
        const ascii = validate(buffer, [DEADLINE_SOON, TIMED_OUT])

        if (ascii.startsWith(OK)) {
          const [, bytes] = ascii.split(' ')
          self.chunkLength = parseInt(bytes)

          return
        }

        invalidResponse(ascii)
      },
      async (payload: Buffer) => {
        // Payloads for internal beanstalkd commands are always returned in ASCII
        return payload.toString('ascii')
      }
    ]
  }

  getCurrentTube = this.createCommandHandler<[], string>(
    () => Buffer.from(`list-tube-used\r\n`, 'ascii'),
    [
      async buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii.startsWith(USING)) {
          const [, tube] = ascii.split(' ')
          return tube
        }
        invalidResponse(ascii)
      }
    ]
  )

  listTubeUsed = this.getCurrentTube

  createCommandHandler<TArgs extends any[], TReturn>(
    commandStringFunction: (...args: any[]) => Buffer,
    handlers: CommandHandler<TReturn | void>[]
  ): (...args: TArgs) => Promise<TReturn> {
    const self = this

    return async function command() {
      const commandString: Buffer = commandStringFunction.apply(this, arguments)
      await self.write(commandString)

      const emitter = new EventEmitter()

      self.executions.push({
        handlers: handlers.concat(),
        emitter
      })

      return await new Promise((resolve, reject) => {
        emitter.once('resolve', resolve)
        emitter.once('reject', reject)
      })
    }
  }
}

module.exports = JackdClient

export default JackdClient

function validate(buffer: Buffer, additionalResponses: string[] = []): string {
  const ascii = buffer.toString('ascii')
  const errors = [OUT_OF_MEMORY, INTERNAL_ERROR, BAD_FORMAT, UNKNOWN_COMMAND]

  if (
    errors.concat(additionalResponses).some(error => ascii.startsWith(error))
  ) {
    throw new Error(ascii)
  }

  return ascii
}

export class InvalidResponseError extends Error {
  response: string
}

function invalidResponse(ascii: string) {
  const error = new InvalidResponseError(`Unexpected response: ${ascii}`)
  error.response = ascii
  throw error
}

const RESERVED = 'RESERVED'
const INSERTED = 'INSERTED'
const USING = 'USING'
const TOUCHED = 'TOUCHED'
const DELETED = 'DELETED'
const BURIED = 'BURIED'
const RELEASED = 'RELEASED'
const NOT_FOUND = 'NOT_FOUND'
const OUT_OF_MEMORY = 'OUT_OF_MEMORY'
const INTERNAL_ERROR = 'INTERNAL_ERROR'
const BAD_FORMAT = 'BAD_FORMAT'
const UNKNOWN_COMMAND = 'UNKNOWN_COMMAND'
const EXPECTED_CRLF = 'EXPECTED_CRLF'
const JOB_TOO_BIG = 'JOB_TOO_BIG'
const DRAINING = 'DRAINING'
const TIMED_OUT = 'TIMED_OUT'
const DEADLINE_SOON = 'DEADLINE_SOON'
const FOUND = 'FOUND'
const WATCHING = 'WATCHING'
const NOT_IGNORED = 'NOT_IGNORED'
const KICKED = 'KICKED'
const PAUSED = 'PAUSED'
const OK = 'OK'
