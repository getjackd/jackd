const { Socket } = require('net')
const assert = require('assert')
const EventEmitter = require('events')

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
const SOCKET_EVENTS = ['connect', 'close', 'error', 'ready'];

module.exports = JackdClient

function JackdClient() {
  this.socket = new Socket()
  this.socket.setEncoding('ascii')
  this.connected = false

  this.socket.on('ready', () => {
    this.connected = true
  })

  this.socket.on('close', () => {
    this.connected = false
  })
}

/**
 * Useful check for environments where network partitioning is common.
 * @returns {boolean}
 */
JackdClient.prototype.isConnected = function() {
  return this.connected;
}

/**
 * Support event listeners on the underlying socket to support external
 * reconnection logic.
 * @param event
 * @param listener
 */
JackdClient.prototype.on = function(event, listener) {
  if (SOCKET_EVENTS.includes(event)) {
    this.socket.on(event, listener);
  }
}

/**
 * Support one-time event listeners on the underlying socket to support
 * external reconnection logic.
 * @param event
 * @param listener
 */
JackdClient.prototype.once = function(event, listener) {
    if (SOCKET_EVENTS.includes(event)) {
        this.socket.once(event, listener);
    }
}

JackdClient.prototype.connect = async function() {
  const socket = this.socket
  let host = undefined, port = 11300

  if (arguments.length === 1) {
    const [opts] = arguments
    host = opts.host
    port = opts.port
  }

  await new Promise((resolve, reject) => {
      socket.once('error', (error) => {
        if (error.code === 'EISCONN') {
          return resolve();
        }
        reject(error)
      })

      socket.connect(port, host, resolve)
  })

  this.pending = []

  let dataBuffer = ''

  socket.on('data', async response => {
    if (!response.endsWith('\r\n')) {
      dataBuffer += response
      return
    }
    const chunks = (dataBuffer + response).split('\r\n')
    dataBuffer = ''

    while (chunks.length) {
      const chunk = chunks.shift()
      if (!chunk) continue

      const { emitter, multipart } = this.pending.shift() || {}

      if (!emitter) {
        return
      } else if (multipart && chunks.length > 1) {
        emitter.emit('response', `${chunk}\r\n${chunks.shift()}\r\n`)
      } else {
        emitter.emit('response', `${chunk}\r\n`)
      }
    }
  })

  return this
}

JackdClient.prototype.quit = JackdClient.prototype.close = JackdClient.prototype.disconnect = async function() {
  await this.write('quit\r\n')
}

JackdClient.prototype.write = function(string) {
  assert(string)

  return new Promise((resolve, reject) => {
    this.socket.write(string, 'ascii', err => (err ? reject(err) : resolve()))
  })
}

JackdClient.prototype.executeCommand = createCommandHandler(
  command => command,
  response => {
    validateAgainstErrors(response)
    return response
  }
)

JackdClient.prototype.executeMultiPartCommand = createCommandHandler(
  command => command,
  response => {
    validateAgainstErrors(response)
    return function(deferredResponse) {
      return deferredResponse
    }
  },
  true
)

JackdClient.prototype.pauseTube = createCommandHandler(
  (tube, { delay } = {}) => `pause-tube ${tube} ${delay || 0}`,
  response => {
    validateAgainstErrors(response, [NOT_FOUND])
    if (response === PAUSED) return
    invalidResponse(response)
  }
)

/* Producer commands */

JackdClient.prototype.put = createCommandHandler(
  (payload, { priority, delay, ttr } = {}) => {
    assert(payload)
    let string = payload

    if (typeof payload === 'object') {
      string = JSON.stringify(payload)
    }

    const body = Buffer.from(string, 'ascii')
    return `put ${priority || 0} ${delay || 0} ${ttr || 60} ${
      body.length
    }\r\n${string}\r\n`
  },
  response => {
    validateAgainstErrors(response, [
      BURIED,
      EXPECTED_CRLF,
      JOB_TOO_BIG,
      DRAINING
    ])

    if (response.startsWith(INSERTED)) {
      const [, id] = response.split(' ')
      return id
    }

    invalidResponse(response)
  }
)

JackdClient.prototype.use = createCommandHandler(
  tube => {
    assert(tube)
    return `use ${tube}\r\n`
  },
  response => {
    validateAgainstErrors(response)
    if (response.startsWith(USING)) {
      const [, tube] = response.split(' ')
      return tube
    }
    invalidResponse(response)
  }
)

/* Consumer commands */

JackdClient.prototype.reserve = createCommandHandler(
  () => 'reserve\r\n',
  reserveResponseHandler,
  true
)

JackdClient.prototype.reserveWithTimeout = createCommandHandler(
  seconds => `reserve-with-timeout ${seconds}\r\n`,
  reserveResponseHandler,
  true
)

function reserveResponseHandler(response) {
  validateAgainstErrors(response, [DEADLINE_SOON, TIMED_OUT])

  if (response.startsWith(RESERVED)) {
    const [, id] = response.split(' ')
    return function(deferredResponse) {
      return { id, payload: deferredResponse }
    }
  }

  invalidResponse(response)
}

