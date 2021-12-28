import EventEmitter = require('events')

export type CommandHandler = (chunk: Buffer) => Promise<any>

export class CommandExecution {
  handlers: CommandHandler[]
  emitter: EventEmitter
}

export interface CtorOpts {
  useLegacyStringPayloads: boolean
}

export interface ConnectOpts {
  host: string
  port?: number
}

export interface PutOpts {
  delay?: number
  priority?: number
  ttr?: number
}

export interface Job {
  id: string
  payload: Buffer
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
