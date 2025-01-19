import { Socket } from "net";
import EventEmitter from "events";
export type CommandHandler<T> = (chunk: Uint8Array) => T | Promise<T>;
export declare class CommandExecution<T> {
    handlers: CommandHandler<T | void>[];
    emitter: EventEmitter;
}
export interface JackdConnectOpts {
    host: string;
    port?: number;
}
export interface JackdPutOpts {
    delay?: number;
    priority?: number;
    ttr?: number;
}
export interface JackdJobRaw {
    id: number;
    payload: Uint8Array;
}
export interface JackdJob {
    id: number;
    payload: string;
}
interface JackdReleaseOpts {
    priority?: number;
    delay?: number;
}
interface JackdPauseTubeOpts {
    delay?: number;
}
type JackdPutArgs = [
    payload: Uint8Array | string | object,
    options?: JackdPutOpts
];
type JackdReleaseArgs = [jobId: number, options?: JackdReleaseOpts];
type JackdPauseTubeArgs = [tubeId: string, options?: JackdPauseTubeOpts];
type JackdJobArgs = [jobId: number];
type JackdTubeArgs = [tubeId: string];
type JackdArgs = JackdPutArgs | JackdReleaseArgs | JackdPauseTubeArgs | JackdJobArgs | JackdTubeArgs | never[] | number[] | [jobId: number, priority?: number];
export declare class JackdClient {
    socket: Socket;
    connected: boolean;
    buffer: Uint8Array;
    chunkLength: number;
    messages: Uint8Array[];
    executions: CommandExecution<unknown>[];
    constructor();
    processChunk(head: Uint8Array): Promise<void>;
    flushExecutions(): Promise<void>;
    /**
     * For environments where network partitioning is common.
     * @returns {Boolean}
     */
    isConnected(): boolean;
    connect(opts?: JackdConnectOpts): Promise<this>;
    write(buffer: Uint8Array): Promise<void>;
    quit: () => Promise<void>;
    close: () => Promise<void>;
    disconnect: () => Promise<void>;
    put: (payload: string | object | Uint8Array<ArrayBufferLike>, options?: JackdPutOpts | undefined) => Promise<number>;
    use: (tubeId: string) => Promise<string>;
    createReserveHandlers<T extends JackdJob | JackdJobRaw>(additionalResponses?: Array<string>, decodePayload?: boolean): [CommandHandler<void>, CommandHandler<T>];
    reserve: () => Promise<JackdJob>;
    reserveRaw: () => Promise<JackdJobRaw>;
    reserveWithTimeout: (args_0: number) => Promise<JackdJob>;
    reserveJob: (args_0: number) => Promise<JackdJob>;
    delete: (jobId: number) => Promise<void>;
    release: (jobId: number, options?: JackdReleaseOpts | undefined) => Promise<void>;
    bury: (jobId: number, priority?: number | undefined) => Promise<void>;
    touch: (jobId: number) => Promise<void>;
    watch: (tubeId: string) => Promise<number>;
    ignore: (tubeId: string) => Promise<number>;
    pauseTube: (tubeId: string, options?: JackdPauseTubeOpts | undefined) => Promise<void>;
    peek: (jobId: number) => Promise<JackdJob>;
    createPeekHandlers(): [CommandHandler<void>, CommandHandler<JackdJob>];
    peekReady: () => Promise<JackdJob>;
    peekDelayed: () => Promise<JackdJob>;
    peekBuried: () => Promise<JackdJob>;
    kick: (jobsCount: number) => Promise<number>;
    kickJob: (jobId: number) => Promise<void>;
    statsJob: (jobId: number) => Promise<string>;
    statsTube: (tubeId: string) => Promise<string>;
    stats: () => Promise<string>;
    listTubes: () => Promise<string>;
    listTubesWatched: () => Promise<string>;
    createYamlCommandHandlers(): [CommandHandler<void>, CommandHandler<string>];
    getCurrentTube: () => Promise<string>;
    listTubeUsed: () => Promise<string>;
    createCommandHandler<TArgs extends JackdArgs, TReturn>(commandStringFunction: (...args: TArgs) => Uint8Array, handlers: CommandHandler<TReturn | void>[]): (...args: TArgs) => Promise<TReturn>;
}
export default JackdClient;
export declare class InvalidResponseError extends Error {
    response: string;
}
