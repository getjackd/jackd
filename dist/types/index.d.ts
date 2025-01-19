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
export interface JobStats {
    id: number;
    tube: string;
    state: "ready" | "delayed" | "reserved" | "buried";
    pri: number;
    age: number;
    delay: number;
    ttr: number;
    timeLeft: number;
    file: number;
    reserves: number;
    timeouts: number;
    releases: number;
    buries: number;
    kicks: number;
}
export interface TubeStats {
    name: string;
    currentJobsUrgent: number;
    currentJobsReady: number;
    currentJobsReserved: number;
    currentJobsDelayed: number;
    currentJobsBuried: number;
    totalJobs: number;
    currentUsing: number;
    currentWaiting: number;
    currentWatching: number;
    pause: number;
    cmdDelete: number;
    cmdPauseTube: number;
    pauseTimeLeft: number;
}
export interface SystemStats {
    currentJobsUrgent: number;
    currentJobsReady: number;
    currentJobsReserved: number;
    currentJobsDelayed: number;
    currentJobsBuried: number;
    cmdPut: number;
    cmdPeek: number;
    cmdPeekReady: number;
    cmdPeekDelayed: number;
    cmdPeekBuried: number;
    cmdReserve: number;
    cmdReserveWithTimeout: number;
    cmdTouch: number;
    cmdUse: number;
    cmdWatch: number;
    cmdIgnore: number;
    cmdDelete: number;
    cmdRelease: number;
    cmdBury: number;
    cmdKick: number;
    cmdStats: number;
    cmdStatsJob: number;
    cmdStatsTube: number;
    cmdListTubes: number;
    cmdListTubeUsed: number;
    cmdListTubesWatched: number;
    cmdPauseTube: number;
    jobTimeouts: number;
    totalJobs: number;
    maxJobSize: number;
    currentTubes: number;
    currentConnections: number;
    currentProducers: number;
    currentWorkers: number;
    currentWaiting: number;
    totalConnections: number;
    pid: number;
    version: string;
    rusageUtime: number;
    rusageStime: number;
    uptime: number;
    binlogOldestIndex: number;
    binlogCurrentIndex: number;
    binlogMaxSize: number;
    binlogRecordsWritten: number;
    binlogRecordsMigrated: number;
    draining: boolean;
    id: string;
    hostname: string;
    os: string;
    platform: string;
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
type JackdArgs = JackdPutArgs | JackdReleaseArgs | JackdPauseTubeArgs | JackdJobArgs | JackdTubeArgs | never[] | number[] | string[] | [jobId: number, priority?: number];
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
    statsJob: (jobId: number) => Promise<JobStats>;
    statsTube: (tubeId: string) => Promise<TubeStats>;
    stats: () => Promise<SystemStats>;
    listTubes: () => Promise<string[]>;
    listTubesWatched: () => Promise<string[]>;
    createYamlCommandHandlers<T = string>(): [
        CommandHandler<void>,
        CommandHandler<T>
    ];
    listTubeUsed: () => Promise<string>;
    createCommandHandler<TArgs extends JackdArgs, TReturn>(commandStringFunction: (...args: TArgs) => Uint8Array, handlers: CommandHandler<TReturn | void>[]): (...args: TArgs) => Promise<TReturn>;
}
export default JackdClient;
export declare class InvalidResponseError extends Error {
    response: string;
}