JackdClient.prototype.delete = createCommandHandler(
  id => {
    assert(id)
    return `delete ${id}\r\n`
  },
  response => {
    validateAgainstErrors(response, [NOT_FOUND])
    if (response === DELETED) return
    invalidResponse(response)
  }
)

JackdClient.prototype.release = createCommandHandler(
  (id, { priority, delay } = {}) => {
    assert(id)
    return `release ${id} ${priority || 0} ${delay || 0}\r\n`
  },
  response => {
    validateAgainstErrors(response, [BURIED, NOT_FOUND])
    if (response === RELEASED) return
    invalidResponse(response)
  }
)

JackdClient.prototype.bury = createCommandHandler(
  (id, { priority } = {}) => {
    assert(id)
    return `bury ${id} ${priority || 0}\r\n`
  },
  response => {
    validateAgainstErrors(response, [NOT_FOUND])
    if (response === BURIED) return
    invalidResponse(response)
  }
)

JackdClient.prototype.touch = createCommandHandler(
  id => {
    assert(id)
    return `touch ${id}\r\n`
  },
  response => {
    validateAgainstErrors(response, [NOT_FOUND])
    if (response === TOUCHED) return
    invalidResponse(response)
  }
)

JackdClient.prototype.watch = createCommandHandler(
  tube => {
    assert(tube)
    return `watch ${tube}\r\n`
  },
  response => {
    validateAgainstErrors(response)
    if (response.startsWith(WATCHING)) {
      const [, count] = response.split(' ')
      return count
    }
    invalidResponse(response)
  }
)

JackdClient.prototype.ignore = createCommandHandler(
  tube => {
    assert(tube)
    return `ignore ${tube}\r\n`
  },
  response => {
    validateAgainstErrors(response, [NOT_IGNORED])
    if (response.startsWith(WATCHING)) {
      const [, count] = response.split(' ')
      return count
    }
    invalidResponse(response)
  }
)

/* Other commands */

JackdClient.prototype.peek = createCommandHandler(
  id => {
    assert(id)
    return `peek ${id}\r\n`
  },
  response => {
    validateAgainstErrors(response, [NOT_FOUND])
    if (response.startsWith(FOUND)) {
      const [, id] = response.split(' ')
      return function(deferredResponse) {
        return { id, payload: deferredResponse }
      }
    }
    invalidResponse(response)
  },
  true
)

JackdClient.prototype.peekBuried = createCommandHandler(
  () => {
    return `peek-buried\r\n`
  },
  response => {
    validateAgainstErrors(response, [NOT_FOUND])
    if (response.startsWith(FOUND)) {
      const [, id] = response.split(' ')
      return function(deferredResponse) {
        return { id, payload: deferredResponse }
      }
    }
    invalidResponse(response)
  },
  true
)

JackdClient.prototype.kick = createCommandHandler(
  bound => {
    assert(bound)
    return `kick ${bound}\r\n`
  },
  response => {
    validateAgainstErrors(response)
    if (response.startsWith(KICKED)) return
    invalidResponse(response)
  }
)

JackdClient.prototype.kickJob = createCommandHandler(
  id => {
    assert(id)
    return `kick-job ${id}\r\n`
  },
  response => {
    validateAgainstErrors(response, [NOT_FOUND])
    if (response.startsWith(KICKED)) return
    invalidResponse(response)
  }
)

JackdClient.prototype.getCurrentTube = createCommandHandler(
  () => `list-tube-used\r\n`,
  response => {
    validateAgainstErrors(response, [NOT_FOUND])
    if (response.startsWith(USING)) {
      const [, tube] = response.split(' ')
      return tube
    }
    invalidResponse(response)
  }
)

function invalidResponse(response) {
  const error = new Error(`Unexpected response: ${response}`)
  error.response = response
  throw error
}

function createCommandHandler(commandFunction, responseFunction, multipart) {
  return async function command() {
    let buffer = ''

    const command = commandFunction.apply(this, arguments)
    await this.write(command)

    const emitter = new EventEmitter()
    this.pending.push({
      command,
      multipart,
      emitter
    })

    return await new Promise((resolve, reject) => {
      emitter.on('response', processIncomingData)

      function processIncomingData(chunk, responseFunctionOverride) {
        try {
          buffer += chunk

          const delimiterIndex = buffer.indexOf('\r\n')
          const isLine = delimiterIndex > -1

          if (!isLine) return

          const head = buffer.substring(0, delimiterIndex)
          const tail = buffer.substring(delimiterIndex + 2, buffer.length)

          buffer = ''
          let result = (responseFunctionOverride || responseFunction)(head)

          if (multipart && tail.length) {
            return processIncomingData(tail, result)
          }

          emitter.removeListener('data', processIncomingData)
          resolve(result)
        } catch (err) {
          emitter.removeListener('data', processIncomingData)
          reject(err)
        }
      }
    })
  }
}

function validateAgainstErrors(response, additionalErrors = []) {
  const errors = [OUT_OF_MEMORY, INTERNAL_ERROR, BAD_FORMAT, UNKNOWN_COMMAND]

  if (errors.concat(additionalErrors).some(error => response.startsWith(error)))
    throw new Error(response)
}
