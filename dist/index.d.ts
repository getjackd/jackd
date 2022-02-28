/// <reference types="node" />
import { Socket } from 'net';
import { CommandExecution, CommandHandler, ConnectOpts, Job, CtorOpts, PutOpts } from './types';
export declare class JackdClient {
    socket: Socket;
    connected: Boolean;
    buffer: Buffer;
    chunkLength: number;
    useLegacyStringPayloads: boolean;
    messages: Buffer[];
    executions: CommandExecution<any>[];
    constructor(opts?: CtorOpts);
    processChunk(head: Buffer): Promise<void>;
    flushExecutions(): Promise<void>;
    isConnected(): Boolean;
    connect(opts?: ConnectOpts): Promise<this>;
    write(buffer: Buffer): Promise<void>;
    quit(): Promise<void>;
    close: () => Promise<void>;
    disconnect: () => Promise<void>;
    put: (payload: string | object | Buffer, options?: PutOpts) => Promise<string>;
    use: (tubeId: string) => Promise<string>;
    createReserveHandlers(): [CommandHandler<void>, CommandHandler<Job>];
    decodeAsciiWhenLegacy: (payload: Buffer) => Buffer | string;
    reserve: () => Promise<Job>;
    reserveWithTimeout: (args_0: number) => Promise<Job>;
    reserveJob: (args_0: number) => Promise<Job>;
    delete: (jobId: string) => Promise<void>;
    release: (jobId: string, options?: import("./types").ReleaseOpts) => Promise<void>;
    bury: (jobId: string, priority: number) => Promise<void>;
    touch: (jobId: string) => Promise<void>;
    watch: (tubeId: string) => Promise<number>;
    ignore: (tubeId: string) => Promise<number>;
    pauseTube: (tubeId: string, options?: import("./types").PauseTubeOpts) => Promise<void>;
    peek: (jobId: string) => Promise<Job>;
    createPeekHandlers(): [CommandHandler<void>, CommandHandler<Job>];
    peekReady: () => Promise<Job>;
    peekDelayed: () => Promise<Job>;
    peekBuried: () => Promise<Job>;
    kick: (jobsCount: number) => Promise<number>;
    kickJob: (jobId: string) => Promise<void>;
    statsJob: (jobId: string) => Promise<string>;
    statsTube: (jobId: string) => Promise<string>;
    stats: (jobId: string) => Promise<string>;
    listTubes: (jobId: string) => Promise<string>;
    listTubesWatched: (jobId: string) => Promise<string>;
    createYamlCommandHandlers(): [CommandHandler<void>, CommandHandler<string>];
    getCurrentTube: () => Promise<string>;
    listTubeUsed: () => Promise<string>;
    createCommandHandler<TArgs extends any[], TReturn>(commandStringFunction: (...args: any[]) => Buffer, handlers: CommandHandler<TReturn | void>[]): (...args: TArgs) => Promise<TReturn>;
}
export default JackdClient;
export declare class InvalidResponseError extends Error {
    response: string;
}
//# sourceMappingURL=index.d.ts.map