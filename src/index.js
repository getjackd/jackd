const { Socket } = require('net')
const assert = require('assert')

const RESERVED = 'RESERVED'
const INSERTED = 'INSERTED'
const USING = 'USING'
const TOUCHED = 'TOUCHED'
const DELETED = 'DELETED'
const BURIED = 'BURIED'
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

module.exports = {
  JackdClient
}

function JackdClient() {
  const socket = (this.socket = new Socket())
  socket.setEncoding('ascii')
}

JackdClient.prototype.connect = async function() {
  const socket = this.socket

  const connectionPromise = new Promise(resolve => {
    socket.on('connect', resolve)
  })

  if (!arguments.length) {
    socket.connect(11300)
    await connectionPromise
    return this
  }
}

JackdClient.prototype.close = JackdClient.prototype.disconnect = async function() {
  const socket = this.socket

  const closePromise = new Promise(resolve => {
    socket.on('close', resolve)
  })

  socket.destroy()
  await closePromise
}

JackdClient.prototype.write = function(string) {
  assert(string)

  return new Promise((resolve, reject) => {
    this.socket.write(string, 'ascii', err => (err ? reject(err) : resolve()))
  })
}

JackdClient.prototype.executeCommand = createCommandHandler(
  command => command,
  response => validateAgainstErrors(response)
)

JackdClient.prototype.reserve = createCommandHandler(
  () => 'reserve\r\n',
  response => {
    validateAgainstErrors(response, [DEADLINE_SOON, TIMED_OUT])

    if (response.startsWith(RESERVED)) {
      const [, id] = response.split(' ')
      return function(deferredResponse) {
        return { id, payload: deferredResponse }
      }
    }

    return null
  }
)

JackdClient.prototype.put = createCommandHandler(
  (payload, { priority, delay, ttr } = {}) => {
    const body = Buffer.from(payload, 'ascii')
    return `put ${priority || 0} ${delay || 0} ${ttr || 10} ${
      body.length
    }\r\n${payload}\r\n`
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

    responseUnexpected(response)
  }
)

JackdClient.prototype.delete = createCommandHandler(
  id => `delete ${id}\r\n`,
  response => {
    validateAgainstErrors(response, [NOT_FOUND])
    if (response !== DELETED) responseUnexpected(response)
  }
)

JackdClient.prototype.use = createCommandHandler()
// JackdClient.prototype.use = async function(tube) {
//   const handler = new Promise((resolve, reject) => {
//     handleGenericErrors(responses, reject)
//     responses.on(USING, resolve)
//   })

//   await this.write(`use ${tube}\r\n`)

//   return handler
// }

// JackdClient.prototype.bury = async function(id, priority) {
//   const handler = new Promise((resolve, reject) => {
//     handleGenericErrors(responses, reject)
//     handleErrors(responses, [NOT_FOUND])
//     responses.on(BURIED, resolve)
//   })

//   await this.write(`bury ${id} ${priority}\r\n`)

//   return handler
// }

function responseUnexpected(response) {
  const error = new Error('unexpected-response')
  error.response = response
  throw error
}

function createCommandHandler(commandFunction, responseFunction) {
  return async function command() {
    const socket = this.socket
    let buffer = ''

    await this.write(commandFunction.apply(this, arguments))

    return new Promise((resolve, reject) => {
      socket.on('data', processIncomingData)

      function processIncomingData(chunk, responseFunctionOverride) {
        try {
          buffer += chunk

          const delimiterIndex = buffer.indexOf('\r\n')
          const isLine = delimiterIndex > -1

          if (isLine) {
            const head = buffer.substring(0, delimiterIndex)
            const tail = buffer.substring(delimiterIndex + 2, buffer.length)

            buffer = ''
            let result = (responseFunctionOverride || responseFunction)(head)

            if (typeof result === 'function' && tail.length) {
              return processIncomingData(tail, result)
            }

            socket.removeListener('data', processIncomingData)
            resolve(result)
          }
        } catch (err) {
          socket.removeListener('data', processIncomingData)
          reject(err)
        }
      }
    })
  }
}

function validateAgainstErrors(response, additionalErrors = []) {
  const errors = [
    OUT_OF_MEMORY,
    INTERNAL_ERROR,
    BAD_FORMAT,
    TIMED_OUT,
    UNKNOWN_COMMAND
  ]

  if (errors.concat(additionalErrors).some(error => response.startsWith(error)))
    throw new Error(response)
}
