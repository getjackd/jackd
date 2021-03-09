// Type definitions for jackd 1.2.1
// Project: jackd
// Definitions by: Tomasz Ciborski <https://tomasz.ciborski.com/>

export = JackdClient

declare class JackdClient {
  constructor()

  connect(options: JackdClient.ConnectOptions): Promise<JackdClient>
  disconnect(): Promise<void>
  quit(): Promise<void>
  close(): Promise<void>
  isConnected(): boolean

  put(
    stringOrObject: string | object,
    options?: JackdClient.PutOptions
  ): Promise<void>
  reserve(): Promise<JackdClient.Job>
  reserveWithTimeout(timeoutSeconds: number): Promise<JackdClient.Job>
  delete(jobId: string): Promise<void>
  release(jobId: string, options?: JackdClient.ReleaseOptions): Promise<void>
  bury(jobId: string): Promise<void>
  kickJob(jobId: string): Promise<void>
  kick(jobsCount: number): Promise<void>
  touch(jobId: string): Promise<void>
  peek(jobId: string): Promise<JackdClient.Job>
  peekBuried(): Promise<JackdClient.Job>

  use(tubeId: string): Promise<void>
  watch(tubeId: string): Promise<number>
  ignore(tubeId: string): Promise<number>
  getCurrentTube(): Promise<string>
  pauseTube(tubeId: string, options?: JackdClient.PauseTubeOptions): Promise<void>

  executeMultiPartCommand(command: string): Promise<string>
  executeCommand(...args: any): Promise<any>
}

declare namespace JackdClient {
  export interface ConnectOptions {
    host: string
    port?: number
  }

  export interface PutOptions {
    delay?: number
    priority?: number
    ttr?: number
  }

  export interface Job {
    id: string
    payload: string
  }

  export interface ReleaseOptions {
    priority?: number
    delay?: number
  }

  export interface PauseTubeOptions {
    delay?: number
  }
}
