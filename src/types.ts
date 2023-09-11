import EventEmitter = require('events')

export type CommandHandler<T> = (chunk: Buffer) => Promise<T>

export class CommandExecution<T> {
  handlers: CommandHandler<T | void>[]
  emitter: EventEmitter
}

export interface CtorOpts {
  useLegacyStringPayloads: boolean
  maxRetries?: number
}

export interface ConnectOpts {
  host?: string
  port?: number
}

export interface PutOpts {
  delay?: number
  priority?: number
  ttr?: number
}

export interface Job {
  id: string
  payload: Buffer | string
}

export interface ReleaseOpts {
  priority?: number
  delay?: number
}

export interface PauseTubeOpts {
  delay?: number
}

export type PutArgs = [payload: Buffer | string | object, options?: PutOpts]
export type ReleaseArgs = [jobId: string, options?: ReleaseOpts]
export type PauseTubeArgs = [tubeId: string, options?: PauseTubeOpts]
export type JobArgs = [jobId: string]
export type TubeArgs = [tubeId: string]
